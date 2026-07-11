export function voucherUnavailableMessage(voucher, now = new Date()) {
  if (!voucher) return "Mã voucher không tồn tại.";

  if (voucher.isActive === false) {
    return "Voucher đã ngừng hoạt động.";
  }

  const expireAt = new Date(voucher.expireAt);
  if (!Number.isFinite(expireAt.valueOf()) || expireAt <= now) {
    return "Voucher đã hết hạn.";
  }

  if (Number(voucher.usedCount || 0) >= Number(voucher.usageLimit || 0)) {
    return "Voucher đã hết lượt sử dụng.";
  }

  return "";
}
