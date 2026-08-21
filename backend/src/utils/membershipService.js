import crypto from "node:crypto";
import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import MembershipPlan from "../models/MembershipPlan.js";
import MembershipOrder from "../models/MembershipOrder.js";
import PaymentReceipt from "../models/PaymentReceipt.js";
import User from "../models/User.js";
import Voucher from "../models/Voucher.js";
import { approvedVoucherUseCount } from "./voucherCheckoutService.js";
import { synchronizeMarketplaceQuotaGrant } from "./marketplaceQuotaGrantService.js";
import { notifyMembershipApproved } from "./telegramNotifier.js";

export const DEFAULT_MEMBERSHIP_PLANS = [
  {
    code: "DAILY",
    name: "Daily Member",
    price: 50000,
    durationDays: 1,
    expiresEndOfDay: true,
    badge: "DAY",
    features: ["Add 100 downloads today", "Keep existing monthly Pro", "Member models"],
    sortOrder: 10,
  },
  {
    code: "SILVER",
    name: "Silver",
    price: 199000,
    durationDays: 30,
    expiresEndOfDay: true,
    badge: "MONTH",
    features: ["100 downloads/day", "Member models", "Fast download"],
    sortOrder: 20,
  },
  {
    code: "GOLD",
    name: "Gold",
    price: 149000 * 3,
    durationDays: 90,
    expiresEndOfDay: true,
    badge: "3 MONTHS",
    features: ["149k/month x 3 months", "100 downloads/day", "Pro models"],
    sortOrder: 30,
  },
  {
    code: "DIAMOND",
    name: "Diamond",
    price: 99000 * 12,
    durationDays: 365,
    expiresEndOfDay: true,
    badge: "12 MONTHS",
    features: ["99k/month x 12 months", "100 downloads/day", "Pro models"],
    sortOrder: 40,
  },
];

export function isProActive(user, at = new Date()) {
  const proUntil = user?.proUntil ? new Date(user.proUntil) : null;
  return Boolean(proUntil && proUntil > at);
}

export function membershipSnapshot(user, at = new Date()) {
  const active = isProActive(user, at);
  return {
    active,
    tier: active ? "pro" : "free",
    proUntil: user?.proUntil || null,
    dailyDownloadLimit: active ? Number(user?.proDailyDownloadLimit || 100) : 5,
  };
}

export function createMembershipPaymentCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = crypto
    .randomBytes(9)
    .toString("base64url")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return `PRO${stamp}${random}`.slice(0, 24);
}

export async function initializeMembershipPlans() {
  const syncDefaults = process.env.SYNC_DEFAULT_MEMBERSHIP_PLANS === "true";
  await Promise.all(
    DEFAULT_MEMBERSHIP_PLANS.map((plan) => {
      const defaults = {
        ...plan,
        tier: "member",
        dailyDownloadLimit: 100,
        isActive: true,
      };
      return MembershipPlan.findOneAndUpdate(
        { code: plan.code },
        syncDefaults ? { $set: defaults } : { $setOnInsert: defaults },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
    }),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const LATE_PAYMENT_REJECTION_REASONS = new Set(["expired", "user_cancel", "gateway_error"]);

async function execMaybeSession(queryOrPromise, session = null) {
  if (session && typeof queryOrPromise?.session === "function") {
    return queryOrPromise.session(session);
  }
  return queryOrPromise;
}

function vietnamDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10).split("-").map(Number);
}

export function vietnamDayKey(date = new Date()) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nextVietnamReset(date = new Date()) {
  const [year, month, day] = vietnamDayKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 17, 0, 0, 0));
}

export function endOfVietnamDay(date = new Date()) {
  const [year, month, day] = vietnamDateParts(date);
  return new Date(Date.UTC(year, month - 1, day, 16, 59, 59, 999));
}

export function normalizeProUntil(proUntil) {
  if (!proUntil) return null;
  const date = new Date(proUntil);
  if (Number.isNaN(date.valueOf())) return null;
  return endOfVietnamDay(date);
}

function isDailyPlan(order) {
  return String(order?.planCode || "").trim().toUpperCase() === "DAILY" ||
    Number(order?.durationDays || 0) <= 1;
}

function addMembershipTime(user, order) {
  const now = new Date();
  const currentUntil = user?.proUntil ? new Date(user.proUntil) : null;
  const base = currentUntil && currentUntil > now ? currentUntil : now;
  const durationDays = Math.max(1, Number(order.durationDays || 1));
  const target = isDailyPlan(order) ? now : new Date(base.getTime() + durationDays * DAY_MS);
  return endOfVietnamDay(target);
}

async function releaseVoucherCounter(code, session = null) {
  if (!code) return;
  await Voucher.findOneAndUpdate(
    { code },
    { $inc: { usedCount: -1 } },
    { new: true, session },
  );
}

async function claimMembershipVoucher(order, session = null) {
  const code = String(order?.voucherCode || "").trim().toUpperCase();
  if (!code) return false;

  const voucher = await Voucher.findOneAndUpdate(
    {
      code,
      expireAt: { $gt: new Date() },
      $expr: { $lt: ["$usedCount", "$usageLimit"] },
    },
    { $inc: { usedCount: 1 } },
    { new: true, session },
  );
  if (!voucher) {
    const error = new Error("Voucher đã hết hạn hoặc hết lượt dùng, không thể hoàn tất giao dịch.");
    error.status = 409;
    throw error;
  }

  const perUserLimit = Number(voucher.perUserLimit ?? 1);
  if (perUserLimit > 0) {
    const approvedByUser = await approvedVoucherUseCount(order.userId, code);
    if (approvedByUser >= perUserLimit) {
      await releaseVoucherCounter(code, session);
      const error = new Error("Tài khoản này đã đạt giới hạn sử dụng voucher.");
      error.status = 409;
      throw error;
    }
  }

  return true;
}

function approvableMembershipOrderQuery(order) {
  if (
    order?.status === "rejected" &&
    LATE_PAYMENT_REJECTION_REASONS.has(String(order.rejectionReason || ""))
  ) {
    return { _id: order._id, status: "rejected", rejectionReason: order.rejectionReason };
  }
  return { _id: order._id, status: "pending" };
}

async function claimMembershipPayment(order, approvalFields, session = null) {
  const gatewayTransactionId = String(approvalFields?.gatewayTransactionId || "").trim();
  if (!gatewayTransactionId) return null;
  const receipt = {
    gatewayTransactionId,
    provider: String(approvalFields?.gatewayProvider || order.gatewayProvider || ""),
    membershipOrderId: order._id,
    amount: Number(order.amount || 0),
  };
  try {
    if (!session) {
      const duplicate = await PaymentReceipt.findOne({
        $or: [{ gatewayTransactionId }, { membershipOrderId: order._id }],
      });
      if (duplicate) {
        const error = new Error("Gateway transaction has already been claimed.");
        error.code = "DUPLICATE_GATEWAY_TRANSACTION";
        error.status = 409;
        throw error;
      }
      return PaymentReceipt.create(receipt);
    }
    const [created] = await PaymentReceipt.create([receipt], { session });
    return created;
  } catch (error) {
    if (error?.code === 11000 || error?.code === "DUPLICATE_GATEWAY_TRANSACTION") {
      const duplicateError = new Error("Gateway transaction has already been claimed.");
      duplicateError.code = "DUPLICATE_GATEWAY_TRANSACTION";
      duplicateError.status = 409;
      throw duplicateError;
    }
    throw error;
  }
}

async function approveMembershipOrderWithSession(order, approvalFields = {}, session = null) {
  const current = await execMaybeSession(
    MembershipOrder.findOne(approvableMembershipOrderQuery(order)),
    session,
  );
  if (!current) return null;

  const user = await execMaybeSession(User.findById(current.userId), session);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const activatedUntil = addMembershipTime(user, current);
  const shouldBoostToday = isDailyPlan(current) && isProActive(user);
  let voucherClaimed = false;
  let approvedOrder = null;
  let paymentReceipt = null;
  try {
    voucherClaimed = await claimMembershipVoucher(current, session);
    approvedOrder = await MembershipOrder.findOneAndUpdate(
      approvableMembershipOrderQuery(current),
      {
        $set: {
          status: "approved",
          paidAt: new Date(),
          canceledAt: null,
          rejectionReason: "",
          activatedUntil: shouldBoostToday ? endOfVietnamDay(new Date()) : activatedUntil,
          isQuotaAddon: shouldBoostToday,
          quotaBoostAmount: shouldBoostToday ? Number(current.dailyDownloadLimit || 100) : 0,
          quotaBoostDayKey: shouldBoostToday ? vietnamDayKey() : "",
          quotaSyncStatus: shouldBoostToday ? "pending" : "not_required",
          quotaSyncedAt: null,
          quotaSyncError: "",
          ...approvalFields,
        },
      },
      { new: true, session },
    );
    if (!approvedOrder) {
      if (!session) {
        if (voucherClaimed) await releaseVoucherCounter(current.voucherCode);
      }
      return null;
    }

    paymentReceipt = await claimMembershipPayment(approvedOrder, approvalFields, session);

    const updatedUser = shouldBoostToday
      ? await execMaybeSession(User.findById(current.userId), session)
      : await User.findByIdAndUpdate(
        current.userId,
        {
          $set: {
            proUntil: activatedUntil,
            proPlanId: current.planId,
            proActivatedAt: new Date(),
            proDailyDownloadLimit: Number(current.dailyDownloadLimit || 100),
          },
        },
        { new: true, session },
      );
    if (!updatedUser) {
      const error = new Error("User not found while activating membership");
      error.status = 409;
      throw error;
    }
    return { order: approvedOrder, user: updatedUser };
  } catch (error) {
    if (!session) {
      if (paymentReceipt?._id) {
        await PaymentReceipt.findByIdAndDelete(paymentReceipt._id).catch(() => {});
      }
      if (approvedOrder) {
        await MembershipOrder.findOneAndUpdate(
          { _id: approvedOrder._id, status: "approved" },
          {
            $set: {
              status: current.status,
              paidAt: current.paidAt || null,
              canceledAt: current.canceledAt || null,
              rejectionReason: current.rejectionReason || "",
              gatewayProvider: current.gatewayProvider || "",
              gatewayTransactionId: current.gatewayTransactionId || "",
              gatewayPayload: current.gatewayPayload || null,
              activatedUntil: current.activatedUntil || null,
              isQuotaAddon: Boolean(current.isQuotaAddon),
              quotaBoostAmount: Number(current.quotaBoostAmount || 0),
              quotaBoostDayKey: current.quotaBoostDayKey || "",
              quotaSyncStatus: current.quotaSyncStatus || "not_required",
              quotaSyncedAt: current.quotaSyncedAt || null,
              quotaSyncError: current.quotaSyncError || "",
            },
          },
          { new: true },
        ).catch(() => {});
      }
      if (voucherClaimed) await releaseVoucherCounter(current.voucherCode);
    }
    throw error;
  }
}

function notifyMembershipApproval(result, approvalFields = {}) {
  if (!result) return;
  notifyMembershipApproved({
    order: result.order,
    user: result.user,
    source: approvalFields.gatewayTransactionId ? "Payment webhook" : "Admin",
  });
}

export async function approvePendingMembershipOrder(order, approvalFields = {}) {
  if (isMemoryDb()) {
    const result = await approveMembershipOrderWithSession(order, approvalFields);
    if (result?.order?.isQuotaAddon) {
      const synced = await synchronizeMarketplaceQuotaGrant(result.order);
      result.order = synced.order;
    }
    notifyMembershipApproval(result, approvalFields);
    return result;
  }
  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      result = await approveMembershipOrderWithSession(order, approvalFields, session);
    });
    if (result?.order?.isQuotaAddon) {
      try {
        const synced = await synchronizeMarketplaceQuotaGrant(result.order);
        result.order = synced.order;
      } catch (error) {
        // Payment approval is durable in Atlas. The retry worker will finish
        // the VPS quota grant without charging or applying it twice.
        result.order = error.order || result.order;
      }
    }
    notifyMembershipApproval(result, approvalFields);
    return result;
  } finally {
    await session.endSession();
  }
}
