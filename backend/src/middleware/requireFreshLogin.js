import { securityEvent } from "../utils/logger.js";
import {
  FRESH_LOGIN_REQUIRED_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from "../utils/authMessages.js";

/**
 * Middleware bao ve cac hanh dong nhay cam (vd. enroll/disable 2FA, doi password).
 * Yeu cau JWT phai duoc cap moi (qua Google OAuth callback) trong vong `maxAgeSeconds`.
 *
 * Dua vao field `loginAt` trong JWT payload (set boi `generateTokens`, carry-over khi refresh).
 * Khong dung `iat` cua access token vi access token co the duoc refresh moi 15 phut.
 *
 * Muc dich: ngan ke chiem session JWT thuc hien account-takeover qua viec self-enroll 2FA.
 */
export function requireFreshLogin(maxAgeSeconds = 5 * 60) {
  return (req, res, next) => {
    if (!req.user || !req.jwtPayload) {
      return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE });
    }

    const loginAt = Number(req.jwtPayload.loginAt || 0);
    const ageSeconds = Math.floor(Date.now() / 1000) - loginAt;

    if (!loginAt || ageSeconds > maxAgeSeconds) {
      securityEvent("FRESH_LOGIN_REQUIRED", {
        userId: String(req.user._id),
        path: req.path,
        ageSeconds: loginAt ? ageSeconds : null
      });
      return res.status(401).json({
        message: FRESH_LOGIN_REQUIRED_MESSAGE,
        code: "FRESH_LOGIN_REQUIRED",
        maxAgeSeconds
      });
    }

    next();
  };
}
