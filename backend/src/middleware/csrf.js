import crypto from "node:crypto";
import { csrfHmacSecret } from "../config/secrets.js";
import { securityEvent } from "../utils/logger.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const CSRF_SKIP_PATHS = new Set([
  "/api/auth/csrf",
  "/api/payments/vietqr/webhook",
  "/api/payments/sepay/ipn"
]);

function ensureToken(req, res) {
  let secret = req.cookies?.csrfSecret;
  if (!secret) {
    secret = crypto.randomBytes(32).toString("base64url");
    if (res && res.cookie) {
      res.cookie("csrfSecret", secret, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    }
  }
  return crypto.createHmac("sha256", csrfHmacSecret()).update(secret).digest("base64url");
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function issueCsrfToken(req, res) {
  res.json({ csrfToken: ensureToken(req, res) });
}

export function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method) || CSRF_SKIP_PATHS.has(req.path)) {
    ensureToken(req, res);
    return next();
  }

  const expected = ensureToken(req, res);
  const received = req.get("x-csrf-token") || "";
  if (!expected || !received || !safeEqual(expected, received)) {
    securityEvent("CSRF_TOKEN_INVALID", { ip: req.ip, path: req.path, method: req.method });
    return res.status(403).json({ message: "Invalid CSRF token" });
  }

  return next();
}
