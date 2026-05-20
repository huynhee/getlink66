export function requireNotBanned(req, res, next) {
  if (!req.user?.isBanned) return next();

  return res.status(403).json({
    message:
      req.user.banReason ||
      "Tai khoan cua ban da bi ban va khong the su dung getlink.",
    banned: true,
    banReason: req.user.banReason || "",
  });
}
