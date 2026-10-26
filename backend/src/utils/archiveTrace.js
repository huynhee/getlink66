import crypto from "node:crypto";

const PREFIX = "ipl1";
const AAD = Buffer.from("3dipl/archive-download/v1");
export const MAX_COMMENT_BYTES = 4096;

export function archiveTraceKeyConfigured(env = process.env) {
  return /^[a-f0-9]{64}$/i.test(String(env.ARCHIVE_TRACE_SECRET || ""));
}

function key(env) {
  if (!archiveTraceKeyConfigured(env)) {
    throw Object.assign(new Error("ARCHIVE_TRACE_SECRET must be a private 64-character hex key."), {
      status: 503, code: "ARCHIVE_TRACE_KEY_REQUIRED",
    });
  }
  return Buffer.from(env.ARCHIVE_TRACE_SECRET, "hex");
}

export function validArchiveComment(value) {
  return typeof value === "string" && Buffer.byteLength(value, "utf8") <= MAX_COMMENT_BYTES
    && !Array.from(value).some((character) => {
      const code = character.codePointAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
    });
}

function validClaims(claims) {
  return claims?.v === 1 && [claims.u, claims.m, claims.s].every((id) => /^[a-f0-9]{24}$/.test(id))
    && ["model", "scene"].includes(claims.a) && Number.isSafeInteger(claims.t) && claims.t > 0 && claims.t <= 8640000000000000;
}

export function createArchiveTrace({ userId, modelId, sessionId, assetType, at = Date.now() }, env = process.env) {
  const claims = { v: 1, u: String(userId), m: String(modelId), s: String(sessionId), a: assetType, t: at };
  if (!validClaims(claims)) throw new Error("Invalid archive trace claims.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(env), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  return `${PREFIX}.${Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url")}`;
}

export function readArchiveTrace(input, env = process.env) {
  // Accept a pasted comment, but never accept an unbounded payload or log its contents.
  const secret = key(env);
  try {
    if (typeof input !== "string" || input.length > 8192) throw new Error();
    const matches = input.match(/ipl1\.[A-Za-z0-9_-]+/g);
    if (matches?.length !== 1) throw new Error();
    const encoded = matches[0].slice(PREFIX.length + 1);
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length < 29 || bytes.length > 512 || bytes.toString("base64url") !== encoded) throw new Error();
    const decipher = crypto.createDecipheriv("aes-256-gcm", secret, bytes.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const claims = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    if (!validClaims(claims)) throw new Error();
    return { userId: claims.u, modelId: claims.m, sessionId: claims.s, assetType: claims.a, issuedAt: new Date(claims.t).toISOString() };
  } catch {
    throw Object.assign(new Error("Invalid archive reference or authentication tag."), { status: 400, code: "ARCHIVE_TRACE_INVALID" });
  }
}

export function archiveCommentText(text, token) {
  if (!validArchiveComment(text)) throw new Error("Invalid archive comment.");
  return `${text.replace(/\r\n?/g, "\n").trim()}\n\n${token}`.trimStart();
}
