import { securityEvent } from "../utils/logger.js";

export function adminOnly(req, res, next) {
  const adminEmailList = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);

  if (!adminEmailList.length) {
    return res.status(403).json({ message: "Admin access required" });
  }

  const adminEmails = new Set(adminEmailList);
  const userEmail = String(req.user?.email || "").toLowerCase();

  if (req.user?.role === "admin" && adminEmails.has(userEmail)) {
    if (req.user.isTwoFactorEnabled && !req.jwtPayload?.is2FAVerified) {
      securityEvent("ADMIN_2FA_REQUIRED", { email: userEmail, path: req.path });
      return res.status(403).json({ message: "2FA verification required", code: "2FA_REQUIRED" });
    }
    return next();
  }

  securityEvent("ADMIN_ACCESS_DENIED", { email: req.user?.email, path: req.path, method: req.method });
  res.status(403).json({ message: "Admin access required" });
}
