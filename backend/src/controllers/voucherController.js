import Voucher from "../models/Voucher.js";
import {
  approvedVoucherUseCount,
  safeVoucherPayload,
  voucherApplicablePackageIds,
  voucherTargetKind,
} from "../utils/voucherCheckoutService.js";
import {
  isVoucherCode,
  isSafeId,
  normalizeVoucherCode,
  rejectUnknownKeys,
} from "../utils/validators.js";
import { voucherUnavailableMessage } from "../utils/voucherStatus.js";

export async function applyVoucher(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["code", "packageId", "target"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid voucher request" });
    }

    const code = normalizeVoucherCode(req.body.code);
    const packageId = String(req.body.packageId || "").trim();
    const target = String(req.body.target || "topup").trim().toLowerCase();
    if (!code || !isVoucherCode(code)) {
      return res.status(400).json({ message: "Voucher code is required" });
    }
    if (packageId && !isSafeId(packageId)) {
      return res.status(400).json({ message: "Invalid topup package" });
    }

    const voucher = await Voucher.findOne({ code }).lean();

    const unavailableMessage = voucherUnavailableMessage(voucher);
    if (unavailableMessage) {
      return res.status(400).json({ message: unavailableMessage });
    }

    const applicablePackageIds = Array.isArray(voucher.applicablePackageIds)
      ? voucher.applicablePackageIds.map((id) => String(id?._id || id))
      : [];
    const targetKindValue = voucherTargetKind(voucher);
    if (target !== "membership" && targetKindValue === "pro") {
      return res.status(400).json({
        message: "Voucher này chỉ áp dụng cho gói Pro.",
      });
    }
    if (target === "membership" && (targetKindValue === "credit" || applicablePackageIds.length > 0)) {
      return res.status(400).json({
        message: "Voucher này chỉ áp dụng cho gói Credit.",
      });
    }
    if (target === "membership" && Number(voucher.discountPercent || 0) <= 0) {
      return res.status(400).json({
        message: "Voucher này chỉ cộng Credit, không áp dụng cho Pro.",
      });
    }
    if (packageId && applicablePackageIds.length > 0 && !applicablePackageIds.includes(packageId)) {
      return res.status(400).json({
        message: "Voucher không áp dụng cho gói nạp này.",
      });
    }

    const perUserLimit = Number(voucher.perUserLimit ?? 1);
    let userVoucherUsed = 0;
    if (perUserLimit > 0) {
      userVoucherUsed = await approvedVoucherUseCount(req.user._id, voucher.code);
      if (userVoucherUsed >= perUserLimit) {
        return res.status(400).json({
          message: "Bạn đã đạt giới hạn sử dụng voucher này.",
        });
      }
    }

    // Chi tra cac field can thiet cho frontend, KHONG leak `usageLimit`, `usedCount`,
    // `_id`, `createdAt`. Tranh information disclosure cho atttacker biet trang thai voucher.
    const safeVoucher = {
      ...safeVoucherPayload(voucher),
      perUserRemaining:
        perUserLimit > 0 ? Math.max(0, perUserLimit - userVoucherUsed) : null,
      applicablePackageIds: voucherApplicablePackageIds(voucher),
    };

    res.json({
      credit: req.user.credit,
      voucher: safeVoucher,
      message:
        voucher.discountPercent > 0
          ? `Voucher giảm ${voucher.discountPercent}% sẽ áp dụng khi thanh toán SePay.`
          : `Voucher cộng thêm ${voucher.creditBonus} credit sẽ áp dụng khi giao dịch nạp thành công.`,
    });
  } catch (error) {
    next(error);
  }
}
