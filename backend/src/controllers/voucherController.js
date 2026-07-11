import Voucher from "../models/Voucher.js";
import {
  assertVoucherTarget,
  assertVoucherUserLimit,
  safeVoucherPayload,
  voucherApplicablePackageIds,
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
    if (!["topup", "membership"].includes(target)) {
      return res.status(400).json({ message: "Invalid voucher target" });
    }
    if (packageId && !isSafeId(packageId)) {
      return res.status(400).json({ message: "Invalid topup package" });
    }
    if (target === "membership" && packageId) {
      return res.status(400).json({ message: "Pro voucher does not accept a credit package" });
    }

    const voucher = await Voucher.findOne({ code }).lean();

    const unavailableMessage = voucherUnavailableMessage(voucher);
    if (unavailableMessage) {
      return res.status(400).json({ message: unavailableMessage });
    }

    assertVoucherTarget(voucher, { target, packageId });
    const userVoucherUsed = await assertVoucherUserLimit(voucher, req.user._id);
    const perUserLimit = Number(voucher.perUserLimit ?? 1);

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
          ? `Voucher ${target === "membership" ? "Pro" : "Credit"} giảm ${voucher.discountPercent}% sẽ áp dụng khi thanh toán SePay.`
          : `Voucher Credit cộng thêm ${voucher.creditBonus} credit khi giao dịch nạp thành công.`,
    });
  } catch (error) {
    next(error);
  }
}
