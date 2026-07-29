export function requireNotBanned(req, res, next) {
  if (!req.user?.isBanned) return next();

  return res.status(403).json({
    message:
      req.user.banReason ||
      "Tài khoản của bạn đã bị khóa và không thể sử dụng dịch vụ.",
    code: "ACCOUNT_BANNED",
    banned: true,
    banReason: req.user.banReason || "",
  });
}
