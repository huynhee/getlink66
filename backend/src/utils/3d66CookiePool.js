import Cookie from "../models/Cookie.js";
import { decryptSecret } from "./secretBox.js";
import { notify3D66CookiesUnavailable } from "./telegramNotifier.js";

const REQUIRED_COOKIE_KEYS = ["PHPSESSID", "login_token", "login_sign"];
const DEFAULT_REQUEST_INTERVAL_MS = 2500;
const DEFAULT_COOKIE_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_MAX_FAILURES = 2;

let next3D66RequestAt = 0;
let lastCookieUnavailableAlertAt = 0;

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cookieKeys(value = "") {
  return new Set(
    String(value)
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index > -1 ? part.slice(0, index).trim() : "";
      })
      .filter(Boolean)
  );
}

function hasRequiredKeys(cookie) {
  const keys = cookieKeys(cookie?.value || "");
  return REQUIRED_COOKIE_KEYS.every((key) => keys.has(key));
}

function isCoolingDown(cookie, now = Date.now()) {
  const cooldownUntil = cookie?.cooldownUntil ? new Date(cookie.cooldownUntil).getTime() : 0;
  return Number.isFinite(cooldownUntil) && cooldownUntil > now;
}

function sortCookies(a, b) {
  const failureDiff = Number(a.failureCount || 0) - Number(b.failureCount || 0);
  if (failureDiff !== 0) return failureDiff;

  const aUsed = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
  const bUsed = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
  if (aUsed !== bUsed) return aUsed - bUsed;

  const aUpdated = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
  const bUpdated = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
  return bUpdated - aUpdated;
}

async function throttle3D66Request() {
  const interval = numberEnv("THREED66_REQUEST_INTERVAL_MS", DEFAULT_REQUEST_INTERVAL_MS);
  if (interval <= 0) return;

  const now = Date.now();
  const waitMs = Math.max(0, next3D66RequestAt - now);
  next3D66RequestAt = Math.max(now, next3D66RequestAt) + interval;
  if (waitMs > 0) await wait(waitMs);
}

function httpError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function cookieAlertCooldownMs() {
  return numberEnv("TELEGRAM_COOKIE_ALERT_COOLDOWN_MS", 30 * 60 * 1000);
}

function cookieStats(cookies = []) {
  return cookies.reduce(
    (stats, cookie) => {
      const status = cookie.status || "active";
      stats.total += 1;
      if (cookie.isActive === false || status === "disabled") {
        stats.disabled += 1;
      } else if (status === "cooldown") {
        stats.cooldown += 1;
      } else if (status === "warning") {
        stats.warning += 1;
      } else {
        stats.active += 1;
      }

      if (!cookie?.value || !hasRequiredKeys(cookie)) {
        stats.invalid += 1;
      }
      return stats;
    },
    { total: 0, active: 0, warning: 0, cooldown: 0, disabled: 0, invalid: 0 },
  );
}

async function alert3D66CookiesUnavailable(reason, error) {
  const now = Date.now();
  if (now - lastCookieUnavailableAlertAt < cookieAlertCooldownMs()) return;
  lastCookieUnavailableAlertAt = now;

  try {
    const cookies = await Cookie.find().sort({ updatedAt: -1 }).limit(100);
    const plainCookies = cookies.map((cookie) => {
      const plain = typeof cookie.toObject === "function" ? cookie.toObject() : cookie;
      return { ...plain, value: decryptSecret(plain.value || "") };
    });
    notify3D66CookiesUnavailable({ reason, error, stats: cookieStats(plainCookies) });
  } catch (alertError) {
    notify3D66CookiesUnavailable({ reason, error: error || alertError });
  }
}

export function isSwitchable3D66Error(error) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = `${error?.message || ""} ${JSON.stringify(error?.details || {})}`.toLowerCase();

  if ([401, 403, 419].includes(status)) return true;
  if (status === 400 && text.includes("cookie")) return true;

  return [
    "cookie",
    "login",
    "session",
    "forbidden",
    "unauthorized",
    "waf",
    "challenge",
    "blocked",
    "did not return a file stream",
    "余额不足",
    "去充值",
    "không đủ số dư",
    "khong du so du"
  ].some((pattern) => text.includes(pattern));
}

export async function getUsable3D66Cookies() {
  const now = Date.now();
  const cookies = await Cookie.find().sort({ updatedAt: -1 }).limit(50);
  return cookies
    .map((cookie) => {
      const plain = typeof cookie.toObject === "function" ? cookie.toObject() : cookie;
      return { ...plain, value: decryptSecret(plain.value || "") };
    })
    .filter((cookie) => cookie?.value)
    .filter((cookie) => cookie.isActive !== false)
    .filter((cookie) => hasRequiredKeys(cookie))
    .filter((cookie) => !isCoolingDown(cookie, now))
    .sort(sortCookies);
}

export async function getPrimary3D66CookieValue() {
  const cookies = await getUsable3D66Cookies();
  if (!cookies.length) {
    await alert3D66CookiesUnavailable("No usable 3D66 cookies");
    throw httpError("3D66 download service is unavailable. Please try again later.", 503);
  }
  return cookies[0].value;
}

export async function mark3D66CookieSuccess(cookie) {
  if (!cookie?._id) return;
  await Cookie.findByIdAndUpdate(cookie._id, {
    $set: {
      status: "active",
      lastUsedAt: new Date(),
      lastTestOk: true,
      lastTestMessage: "Cookie đang hoạt động",
      cooldownUntil: null,
      lastErrorMessage: "",
      failureCount: 0
    },
    $inc: { useCount: 1 }
  }).catch(() => {});
}

export async function mark3D66CookieFailure(cookie, error) {
  if (!cookie?._id) return;

  const nextFailureCount = Number(cookie.failureCount || 0) + 1;
  const maxFailures = numberEnv("THREED66_COOKIE_MAX_FAILURES", DEFAULT_MAX_FAILURES);
  const cooldownMs = numberEnv("THREED66_COOKIE_COOLDOWN_MS", DEFAULT_COOKIE_COOLDOWN_MS);
  const shouldCooldown = nextFailureCount >= maxFailures;

  await Cookie.findByIdAndUpdate(cookie._id, {
    $set: {
      status: shouldCooldown ? "cooldown" : "warning",
      lastErrorAt: new Date(),
      lastErrorMessage: error?.message || "3D66 cookie failed",
      lastTestOk: false,
      lastTestMessage: error?.message || "3D66 cookie failed",
      cooldownUntil: shouldCooldown ? new Date(Date.now() + cooldownMs) : null
    },
    $inc: { failureCount: 1 }
  }).catch(() => {});
}

export async function with3D66Cookie(task) {
  const cookies = await getUsable3D66Cookies();
  if (!cookies.length) {
    await alert3D66CookiesUnavailable("No usable 3D66 cookies");
    throw httpError("3D66 download service is unavailable. Please try again later.", 503);
  }

  let lastError;
  for (const cookie of cookies) {
    try {
      await throttle3D66Request();
      const result = await task(cookie.value, cookie);
      await mark3D66CookieSuccess(cookie);
      return result;
    } catch (error) {
      lastError = error;
      if (!isSwitchable3D66Error(error)) throw error;
      await mark3D66CookieFailure(cookie, error);
    }
  }

  await alert3D66CookiesUnavailable("All usable 3D66 cookies failed", lastError);
  throw lastError || httpError("All 3D66 cookies are unavailable.", 503);
}
