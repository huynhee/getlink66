import MembershipOrder from "../models/MembershipOrder.js";
import Topup from "../models/Topup.js";
import Voucher from "../models/Voucher.js";
import { voucherUnavailableMessage } from "./voucherStatus.js";

function checkoutError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function voucherApplicablePackageIds(voucher) {
  return Array.isArray(voucher?.applicablePackageIds)
    ? voucher.applicablePackageIds.map((id) => String(id?._id || id))
    : [];
}

export async function approvedVoucherUseCount(userId, code) {
  const normalizedCode = String(code || "").trim().toUpperCase();
  if (!userId || !normalizedCode) return 0;
  const [topupCount, membershipCount] = await Promise.all([
    Topup.countDocuments({
      userId,
      voucherCode: normalizedCode,
      status: "approved",
    }),
    MembershipOrder.countDocuments({
      userId,
      voucherCode: normalizedCode,
      status: "approved",
    }),
  ]);
  return Number(topupCount || 0) + Number(membershipCount || 0);
}

export async function findCheckoutVoucher(code) {
  const voucher = await Voucher.findOne({ code });
  const unavailableMessage = voucherUnavailableMessage(voucher);
  if (unavailableMessage) throw checkoutError(unavailableMessage);
  return voucher;
}

export function assertVoucherTarget(voucher, { target = "topup", packageId = "" } = {}) {
  const applicablePackageIds = voucherApplicablePackageIds(voucher);
  if (target === "membership") {
    if (applicablePackageIds.length > 0) {
      throw checkoutError("Voucher này chỉ áp dụng cho gói Credit.");
    }
    if (Number(voucher?.discountPercent || 0) <= 0) {
      throw checkoutError("Voucher này chỉ cộng Credit, không áp dụng cho Pro.");
    }
    return;
  }

  if (
    packageId &&
    applicablePackageIds.length > 0 &&
    !applicablePackageIds.includes(String(packageId))
  ) {
    throw checkoutError("Voucher không áp dụng cho gói nạp này.");
  }
}

export async function assertVoucherUserLimit(voucher, userId) {
  const perUserLimit = Number(voucher?.perUserLimit ?? 1);
  if (perUserLimit <= 0) return;
  const userVoucherUsed = await approvedVoucherUseCount(userId, voucher.code);
  if (userVoucherUsed >= perUserLimit) {
    throw checkoutError("Bạn đã đạt giới hạn sử dụng voucher này.");
  }
}

export function safeVoucherPayload(voucher) {
  const applicablePackageIds = voucherApplicablePackageIds(voucher);
  return {
    code: voucher.code,
    description: voucher.description || "",
    creditBonus: Number(voucher.creditBonus || 0),
    discountPercent: Number(voucher.discountPercent || 0),
    expireAt: voucher.expireAt,
    applicablePackageIds,
    appliesToMembership: applicablePackageIds.length === 0 && Number(voucher.discountPercent || 0) > 0,
  };
}
