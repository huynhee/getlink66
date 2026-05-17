import crypto from "node:crypto";

const DEFAULT_TTL_MS = 15 * 60 * 1000;

function getSecret() {
  return process.env.SESSION_SECRET || "dev-secret";
}

function computeSignature(historyId, userId, exp) {
  return crypto
    .createHmac("sha256", getSecret())
    .update(`${historyId}|${userId}|${exp}`)
    .digest("base64url");
}

export function signDownloadToken(historyId, userId, ttlMs = DEFAULT_TTL_MS) {
  const exp = Date.now() + Math.max(60_000, Number(ttlMs) || DEFAULT_TTL_MS);
  const signature = computeSignature(String(historyId), String(userId), exp);
  return `${exp}.${signature}`;
}

export function verifyDownloadToken(token, historyId, userId) {
  if (!token || typeof token !== "string") return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  const [expStr, signature] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const expected = computeSignature(String(historyId), String(userId), exp);
  const expectedBuf = Buffer.from(expected);
  const signatureBuf = Buffer.from(signature);
  if (expectedBuf.length !== signatureBuf.length) return false;
  try {
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  } catch {
    return false;
  }
}
