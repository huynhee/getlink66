import passport from "passport";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { issueCsrfToken } from "../middleware/csrf.js";
import { generateTokens } from "../middleware/jwtAuth.js";
import User from "../models/User.js";
import { securityEvent } from "../utils/logger.js";

const SAFE_RETURN_PATH = /^\/[a-zA-Z0-9\-_/]*$/;

export function googleLogin(req, res, next) {
  const returnTo =
    typeof req.query.returnTo === "string" ? req.query.returnTo : "";
  if (returnTo.length <= 200 && SAFE_RETURN_PATH.test(returnTo)) {
    res.cookie("oauthReturnTo", returnTo, {
      maxAge: 10 * 60 * 1000,
      httpOnly: true,
    });
  }

  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
  })(req, res, next);
}

export const googleCallback = [
  passport.authenticate("google", { session: false, failureRedirect: "/" }),
  (req, res) => {
    generateTokens(req, res, req.user);
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const returnTo = req.cookies.oauthReturnTo || "/";
    res.clearCookie("oauthReturnTo");
    const safePath = SAFE_RETURN_PATH.test(returnTo) ? returnTo : "/";
    res.redirect(`${clientUrl}${safePath}`);
  },
];

export function logout(req, res, next) {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.json({ ok: true });
}

export function currentUser(req, res) {
  if (!req.user) return res.json({ user: null });

  // If user is admin and has 2FA enabled, but hasn't verified this session
  const requires2FA =
    req.user.role === "admin" &&
    req.user.isTwoFactorEnabled &&
    !req.jwtPayload?.is2FAVerified;

  const safeUser = {
    _id: req.user._id,
    name: req.user.name,
    email: req.user.email,
    avatar: req.user.avatar,
    role: req.user.role,
    credit: req.user.credit,
    isTwoFactorEnabled: req.user.isTwoFactorEnabled,
    requires2FA,
  };
  res.json({ user: safeUser });
}

export async function setup2FA(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ message: "Unauthorized" });
    if (req.user.isTwoFactorEnabled) {
      return res.status(400).json({ message: "2FA is already enabled" });
    }

    const secret = new OTPAuth.Secret({ size: 20 });
    const totp = new OTPAuth.TOTP({
      issuer: "3DiPL",
      label: req.user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: secret,
    });

    const uri = totp.toString();
    const qrCode = await QRCode.toDataURL(uri);

    res.cookie("temp2FASecret", secret.base32, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 10 * 60 * 1000,
    });
    res.json({ qrCode, secret: secret.base32 });
  } catch (error) {
    next(error);
  }
}

export async function verifyAndEnable2FA(req, res, next) {
  try {
    const { token } = req.body;
    const tempSecret = req.cookies.temp2FASecret;
    if (!token || !tempSecret) {
      return res
        .status(400)
        .json({ message: "Invalid request or session expired" });
    }

    const totp = new OTPAuth.TOTP({
      issuer: "3DiPL",
      label: req.user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(tempSecret),
    });

    const delta = totp.validate({ token, window: 1 });
    if (delta === null) {
      return res
        .status(400)
        .json({ message: "Mã OTP không hợp lệ hoặc đã hết hạn" });
    }

    // Save to user
    await User.findByIdAndUpdate(req.user._id, {
      twoFactorSecret: tempSecret,
      isTwoFactorEnabled: true,
    });

    // Audit trail: 2FA enrollment la hanh dong nhay cam co the dung de takeover account.
    // Phai log de admin co the truy vet neu bi enroll trai phep.
    securityEvent("2FA_ENROLLED", {
      userId: String(req.user._id),
      email: req.user.email,
      role: req.user.role,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    res.clearCookie("temp2FASecret");
    generateTokens(req, res, req.user, true);

    res.json({ message: "2FA enabled successfully" });
  } catch (error) {
    next(error);
  }
}

export async function verify2FALogin(req, res, next) {
  try {
    const { token } = req.body;
    if (!req.user || !req.user.isTwoFactorEnabled) {
      return res
        .status(400)
        .json({ message: "2FA is not enabled for this account" });
    }

    const totp = new OTPAuth.TOTP({
      issuer: "3DiPL",
      label: req.user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(req.user.twoFactorSecret),
    });

    const delta = totp.validate({ token, window: 1 });
    if (delta === null) {
      securityEvent("2FA_VERIFY_FAILED", {
        userId: String(req.user._id),
        email: req.user.email,
        ip: req.ip,
      });
      return res.status(400).json({ message: "Mã OTP không hợp lệ" });
    }

    generateTokens(req, res, req.user, true);
    res.json({ ok: true, message: "2FA verified" });
  } catch (error) {
    next(error);
  }
}

export const csrfToken = issueCsrfToken;
