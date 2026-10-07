import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import PaymentBenefitGuard from "../models/PaymentBenefitGuard.js";
import PaymentBenefitReservation from "../models/PaymentBenefitReservation.js";
import Topup from "../models/Topup.js";
import MembershipOrder from "../models/MembershipOrder.js";
import TopupPackage from "../models/TopupPackage.js";
import MembershipPlan from "../models/MembershipPlan.js";
import Voucher from "../models/Voucher.js";
import { paymentError } from "./paymentMoney.js";
import { assertVoucherTarget } from "./voucherCheckoutService.js";

let memoryTail = Promise.resolve();

export function reservationId(kind, order) {
  return `${kind}:${order._id}`;
}

function querySession(query, session) {
  return session && typeof query.session === "function" ? query.session(session) : query;
}

export async function preparePaymentBenefitGuard(userId) {
  try {
    await PaymentBenefitGuard.findOneAndUpdate(
      { _id: String(userId) }, { $setOnInsert: { revision: 0 } }, { upsert: true, new: true },
    );
  } catch (error) {
    if (error.code !== 11000) throw error;
  }
}

export async function lockPaymentBenefits(userId, session) {
  if (!session) return;
  await PaymentBenefitGuard.findOneAndUpdate(
    { _id: String(userId) }, { $inc: { revision: 1 } }, { session },
  );
}

export async function serializeMemoryPayments(fn) {
  const previous = memoryTail;
  let release;
  memoryTail = new Promise((resolve) => { release = resolve; });
  await previous;
  try { return await fn(); } finally { release(); }
}

async function benefitTransaction(userId, fn) {
  if (isMemoryDb()) return serializeMemoryPayments(() => fn(null));
  await preparePaymentBenefitGuard(userId);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await lockPaymentBenefits(userId, session);
      result = await fn(session);
    });
    return result;
  } finally { await session.endSession(); }
}

export function heldPaymentReservation(kind, order, session = null) {
  return querySession(PaymentBenefitReservation.findOne({
    _id: reservationId(kind, order), userId: order.userId?._id || order.userId, state: "held",
  }), session);
}

export async function assertPaymentPurchaseLimit(kind, order, session = null) {
  if (await heldPaymentReservation(kind, order, session)) return;
  const membership = kind === "membership";
  const packageId = membership ? order.planId : order.packageId;
  if (!packageId) return;
  const pack = await querySession((membership ? MembershipPlan : TopupPackage).findById(packageId), session);
  const limit = Number(membership ? pack?.maxPurchasesPerUser : pack?.maxTopupsPerUser);
  if (!(limit > 0)) return;
  const userId = order.userId?._id || order.userId;
  const used = await querySession((membership ? MembershipOrder : Topup).countDocuments({
    userId, [membership ? "planId" : "packageId"]: packageId, status: "approved",
  }), session);
  const held = await querySession(PaymentBenefitReservation.countDocuments({
    userId, kind, packageId, state: "held", _id: { $ne: reservationId(kind, order) },
  }), session);
  if (used + held >= limit) throw paymentError("Package purchase limit reached", "PACKAGE_PURCHASE_LIMIT_REACHED", 409);
}

export async function assertReservedVoucherUserLimit(voucher, userId, session = null) {
  const limit = Number(voucher.perUserLimit ?? 1);
  if (!(limit > 0)) return;
  const code = voucher.code;
  const topups = await querySession(Topup.countDocuments({ userId, voucherCode: code, status: "approved" }), session);
  const memberships = await querySession(MembershipOrder.countDocuments({ userId, voucherCode: code, status: "approved" }), session);
  const held = await querySession(PaymentBenefitReservation.countDocuments({ userId, voucherCode: code, state: "held" }), session);
  if (topups + memberships + held >= limit) throw paymentError("Voucher user limit reached", "VOUCHER_USER_LIMIT_REACHED", 409);
}

export async function reservePaymentBenefits(kind, order) {
  const userId = order.userId?._id || order.userId;
  return benefitTransaction(userId, async (session) => {
    const existing = await heldPaymentReservation(kind, order, session);
    if (existing) return existing;
    if (order.expiresAt && new Date(order.expiresAt) <= new Date()) {
      throw paymentError("Payment order expired; create a new order", "PAYMENT_ORDER_EXPIRED", 409);
    }
    const membership = kind === "membership";
    const packageId = membership ? order.planId : order.packageId;
    const pack = await querySession((membership ? MembershipPlan : TopupPackage).findById(packageId), session);
    if (!pack || (pack.isActive === false && !(membership && pack.catalogRetired === true))) {
      throw paymentError("Package is unavailable", "PAYMENT_PACKAGE_UNAVAILABLE", 409);
    }
    await assertPaymentPurchaseLimit(kind, order, session);
    let claimedVoucher = false;
    if (order.voucherCode) {
      const voucher = await querySession(Voucher.findOne({ code: order.voucherCode }), session);
      if (!voucher || voucher.isActive === false || voucher.archivedAt || new Date(voucher.expireAt) <= new Date()) {
        throw paymentError("Voucher is no longer available", "VOUCHER_UNAVAILABLE", 409);
      }
      assertVoucherTarget(voucher, membership ? { target: "membership", planId: packageId } : { target: "topup", packageId });
      await assertReservedVoucherUserLimit(voucher, userId, session);
      const claimed = await Voucher.findOneAndUpdate({
        code: order.voucherCode, $expr: { $lt: ["$usedCount", "$usageLimit"] },
      }, { $inc: { usedCount: 1 } }, { new: true, session });
      if (!claimed) throw paymentError("Voucher usage limit reached", "VOUCHER_UNAVAILABLE", 409);
      claimedVoucher = true;
    }
    try {
      return await PaymentBenefitReservation.findOneAndUpdate(
        { _id: reservationId(kind, order) },
        { $set: { kind, orderId: order._id, userId, packageId, voucherCode: order.voucherCode || "", state: "held" } },
        { new: true, upsert: true, session },
      );
    } catch (error) {
      if (!session && claimedVoucher) await Voucher.findOneAndUpdate({ code: order.voucherCode }, { $inc: { usedCount: -1 } });
      throw error;
    }
  });
}

export async function consumePaymentReservation(kind, order, session = null) {
  return PaymentBenefitReservation.findOneAndUpdate(
    { _id: reservationId(kind, order), state: "held" }, { $set: { state: "consumed" } }, { session, new: true },
  );
}

export async function restorePaymentReservation(kind, order) {
  await PaymentBenefitReservation.findOneAndUpdate(
    { _id: reservationId(kind, order), state: "consumed" }, { $set: { state: "held" } },
  );
}

export async function releasePaymentReservation(kind, order) {
  return benefitTransaction(order.userId, async (session) => {
    const released = await PaymentBenefitReservation.findOneAndUpdate(
      { _id: reservationId(kind, order), state: "held" }, { $set: { state: "released" } }, { session, new: true },
    );
    if (released?.voucherCode) {
      await Voucher.findOneAndUpdate({ code: released.voucherCode }, { $inc: { usedCount: -1 } }, { session });
    }
  });
}
