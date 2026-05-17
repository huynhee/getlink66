import jwt from "jsonwebtoken";
import User from "../models/User.js";
import crypto from "node:crypto";
import { securityEvent } from "../utils/logger.js";

function buildFingerprint(req) {
  return crypto
    .createHash("sha256")
    .update(`${req.ip || ""}|${req.get("user-agent") || ""}`)
    .digest("hex");
}

export async function jwtAuth(req, res, next) {
  const { accessToken, refreshToken } = req.cookies;

  if (!accessToken && !refreshToken) {
    return next();
  }

  let payload;
  try {
    if (accessToken) {
      payload = jwt.verify(accessToken, process.env.SESSION_SECRET);
    } else {
      payload = jwt.verify(refreshToken, process.env.SESSION_SECRET);
      // Issue new access token. Carry-over `loginAt` tu refresh token de fresh-login check
      // van phan biet duoc thoi diem dang nhap that vs lan refresh access token.
      const newAccessToken = jwt.sign(
        {
          id: payload.id,
          is2FAVerified: payload.is2FAVerified,
          fp: payload.fp,
          loginAt: payload.loginAt,
        },
        process.env.SESSION_SECRET,
        { expiresIn: "15m" },
      );
      res.cookie("accessToken", newAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 15 * 60 * 1000,
      });
    }

    // Verify fingerprint (Anti Hijacking)
    const currentFingerprint = buildFingerprint(req);
    if (payload.fp && payload.fp !== currentFingerprint) {
      securityEvent("SESSION_HIJACK_SUSPECT", {
        userId: payload.id,
        path: req.path,
        ip: req.ip,
      });
      res.clearCookie("accessToken");
      res.clearCookie("refreshToken");
      return res
        .status(401)
        .json({ message: "Session expired due to security violation." });
    }

    req.user = await User.findById(payload.id);
    req.jwtPayload = payload;

    // Polyfill req.isAuthenticated() for existing middleware
    req.isAuthenticated = () => Boolean(req.user);

    return next();
  } catch (error) {
    res.clearCookie("accessToken");
    res.clearCookie("refreshToken");
    return next();
  }
}

export function generateTokens(req, res, user, is2FAVerified = false) {
  const fp = buildFingerprint(req);
  // `loginAt`: thoi diem dang nhap that (Google OAuth callback hoac 2FA verify).
  // Carry-over khi refresh access token, dung cho `requireFreshLogin` middleware.
  const loginAt = Math.floor(Date.now() / 1000);
  const payload = { id: user._id, is2FAVerified, fp, loginAt };

  const accessToken = jwt.sign(payload, process.env.SESSION_SECRET, {
    expiresIn: "15m",
  });
  const refreshToken = jwt.sign(payload, process.env.SESSION_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
