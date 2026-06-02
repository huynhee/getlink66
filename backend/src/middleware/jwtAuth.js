import jwt from "jsonwebtoken";
import User from "../models/User.js";
import crypto from "node:crypto";
import { jwtSecret } from "../config/secrets.js";
import { securityEvent } from "../utils/logger.js";
import { SESSION_EXPIRED_MESSAGE } from "../utils/authMessages.js";

function shouldBindFingerprintToIp() {
  return process.env.SESSION_FINGERPRINT_BIND_IP === "true";
}

function shouldEnforceFingerprint() {
  return process.env.SESSION_FINGERPRINT_ENFORCE === "true";
}

function buildFingerprint(req, { bindIp = shouldBindFingerprintToIp() } = {}) {
  const ip = bindIp ? `${req.ip || ""}|` : "";
  return crypto
    .createHash("sha256")
    .update(`${ip}${req.get("user-agent") || ""}`)
    .digest("hex");
}

function isValidFingerprint(req, fingerprint) {
  if (!fingerprint) return true;
  if (fingerprint === buildFingerprint(req)) return true;

  // JWTs issued before IP binding became optional remain valid until expiry.
  return (
    !shouldBindFingerprintToIp() &&
    fingerprint === buildFingerprint(req, { bindIp: true })
  );
}

function clearAuthCookies(res) {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
}

function tokenPayload(payload, tokenType, fp = payload.fp) {
  return {
    id: payload.id,
    is2FAVerified: payload.is2FAVerified,
    fp,
    loginAt: payload.loginAt,
    tokenType,
  };
}

function signAccessToken(payload, fp) {
  return jwt.sign(tokenPayload(payload, "access", fp), jwtSecret(), {
    expiresIn: "15m",
  });
}

function signRefreshToken(payload, fp) {
  return jwt.sign(tokenPayload(payload, "refresh", fp), jwtSecret(), {
    expiresIn: "7d",
  });
}

function setAccessTokenCookie(res, accessToken) {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
  });
}

function setRefreshTokenCookie(res, refreshToken) {
  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}

function verifyToken(token, expectedType) {
  if (!token) return null;
  const payload = jwt.verify(token, jwtSecret());

  // Tokens issued before tokenType was added remain valid until expiry.
  if (payload.tokenType && payload.tokenType !== expectedType) {
    throw new jwt.JsonWebTokenError(`Invalid ${expectedType} token`);
  }

  return payload;
}

export async function jwtAuth(req, res, next) {
  const { accessToken, refreshToken } = req.cookies;

  if (!accessToken && !refreshToken) {
    return next();
  }

  let payload = null;
  let shouldRotateTokens = false;
  try {
    if (accessToken) {
      try {
        payload = verifyToken(accessToken, "access");
      } catch (error) {
        if (!(error instanceof jwt.JsonWebTokenError)) throw error;
      }
    }

    if (!payload && refreshToken) {
      payload = verifyToken(refreshToken, "refresh");
      shouldRotateTokens = true;
    }

    if (!payload) {
      clearAuthCookies(res);
      return next();
    }

    // Verify fingerprint (Anti Hijacking)
    if (!isValidFingerprint(req, payload.fp)) {
      const enforceFingerprint = shouldEnforceFingerprint();
      securityEvent(
        enforceFingerprint
          ? "SESSION_HIJACK_SUSPECT"
          : "SESSION_FINGERPRINT_CHANGED",
        {
        userId: payload.id,
        path: req.path,
        ip: req.ip,
        },
      );

      if (enforceFingerprint) {
        clearAuthCookies(res);
        return res
          .status(401)
          .json({ message: SESSION_EXPIRED_MESSAGE });
      }

      shouldRotateTokens = true;
    }

    if (shouldRotateTokens) {
      const fp = buildFingerprint(req);
      setAccessTokenCookie(res, signAccessToken(payload, fp));
      setRefreshTokenCookie(res, signRefreshToken(payload, fp));
    }

    req.user = await User.findById(payload.id);
    if (!req.user) {
      clearAuthCookies(res);
      return next();
    }
    req.jwtPayload = payload;

    // Polyfill req.isAuthenticated() for existing middleware
    req.isAuthenticated = () => Boolean(req.user);

    return next();
  } catch (error) {
    if (error instanceof jwt.JsonWebTokenError) {
      clearAuthCookies(res);
      return next();
    }
    return next(error);
  }
}

export function generateTokens(req, res, user, is2FAVerified = false) {
  const fp = buildFingerprint(req);
  // `loginAt`: thoi diem dang nhap that (Google OAuth callback hoac 2FA verify).
  // Carry-over khi refresh access token, dung cho `requireFreshLogin` middleware.
  const loginAt = Math.floor(Date.now() / 1000);
  const payload = { id: user._id, is2FAVerified, fp, loginAt };

  setAccessTokenCookie(res, signAccessToken(payload, fp));
  setRefreshTokenCookie(res, signRefreshToken(payload, fp));
}
