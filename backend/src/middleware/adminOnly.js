import { securityEvent } from "../utils/logger.js";

export function adminTwoFactorRequired() {
  if (process.env.ADMIN_2FA_REQUIRED !== undefined) {
    return process.env.ADMIN_2FA_REQUIRED === "true";
  }
  return process.env.NODE_ENV === "production";
}

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
    if (adminTwoFactorRequired() && !req.user.isTwoFactorEnabled) {
      securityEvent("ADMIN_2FA_SETUP_REQUIRED", { email: userEmail, path: req.path });
      return res.status(403).json({
        message: "Admin two-factor authentication must be enabled",
        code: "2FA_SETUP_REQUIRED",
      });
    }
    if (req.user.isTwoFactorEnabled && !req.jwtPayload?.is2FAVerified) {
      securityEvent("ADMIN_2FA_REQUIRED", { email: userEmail, path: req.path });
      return res.status(403).json({ message: "2FA verification required", code: "2FA_REQUIRED" });
    }
    return next();
  }

  securityEvent("ADMIN_ACCESS_DENIED", { email: req.user?.email, path: req.path, method: req.method });
  res.status(403).json({ message: "Admin access required" });
}
