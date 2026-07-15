import passport from "passport";
import crypto from "node:crypto";
import * as OTPAuth from "otpauth";
import QRCode from "qrcode";
import { issueCsrfToken } from "../middleware/csrf.js";
import { generateTokens } from "../middleware/jwtAuth.js";
import User from "../models/User.js";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import { securityEvent } from "../utils/logger.js";
import { SESSION_EXPIRED_MESSAGE } from "../utils/authMessages.js";
import { decryptSecret, encryptSecret } from "../utils/secretBox.js";
import { endOfVietnamDay, normalizeProUntil } from "../utils/membershipService.js";

const SAFE_RETURN_PATH = /^\/[a-zA-Z0-9\-_/]*(?:\?[a-zA-Z0-9._~%=&-]*)?$/;
const SAFE_REFERRAL_CODE = /^[a-zA-Z0-9]{6,24}$/;
const SAFE_DEV_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OAUTH_STATE_COOKIE = "oauthState";

function twoFactorValidationWindow() {
  const configured = Number(process.env.TWO_FA_TOTP_WINDOW || 2);
  if (!Number.isFinite(configured)) return 2;
  return Math.min(2, Math.max(1, Math.floor(configured)));
}

function normalizeTwoFactorToken(token) {
  return String(token || "").replace(/\D/g, "").slice(0, 6);
}

function oauthCookieOptions() {
  return {
    maxAge: 10 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
  };
}

function oauthClearCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
  };
}

function clientRedirectPath(value) {
  return typeof value === "string" && value.length <= 200 && SAFE_RETURN_PATH.test(value)
    ? value
    : "/";
}

function isLocalRequest(req) {
  const hostname = String(req.hostname || "").toLowerCase();
  const ip = String(req.ip || "").replace("::ffff:", "");
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    ip === "127.0.0.1" ||
    ip === "::1"
  );
}

function isDevLoginEnabled(req) {
  return (
    process.env.ALLOW_DEV_LOGIN === "true" &&
    process.env.NODE_ENV !== "production" &&
    isLocalRequest(req)
  );
}

export function resolveDevLoginPro(query = {}) {
  if (Object.prototype.hasOwnProperty.call(query, "pro")) {
    return String(query.pro).toLowerCase() === "true";
  }
  return process.env.DEV_LOGIN_PRO === "true";
}

function vietnamDayKey(date = new Date()) {
  return new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function nextVietnamReset(date = new Date()) {
  const [year, month, day] = vietnamDayKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1, 17, 0, 0, 0));
}

async function downloadQuotaSnapshot(user) {
  if (!user) return null;
  const isPro = Boolean(user.proUntil && new Date(user.proUntil) > new Date());
  const tier = user.role === "admin" ? "admin" : isPro ? "member" : "free";
  const dayKey = vietnamDayKey();
  const quota = tier === "admin"
    ? null
    : await DailyDownloadQuota.findOne({ dayKey, userId: user._id, tier }).lean();
  const baseLimit = isPro ? Number(user.proDailyDownloadLimit || 100) : 5;
  const limit = tier === "admin" ? null : baseLimit + Number(quota?.bonusLimit || 0);
  const used = tier === "admin" ? 0 : Number(quota?.count || 0);
  return {
    dayKey,
    tier,
    used,
    limit,
    remaining: tier === "admin" ? null : Math.max(0, limit - used),
    resetAt: nextVietnamReset(),
  };
}

function safeEqual(a = "", b = "") {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function clearOAuthCookies(res) {
  const options = oauthClearCookieOptions();
  res.clearCookie("oauthReturnTo", options);
  res.clearCookie("oauthReferralCode", options);
  res.clearCookie(OAUTH_STATE_COOKIE, options);
}

export function validateOAuthState(req, res, next) {
  const expected = String(req.cookies?.[OAUTH_STATE_COOKIE] || "");
  const received = String(req.query?.state || "");
  res.clearCookie(OAUTH_STATE_COOKIE, oauthClearCookieOptions());

  if (
    !expected ||
    !received ||
    expected.length > 128 ||
    received.length > 128 ||
    !safeEqual(expected, received)
  ) {
    securityEvent("GOOGLE_OAUTH_STATE_INVALID", {
      ip: req.ip,
      path: req.path,
      hasExpectedState: Boolean(expected),
      hasReceivedState: Boolean(received),
    });
    clearOAuthCookies(res);
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    return res.redirect(`${clientUrl}/?auth=state_error`);
  }

  return next();
}

export function googleLogin(req, res, next) {
  const state = crypto.randomBytes(32).toString("base64url");
  res.cookie(OAUTH_STATE_COOKIE, state, oauthCookieOptions());
  const returnTo =
    typeof req.query.returnTo === "string" ? req.query.returnTo : "";
  const safeReturnTo = clientRedirectPath(returnTo);
  if (safeReturnTo !== "/") {
    res.cookie("oauthReturnTo", safeReturnTo, oauthCookieOptions());
  } else {
    res.clearCookie("oauthReturnTo", oauthClearCookieOptions());
  }
  const referralCode =
    typeof req.query.ref === "string" ? req.query.ref.trim() : "";
  if (SAFE_REFERRAL_CODE.test(referralCode)) {
    res.cookie("oauthReferralCode", referralCode.toUpperCase(), oauthCookieOptions());
  }

  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    state,
  })(req, res, next);
}

export const googleCallback = [
  validateOAuthState,
  (req, res, next) => {
    passport.authenticate("google", { session: false }, (error, user) => {
      if (error || !user) {
        securityEvent("GOOGLE_OAUTH_CALLBACK_FAILED", {
          message: error?.message || "Google OAuth failed",
          ip: req.ip,
          path: req.path,
        });
        const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
        clearOAuthCookies(res);
        return res.redirect(`${clientUrl}/`);
      }
      req.user = user;
      return next();
    })(req, res, next);
  },
  (req, res) => {
    generateTokens(req, res, req.user);
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const returnTo = req.cookies.oauthReturnTo || "/";
    clearOAuthCookies(res);
    const safePath = clientRedirectPath(returnTo);
    res.redirect(`${clientUrl}${safePath}`);
  },
];

export async function devLogin(req, res, next) {
  try {
    if (!isDevLoginEnabled(req)) {
      return res.status(404).json({ message: "Not found" });
    }

    const emailCandidate = String(req.query.email || process.env.DEV_LOGIN_EMAIL || "dev@local.test")
      .trim()
      .toLowerCase();
    const email = SAFE_DEV_EMAIL.test(emailCandidate) ? emailCandidate : "dev@local.test";
    const roleCandidate = String(req.query.role || process.env.DEV_LOGIN_ROLE || "user").toLowerCase();
    const role = roleCandidate === "admin" && process.env.ALLOW_DEV_ADMIN_LOGIN === "true" ? "admin" : "user";
    const proEnabled = resolveDevLoginPro(req.query);

    const update = {
      $set: {
        email,
        role,
        name: String(req.query.name || process.env.DEV_LOGIN_NAME || "Local Dev"),
        avatar: "",
      },
      $setOnInsert: {
        credit: 0,
      },
    };

    if (proEnabled) {
      update.$set.proUntil = endOfVietnamDay(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
      update.$set.proDailyDownloadLimit = 100;
    } else if (Object.prototype.hasOwnProperty.call(req.query, "pro")) {
      update.$unset = {
        proUntil: 1,
        proPlanId: 1,
        proActivatedAt: 1,
      };
    }

    const user = await User.findOneAndUpdate({ email }, update, {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    });

    generateTokens(req, res, user, role === "admin");
    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const returnTo = clientRedirectPath(req.query.returnTo);
    return res.redirect(`${clientUrl}${returnTo}`);
  } catch (error) {
    return next(error);
  }
}

export function logout(_req, res) {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  res.json({ ok: true });
}

export async function currentUser(req, res, next) {
  try {
    if (!req.user) return res.json({ user: null });

    const normalizedProUntil = normalizeProUntil(req.user.proUntil);
    if (normalizedProUntil && normalizedProUntil.getTime() !== new Date(req.user.proUntil).getTime()) {
      req.user.proUntil = normalizedProUntil;
      await User.findByIdAndUpdate(req.user._id, { $set: { proUntil: normalizedProUntil } });
    }

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
      proUntil: req.user.proUntil || null,
      isPro: Boolean(req.user.proUntil && new Date(req.user.proUntil) > new Date()),
      proDailyDownloadLimit: Number(req.user.proDailyDownloadLimit || 100),
      isBanned: Boolean(req.user.isBanned),
      banReason: req.user.banReason || "",
      isTwoFactorEnabled: req.user.isTwoFactorEnabled,
      requires2FA,
      downloadQuota: await downloadQuotaSnapshot(req.user),
    };
    res.json({ user: safeUser });
  } catch (error) {
    next(error);
  }
}

export async function setup2FA(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ message: SESSION_EXPIRED_MESSAGE });
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
    const token = normalizeTwoFactorToken(req.body.token);
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

    const delta = totp.validate({ token, window: twoFactorValidationWindow() });
    if (delta === null) {
      return res
        .status(400)
        .json({ message: "Mã OTP không hợp lệ hoặc đã hết hạn" });
    }

    // Save to user
    await User.findByIdAndUpdate(req.user._id, {
      twoFactorSecret: encryptSecret(tempSecret),
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
    const token = normalizeTwoFactorToken(req.body.token);
    if (!req.user || !req.user.isTwoFactorEnabled) {
      return res
        .status(400)
        .json({ message: "2FA is not enabled for this account" });
    }

    const twoFactorSecret = decryptSecret(req.user.twoFactorSecret);
    const totp = new OTPAuth.TOTP({
      issuer: "3DiPL",
      label: req.user.email,
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(twoFactorSecret),
    });

    const delta = totp.validate({ token, window: twoFactorValidationWindow() });
    if (delta === null) {
      securityEvent("2FA_VERIFY_FAILED", {
        userId: String(req.user._id),
        email: req.user.email,
        ip: req.ip,
      });
      return res.status(400).json({ message: "Mã OTP không hợp lệ" });
    }

    // Dual-read migration: old plaintext values keep working and are encrypted
    // opportunistically after a successful verification.
    if (twoFactorSecret && twoFactorSecret === req.user.twoFactorSecret) {
      await User.findByIdAndUpdate(req.user._id, {
        twoFactorSecret: encryptSecret(twoFactorSecret),
      });
    }

    generateTokens(req, res, req.user, true);
    res.json({ ok: true, message: "2FA verified" });
  } catch (error) {
    next(error);
  }
}

export const csrfToken = issueCsrfToken;
