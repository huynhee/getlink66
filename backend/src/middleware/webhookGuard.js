import { securityEvent } from "../utils/logger.js";

/**
 * Middleware to restrict webhook access to specific IP addresses.
 *
 * Cau hinh:
 * - `VIETQR_WEBHOOK_IPS` (comma-separated): danh sach IP duoc phep.
 * - `VIETQR_WEBHOOK_REQUIRE_IP_ALLOWLIST=true`: bat fail-closed mode. Neu env IPS rong
 *   thi reject moi webhook (nen bat trong production de tranh accidental misconfig).
 *
 * Default (backward compat): neu IPS rong va REQUIRE flag khong bat -> cho phep tat ca,
 * van con HMAC secret check o controller bao ve.
 */
export function webhookIpGuard(req, res, next) {
  const allowedRaw = String(process.env.VIETQR_WEBHOOK_IPS || "").trim();
  const requireAllowlist =
    process.env.VIETQR_WEBHOOK_REQUIRE_IP_ALLOWLIST === "true";

  if (!allowedRaw) {
    if (requireAllowlist) {
      securityEvent("WEBHOOK_IP_GUARD_NOT_CONFIGURED", {
        ip: req.ip,
        path: req.path,
        env: process.env.NODE_ENV,
      });
      return res.status(503).json({ message: "Webhook configuration error" });
    }
    return next();
  }

  const allowedIps = new Set(
    allowedRaw
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );

  const clientIp = String(req.ip || req.socket?.remoteAddress || "").replace(
    /^::ffff:/,
    "",
  );

  if (!allowedIps.has(clientIp)) {
    securityEvent("WEBHOOK_IP_BLOCKED", {
      ip: clientIp,
      path: req.path,
      allowedCount: allowedIps.size,
    });
    return res.status(403).json({ message: "Forbidden" });
  }

  next();
}
