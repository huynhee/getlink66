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
  createMembershipPaymentCode,
  membershipSnapshot,
} from "../utils/membershipService.js";
import { isSafeId, isVoucherCode, normalizeVoucherCode, rejectUnknownKeys } from "../utils/validators.js";

function sortPlans(plans = []) {
  return [...plans].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
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
  res.json({ membership: membershipSnapshot(req.user), user: req.user || null });
}

export async function createMembershipCheckout(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["planId", "voucherCode"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid membership checkout request" });
    const planId = String(req.body.planId || "");
    const normalizedVoucherCode = normalizeVoucherCode(req.body.voucherCode);
    if (!isSafeId(planId)) return res.status(400).json({ message: "Invalid membership plan" });
    if (normalizedVoucherCode && !isVoucherCode(normalizedVoucherCode)) {
      return res.status(400).json({ message: "Invalid voucher code" });
    }
    assertSepayConfigured();
    const plan = await MembershipPlan.findById(planId);
    if (!plan || plan.isActive === false) {
      return res.status(400).json({ message: "Invalid membership plan" });
    }
    const originalAmount = Number(plan.price || 0);
    let discountAmount = 0;
    let voucher = null;
    if (normalizedVoucherCode) {
      voucher = await findCheckoutVoucher(normalizedVoucherCode);
      assertVoucherTarget(voucher, { target: "membership" });
      await assertVoucherUserLimit(voucher, req.user._id);
      discountAmount = Math.min(
        originalAmount,
        Math.round((originalAmount * Number(voucher.discountPercent || 0)) / 100),
      );
    }
    const amount = Math.max(0, originalAmount - discountAmount);
    const paymentCode = createMembershipPaymentCode();
    const order = await MembershipOrder.create({
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
      gatewayProvider: "sepay",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    const payment = createMembershipSepayCheckout({ order, user: req.user, plan });
    const updatedOrder = await MembershipOrder.findByIdAndUpdate(
      order._id,
      { checkoutUrl: payment.checkoutUrl },
      { new: true },
    );
    res.json({ order: updatedOrder, payment, status: updatedOrder.status, voucher: voucher ? safeVoucherPayload(voucher) : null });
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
