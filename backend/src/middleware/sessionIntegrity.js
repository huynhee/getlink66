import crypto from "node:crypto";
import { securityEvent } from "../utils/logger.js";
import { SESSION_EXPIRED_MESSAGE } from "../utils/authMessages.js";

/**
 * Generates a fingerprint from request IP + User-Agent to bind to session.
 * This detects session hijacking when the attacker uses a different browser/IP.
 */
function buildFingerprint(req) {
  return crypto
    .createHash("sha256")
    .update(`${req.ip || ""}|${req.get("user-agent") || ""}`)
    .digest("hex");
}

/**
 * Middleware: stamps the session with a fingerprint on first authenticated request.
 * On subsequent requests, verifies the fingerprint matches.
 * If mismatch → likely session hijack → destroy session.
 */
export function sessionIntegrity(req, res, next) {
  if (!req.session || !req.user) return next();

  const currentFingerprint = buildFingerprint(req);

  if (!req.session.fingerprint) {
    req.session.fingerprint = currentFingerprint;
    return next();
  }

  if (req.session.fingerprint !== currentFingerprint) {
    securityEvent("SESSION_HIJACK_SUSPECT", {
      userId: req.user._id,
      email: req.user.email,
      path: req.path,
      ip: req.ip
    });

    req.logout(() => {});
    req.session.destroy(() => {});
    return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE });
  }

  next();
}

/**
 * Call after successful OAuth callback to stamp the session fingerprint.
 */
export function stampSessionFingerprint(req) {
  if (req.session) {
    req.session.fingerprint = buildFingerprint(req);
  }
}
