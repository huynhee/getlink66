import crypto from "node:crypto";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import MembershipPlan from "../models/MembershipPlan.js";
import MembershipOrder from "../models/MembershipOrder.js";
import User from "../models/User.js";
import Voucher from "../models/Voucher.js";
import { approvedVoucherUseCount } from "./voucherCheckoutService.js";

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
    features: ["149k/month x 3 months", "100 downloads/day", "S-VIP access"],
    sortOrder: 30,
  },
  {
    code: "DIAMOND",
    name: "Diamond",
    price: 99000 * 12,
    durationDays: 365,
    expiresEndOfDay: true,
    badge: "12 MONTHS",
    features: ["99k/month x 12 months", "100 downloads/day", "S-VIP access"],
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
    tier: active ? "member" : user ? "free" : "guest",
    proUntil: user?.proUntil || null,
    dailyDownloadLimit: active ? Number(user?.proDailyDownloadLimit || 100) : 0,
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
  const count = await MembershipPlan.countDocuments({});
  if (count > 0 && process.env.SYNC_DEFAULT_MEMBERSHIP_PLANS === "false") return;
  await Promise.all(
    DEFAULT_MEMBERSHIP_PLANS.map((plan) =>
      MembershipPlan.findOneAndUpdate(
        { code: plan.code },
        {
          $set: {
            ...plan,
            tier: "member",
            dailyDownloadLimit: 100,
            isActive: true,
          },
        },
        { upsert: true, new: true },
      ),
    ),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

function vietnamDateParts(date = new Date()) {
  const shifted = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return shifted.toISOString().slice(0, 10).split("-").map(Number);
}

export function vietnamDayKey(date = new Date()) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function nextVietnamReset(date = new Date()) {
  const [year, month, day] = vietnamDayKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 17, 0, 0, 0));
}

function endOfVietnamDay(date = new Date()) {
  const [year, month, day] = vietnamDateParts(date);
  return new Date(Date.UTC(year, month - 1, day, 16, 59, 59, 999));
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

async function addDailyQuotaBoost(user, order) {
  const amount = Math.max(1, Number(order.dailyDownloadLimit || 100));
  const dayKey = vietnamDayKey();
  const resetAt = nextVietnamReset();
  return DailyDownloadQuota.findOneAndUpdate(
    {
      dayKey,
      userId: user._id,
      guestKey: "",
      tier: "member",
    },
    {
      $setOnInsert: {
        dayKey,
        userId: user._id,
        guestKey: "",
        tier: "member",
        resetAt,
      },
      $set: { resetAt },
      $inc: { bonusLimit: amount },
    },
    { upsert: true, new: true },
  );
}

async function releaseDailyQuotaBoost(user, order) {
  if (!user?._id) return;
  const amount = Math.max(1, Number(order.dailyDownloadLimit || 100));
  await DailyDownloadQuota.findOneAndUpdate(
    {
      dayKey: vietnamDayKey(),
      userId: user._id,
      guestKey: "",
      tier: "member",
    },
    { $inc: { bonusLimit: -amount } },
    { new: true },
  ).catch(() => {});
}

async function releaseVoucherCounter(code) {
  if (!code) return;
  await Voucher.findOneAndUpdate(
    { code },
    { $inc: { usedCount: -1 } },
    { new: true },
  );
}

async function claimMembershipVoucher(order) {
  const code = String(order?.voucherCode || "").trim().toUpperCase();
  if (!code) return false;

  const voucher = await Voucher.findOneAndUpdate(
    {
      code,
      expireAt: { $gt: new Date() },
      $expr: { $lt: ["$usedCount", "$usageLimit"] },
    },
    { $inc: { usedCount: 1 } },
    { new: true },
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
      await releaseVoucherCounter(code);
      const error = new Error("Tài khoản này đã đạt giới hạn sử dụng voucher.");
      error.status = 409;
      throw error;
    }
  }

  return true;
}

export async function approvePendingMembershipOrder(order, approvalFields = {}) {
  const current = await MembershipOrder.findOne({ _id: order._id, status: "pending" });
  if (!current) return null;

  const user = await User.findById(current.userId);
  if (!user) {
    const error = new Error("User not found");
    error.status = 404;
    throw error;
  }

  const activatedUntil = addMembershipTime(user, current);
  const shouldBoostToday = isDailyPlan(current) && isProActive(user);
  let voucherClaimed = false;
  let quotaBoosted = false;
  let approvedOrder = null;
  try {
    voucherClaimed = await claimMembershipVoucher(current);
    const quotaBoost = shouldBoostToday ? await addDailyQuotaBoost(user, current) : null;
    quotaBoosted = Boolean(quotaBoost);
    approvedOrder = await MembershipOrder.findOneAndUpdate(
      { _id: current._id, status: "pending" },
      {
        $set: {
          status: "approved",
          paidAt: new Date(),
          activatedUntil: shouldBoostToday ? endOfVietnamDay(new Date()) : activatedUntil,
          isQuotaAddon: shouldBoostToday,
          quotaBoostAmount: shouldBoostToday ? Number(current.dailyDownloadLimit || 100) : 0,
          quotaBoostDayKey: shouldBoostToday ? String(quotaBoost?.dayKey || vietnamDayKey()) : "",
          ...approvalFields,
        },
      },
      { new: true },
    );
  } catch (error) {
    if (quotaBoosted) await releaseDailyQuotaBoost(user, current);
    if (voucherClaimed) await releaseVoucherCounter(current.voucherCode);
    throw error;
  }
  if (!approvedOrder) {
    if (quotaBoosted) await releaseDailyQuotaBoost(user, current);
    if (voucherClaimed) await releaseVoucherCounter(current.voucherCode);
    return null;
  }

  const updatedUser = shouldBoostToday
    ? await User.findById(current.userId)
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
      { new: true },
    );

  return { order: approvedOrder, user: updatedUser };
}
