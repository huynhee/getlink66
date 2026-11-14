import crypto from "node:crypto";
import { parse3D66CookieHeader } from "./3d66CookieHeader.js";
import { accountMarkerFromUserId } from "./parse3d66.js";

const FIELD = "cad_verified";
const AAD = Buffer.from("3dipl/cad/source-verification/v1");
export const CAD_VERIFICATION_TTL_MS = 120_000;

export function is3D66CadModelUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === "https://cad.3d66.com" && !url.username && !url.password
      && /^\/reshtmla\/cad\/items\/[^/]+\/[^/]+\.html$/.test(url.pathname)
      && !url.pathname.endsWith("/items/id/model.html");
  } catch { return false; }
}

function identity(value) {
  if (!is3D66CadModelUrl(value)) throw new Error("Invalid CAD resource");
  const url = new URL(value);
  const ids = url.searchParams.getAll("sof");
  if (ids.length !== 1 || !/^[A-Z]{3}\d{11,28}$/.test(ids[0]) || url.searchParams.has("sign")
    || url.searchParams.getAll("id").length > 1 || url.searchParams.getAll("id").some(id => id !== ids[0])) {
    throw new Error("Invalid CAD identity");
  }
  url.hash = "";
  return { url: url.href, productId: ids[0] };
}

function key() {
  const secret = process.env.COOKIE_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  if (process.env.NODE_ENV === "production" && secret.length < 32) {
    throw new Error("CAD verification key is unavailable");
  }
  return Buffer.from(crypto.hkdfSync("sha256", Buffer.from(secret || "dev-cad-verification-key"),
    AAD, Buffer.from("source-proof"), 32));
}

export function cadCredentialDigest(value) {
  const cookies = parse3D66CookieHeader(value);
  if (!cookies.get("PHPSESSID") || !cookies.get("login_sign")) throw new Error("Incomplete source credential");
  return crypto.createHash("sha256").update(JSON.stringify(
    ["PHPSESSID", "login_sign", "login_token"].map(name => [name, cookies.get(name) || ""]),
  )).digest("hex");
}

function validClaims(claims) {
  if (claims?.v !== 1 || !/^[1-9]\d{5,19}$/.test(claims.accountId)
    || !/^\d{6,12}$/.test(claims.marker) || accountMarkerFromUserId(claims.accountId) !== claims.marker
    || !/^[1-9]\d{4,19}$/.test(claims.assetId) || !/^[a-f0-9]{64}$/.test(claims.credential)
    || !/^[a-f0-9]{64}$/.test(claims.configuration) || !Number.isSafeInteger(claims.at) || claims.at <= 0) return false;
  try {
    const target = identity(claims.url);
    return target.productId === claims.productId && claims.productId.slice(3) === claims.marker + claims.assetId;
  } catch { return false; }
}

export function seal3D66CadVerification({ url, accountId, assetId, marker, cookieValue, configurationKey, at = Date.now() }) {
  const target = identity(url);
  const claims = { v: 1, ...target, accountId: String(accountId), assetId: String(assetId), marker,
    credential: cadCredentialDigest(cookieValue), configuration: configurationKey, at };
  if (!validClaims(claims)) throw new Error("Invalid CAD verification claims");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  const receipt = "cad1." + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  const result = new URL(target.url);
  result.hash = new URLSearchParams({ [FIELD]: receipt }).toString();
  return result.href;
}

// This receipt proves a past source check, not permission to purchase. New purchases also require fresh=true.
export function read3D66CadVerification(value, { cookieValue, configurationKey, fresh = false, now = Date.now() } = {}) {
  try {
    const target = identity(value);
    const fields = new URLSearchParams(new URL(value).hash.slice(1));
    const tokens = fields.getAll(FIELD);
    if (tokens.length !== 1 || !/^cad1\.[A-Za-z0-9_-]+$/.test(tokens[0]) || tokens[0].length > 4096) return null;
    const encoded = tokens[0].slice(5);
    const bytes = Buffer.from(encoded, "base64url");
    if (bytes.length < 29 || bytes.toString("base64url") !== encoded) return null;
    const decipher = crypto.createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const claims = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
    if (!validClaims(claims) || claims.url !== target.url || claims.productId !== target.productId) return null;
    if (cookieValue !== undefined && claims.credential !== cadCredentialDigest(cookieValue)) return null;
    if (configurationKey !== undefined && claims.configuration !== configurationKey) return null;
    if (fresh && (claims.at > now + 5000 || now - claims.at >= CAD_VERIFICATION_TTL_MS)) return null;
    return claims;
  } catch { return null; }
}
