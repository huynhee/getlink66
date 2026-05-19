import Voucher from "../models/Voucher.js";
import Topup from "../models/Topup.js";
import {
  isVoucherCode,
  isSafeId,
  normalizeVoucherCode,
  rejectUnknownKeys,
} from "../utils/validators.js";

export async function applyVoucher(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["code", "packageId"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid voucher request" });
    }

    const code = normalizeVoucherCode(req.body.code);
    const packageId = String(req.body.packageId || "").trim();
    if (!code || !isVoucherCode(code)) {
      return res.status(400).json({ message: "Voucher code is required" });
    }
    if (packageId && !isSafeId(packageId)) {
      return res.status(400).json({ message: "Invalid topup package" });
    }

    const voucher = await Voucher.findOne({
      code,
      expireAt: { $gt: new Date() },
      $expr: { $lt: ["$usedCount", "$usageLimit"] },
    }).lean();

    if (!voucher) {
      return res
        .status(400)
        .json({ message: "Voucher is invalid, expired, or fully used" });
    }

    const applicablePackageIds = Array.isArray(voucher.applicablePackageIds)
      ? voucher.applicablePackageIds.map((id) => String(id?._id || id))
      : [];
    if (packageId && applicablePackageIds.length > 0 && !applicablePackageIds.includes(packageId)) {
      return res.status(400).json({
        message: "Voucher khong ap dung cho goi nap nay.",
      });
    }

    const perUserLimit = Number(voucher.perUserLimit ?? 1);
    let userVoucherUsed = 0;
    if (perUserLimit > 0) {
      userVoucherUsed = await Topup.countDocuments({
        userId: req.user._id,
        voucherCode: voucher.code,
        status: "approved",
      });
      if (userVoucherUsed >= perUserLimit) {
        return res.status(400).json({
          message: "Ban da dat gioi han su dung voucher nay.",
        });
      }
    }

    // Chi tra cac field can thiet cho frontend, KHONG leak `usageLimit`, `usedCount`,
    // `_id`, `createdAt`. Tranh information disclosure cho atttacker biet trang thai voucher.
    const safeVoucher = {
      code: voucher.code,
      description: voucher.description || "",
      creditBonus: Number(voucher.creditBonus || 0),
      discountPercent: Number(voucher.discountPercent || 0),
      expireAt: voucher.expireAt,
      perUserRemaining:
        perUserLimit > 0 ? Math.max(0, perUserLimit - userVoucherUsed) : null,
      applicablePackageIds,
    };

    res.json({
      credit: req.user.credit,
      voucher: safeVoucher,
      message:
        voucher.discountPercent > 0
          ? `Voucher giam ${voucher.discountPercent}% se ap dung khi thanh toan Sepay.`
          : `Voucher cong them ${voucher.creditBonus} credit se ap dung khi giao dich nap duoc duyet.`,
    });
  } catch (error) {
    next(error);
  }
}
