import MembershipPlan from "../models/MembershipPlan.js";
import MembershipOrder from "../models/MembershipOrder.js";
import { assertSepayConfigured, createMembershipSepayCheckout } from "../utils/sepay.js";
import {
  assertVoucherTarget,
  assertVoucherUserLimit,
  findCheckoutVoucher,
  safeVoucherPayload,
} from "../utils/voucherCheckoutService.js";
import {
  approvePendingMembershipOrder,
  createMembershipPaymentCode,
  membershipSnapshot,
} from "../utils/membershipService.js";
import { isSafeId, isVoucherCode, normalizeVoucherCode, rejectUnknownKeys } from "../utils/validators.js";

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9._:-]{16,128}$/;

function sortPlans(plans = []) {
  return [...plans].sort((a, b) =>
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
    || Number(a.price || 0) - Number(b.price || 0)
    || String(a.name || "").localeCompare(String(b.name || ""))
    || String(a._id || "").localeCompare(String(b._id || "")));
}

export async function listMembershipPlans(_req, res, next) {
  try {
    const plans = await MembershipPlan.find({ isActive: true }).lean();
    res.json({ plans: sortPlans(plans) });
  } catch (error) {
    next(error);
  }
}

export function membershipMe(req, res) {
  res.json({ membership: membershipSnapshot(req.user) });
}

function isSameMembershipCheckout(order, plan, voucherCode) {
  return String(order?.planId?._id || order?.planId) === String(plan?._id) &&
    String(order?.voucherCode || "") === String(voucherCode || "");
}

async function freeMembershipCheckoutResponse(order, user, { idempotentReplay = false } = {}) {
  let approvedOrder = order;
  let approvedUser = user;
  if (order.status === "pending") {
    const result = await approvePendingMembershipOrder(order, {
      gatewayProvider: "internal_free",
    });
    if (result?.order) approvedOrder = result.order;
    if (result?.user) approvedUser = result.user;
  }
  if (approvedOrder.status !== "approved") {
    const error = new Error("Cannot activate free membership plan");
    error.status = 409;
    throw error;
  }
  return {
    order: approvedOrder,
    payment: null,
    status: approvedOrder.status,
    membership: membershipSnapshot(approvedUser),
    voucher: null,
    idempotentReplay,
  };
}

async function existingMembershipCheckoutResponse(existing, user, plan) {
  if (Number(existing.amount || 0) === 0) {
    return freeMembershipCheckoutResponse(existing, user, { idempotentReplay: true });
  }
  const payment = existing.status === "approved"
    ? null
    : createMembershipSepayCheckout({ order: existing, user, plan });
  return {
    order: existing,
    payment,
    status: existing.status,
    membership: membershipSnapshot(user),
    voucher: null,
    idempotentReplay: true,
  };
}

export async function createMembershipCheckout(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["planId", "voucherCode"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid membership checkout request" });
    const planId = String(req.body.planId || "");
    const idempotencyKey = String(req.get("idempotency-key") || "").trim();
    const normalizedVoucherCode = normalizeVoucherCode(req.body.voucherCode);
    if (!isSafeId(planId)) return res.status(400).json({ message: "Invalid membership plan" });
    if (normalizedVoucherCode && !isVoucherCode(normalizedVoucherCode)) {
      return res.status(400).json({ message: "Invalid voucher code" });
    }
    if (idempotencyKey && !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return res.status(400).json({ message: "Invalid idempotency key" });
    }
    const plan = await MembershipPlan.findById(planId);
    if (!plan || plan.isActive === false) {
      return res.status(400).json({ message: "Invalid membership plan" });
    }
    const originalAmount = Number(plan.price || 0);
    // A free plan must not consume a voucher or enter the payment gateway.
    const checkoutVoucherCode = originalAmount > 0 ? normalizedVoucherCode : "";
    if (idempotencyKey) {
      const existing = await MembershipOrder.findOne({ userId: req.user._id, idempotencyKey });
      if (existing) {
        if (!isSameMembershipCheckout(existing, plan, checkoutVoucherCode)) {
          return res.status(409).json({
            message: "Idempotency key was already used for another membership request",
          });
        }
        return res.json(await existingMembershipCheckoutResponse(existing, req.user, plan));
      }
    }
    const maxPurchasesPerUser = Number(plan.maxPurchasesPerUser || 0);
    if (Number.isFinite(maxPurchasesPerUser) && maxPurchasesPerUser > 0) {
      const usedPurchases = await MembershipOrder.countDocuments({
        userId: req.user._id,
        planId: plan._id,
        status: { $in: ["pending", "approved"] },
      });
      if (usedPurchases >= maxPurchasesPerUser) {
        return res.status(409).json({
          code: "MEMBERSHIP_PLAN_PURCHASE_LIMIT_REACHED",
          message: `Tài khoản đã đạt giới hạn mua gói Pro này (${maxPurchasesPerUser} lần).`,
          limit: maxPurchasesPerUser,
          used: usedPurchases,
        });
      }
    }
    let discountAmount = 0;
    let voucher = null;
    if (checkoutVoucherCode) {
      voucher = await findCheckoutVoucher(checkoutVoucherCode);
      assertVoucherTarget(voucher, { target: "membership" });
      await assertVoucherUserLimit(voucher, req.user._id);
      discountAmount = Math.min(
        originalAmount,
        Math.round((originalAmount * Number(voucher.discountPercent || 0)) / 100),
      );
    }
    const amount = Math.max(0, originalAmount - discountAmount);
    if (amount > 0) assertSepayConfigured();
    const paymentCode = createMembershipPaymentCode();
    let order;
    try {
      order = await MembershipOrder.create({
        userId: req.user._id,
        planId: plan._id,
        planCode: plan.code,
        planName: plan.name,
        originalAmount,
        discountAmount,
        voucherCode: voucher?.code || "",
        voucherDiscountPercent: Number(voucher?.discountPercent || 0),
        amount,
        durationDays: Number(plan.durationDays || 1),
        expiresEndOfDay: true,
        dailyDownloadLimit: Number(plan.dailyDownloadLimit || 100),
        status: "pending",
        paymentCode,
        gatewayProvider: amount === 0 ? "internal_free" : "sepay",
        expiresAt: amount === 0 ? undefined : new Date(Date.now() + 30 * 60 * 1000),
        idempotencyKey: idempotencyKey || undefined,
      });
    } catch (error) {
      if (error?.code === 11000 && idempotencyKey) {
        const existing = await MembershipOrder.findOne({ userId: req.user._id, idempotencyKey });
        if (existing) {
          if (!isSameMembershipCheckout(existing, plan, checkoutVoucherCode)) {
            return res.status(409).json({
              message: "Idempotency key was already used for another membership request",
            });
          }
          return res.json(await existingMembershipCheckoutResponse(existing, req.user, plan));
        }
      }
      throw error;
    }
    if (amount === 0) {
      return res.json(await freeMembershipCheckoutResponse(order, req.user));
    }
    const payment = createMembershipSepayCheckout({ order, user: req.user, plan });
    const updatedOrder = await MembershipOrder.findByIdAndUpdate(
      order._id,
      { checkoutUrl: payment.checkoutUrl },
      { new: true },
    );
    res.json({
      order: updatedOrder,
      payment,
      status: updatedOrder.status,
      membership: membershipSnapshot(req.user),
      voucher: voucher ? safeVoucherPayload(voucher) : null,
      idempotentReplay: false,
    });
  } catch (error) {
    if (error?.code === 11000) {
      // Extremely rare CSPRNG collision. Let the user retry instead of risking an ambiguous order.
      return res.status(503).json({ message: "Cannot create unique payment code. Please retry." });
    }
    next(error);
  }
}

export async function membershipOrderStatus(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    const order = await MembershipOrder.findOne({ _id: req.params.id, userId: req.user._id })
      .select("status amount originalAmount discountAmount voucherCode voucherDiscountPercent isQuotaAddon quotaBoostAmount quotaBoostDayKey paymentCode paidAt canceledAt rejectionReason activatedUntil createdAt updatedAt")
      .lean();
    if (!order) return res.status(404).json({ message: "Membership order not found" });
    res.json({ order, status: order.status, membership: membershipSnapshot(req.user) });
  } catch (error) {
    next(error);
  }
}

export async function cancelMembershipOrder(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid order id" });
    const order = await MembershipOrder.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id, status: "pending" },
      {
        $set: {
          status: "rejected",
          canceledAt: new Date(),
          rejectionReason: "user_cancel",
        },
      },
      { new: true },
    );
    if (!order) {
      const existing = await MembershipOrder.findOne({ _id: req.params.id, userId: req.user._id });
      if (!existing) return res.status(404).json({ message: "Membership order not found" });
      return res.json({ order: existing, status: existing.status, membership: membershipSnapshot(req.user) });
    }
    res.json({ order, status: order.status, membership: membershipSnapshot(req.user) });
  } catch (error) {
    next(error);
  }
}
