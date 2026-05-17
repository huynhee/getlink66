import Voucher from "../models/Voucher.js";
import {
  isVoucherCode,
  normalizeVoucherCode,
  rejectUnknownKeys,
} from "../utils/validators.js";

export async function applyVoucher(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["code"]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid voucher request" });
    }

    const code = normalizeVoucherCode(req.body.code);
    if (!code || !isVoucherCode(code)) {
      return res.status(400).json({ message: "Voucher code is required" });
    }

    const voucher = await Voucher.findOne({
      code,
      expireAt: { $gt: new Date() },
      $expr: { $lt: ["$usedCount", "$usageLimit"] },
    });

    if (!voucher) {
      return res
        .status(400)
        .json({ message: "Voucher is invalid, expired, or fully used" });
    }

    // Chi tra cac field can thiet cho frontend, KHONG leak `usageLimit`, `usedCount`,
    // `_id`, `createdAt`. Tranh information disclosure cho atttacker biet trang thai voucher.
    const safeVoucher = {
      code: voucher.code,
      description: voucher.description || "",
      creditBonus: Number(voucher.creditBonus || 0),
      discountPercent: Number(voucher.discountPercent || 0),
      expireAt: voucher.expireAt,
    };

    res.json({
      credit: req.user.credit,
      voucher: safeVoucher,
      message:
        voucher.discountPercent > 0
          ? `Voucher giam ${voucher.discountPercent}% se ap dung khi tao ma VietQR.`
          : `Voucher cong them ${voucher.creditBonus} credit se ap dung khi giao dich nap duoc duyet.`,
    });
  } catch (error) {
    next(error);
  }
}
