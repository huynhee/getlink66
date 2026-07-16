import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env");
const raw = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const production = process.env.NODE_ENV === "production";
const errors = [];
const warnings = [];
const ok = [];

function has(name) {
  return Boolean(String(process.env[name] || "").trim());
}

function pass(message) {
  ok.push(message);
}

function requireValue(name, options = {}) {
  if (has(name)) {
    pass(name);
    return true;
  }
  const message = `${name} is not configured`;
  if (options.productionOnly && !production) warnings.push(message);
  else errors.push(message);
  return false;
}

function duplicateKeys() {
  const counts = new Map();
  raw.split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) counts.set(match[1], Number(counts.get(match[1]) || 0) + 1);
  });
  return [...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key);
}

const duplicates = duplicateKeys();
if (duplicates.length) errors.push(`Duplicate keys: ${duplicates.join(", ")}`);
else pass("No duplicate .env keys");

if (has("MONGO_CORE_URI") || has("MONGO_URI")) pass("Atlas Core URI");
else errors.push("MONGO_CORE_URI or MONGO_URI is required");

const marketplaceTarget = String(process.env.MARKETPLACE_DB_TARGET || "").trim().toLowerCase();
if (marketplaceTarget === "vps") {
  requireValue("MONGO_MARKETPLACE_URI", { productionOnly: true });
  if (production && process.env.MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED !== "true") {
    warnings.push("Set MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED=true to document the production requirement");
  }
} else {
  warnings.push("MARKETPLACE_DB_TARGET is not vps; marketplace data shares Atlas Core");
}

const driveClient = has("GOOGLE_DRIVE_CLIENT_ID") || has("GOOGLE_CLIENT_ID");
const driveSecret = has("GOOGLE_DRIVE_CLIENT_SECRET") || has("GOOGLE_CLIENT_SECRET");
const refreshToken = has("GOOGLE_DRIVE_REFRESH_TOKEN");
if (driveClient && driveSecret && refreshToken) pass("Google Drive automatic token refresh");
else if (has("GOOGLE_DRIVE_ACCESS_TOKEN") || has("GOOGLE_DRIVE_BEARER_TOKEN")) {
  warnings.push("Google Drive uses a temporary access token; run npm run drive:auth");
} else {
  const message = "Google Drive credentials are not configured";
  if (production) errors.push(message);
  else warnings.push(message);
}

[
  "MARKETPLACE_DRIVE_ROOT_FOLDER_ID",
  "SCENES_DRIVE_ROOT_FOLDER_ID",
  "HISTORY_ARCHIVE_DRIVE_FOLDER_ID",
].forEach((name) => requireValue(name, { productionOnly: true }));

if (production) {
  [
    "CLIENT_URL",
    "PUBLIC_BASE_URL",
    "JWT_SECRET",
    "CSRF_HMAC_SECRET",
    "COOKIE_SIGNATURE_SECRET",
    "DOWNLOAD_TOKEN_SECRET",
    "COOKIE_ENCRYPTION_KEY",
  ].forEach((name) => requireValue(name));
  if (process.env.ALLOW_MEMORY_DB === "true") errors.push("ALLOW_MEMORY_DB must be false in production");
  if (process.env.ALLOW_DEV_LOGIN === "true") errors.push("ALLOW_DEV_LOGIN must be false in production");
  if (process.env.SEED_MARKETPLACE_DEMO === "true") errors.push("SEED_MARKETPLACE_DEMO must be false in production");
  if (process.env.TURNSTILE_ENABLED === "true") {
    requireValue("TURNSTILE_EXPECTED_HOSTNAME");
    requireValue("TURNSTILE_EXPECTED_ACTION");
  }
}

if (has("GOOGLE_CLIENT_ID") || has("GOOGLE_CLIENT_SECRET")) {
  requireValue("GOOGLE_CLIENT_ID");
  requireValue("GOOGLE_CLIENT_SECRET");
  requireValue("GOOGLE_CALLBACK_URL", { productionOnly: true });
  const callbackUrl = String(process.env.GOOGLE_CALLBACK_URL || "").trim();
  if (callbackUrl) {
    try {
      const parsed = new URL(callbackUrl);
      if (production && parsed.protocol !== "https:") {
        errors.push("GOOGLE_CALLBACK_URL must use HTTPS in production");
      }
      if (!parsed.pathname.endsWith("/api/auth/google/callback")) {
        errors.push("GOOGLE_CALLBACK_URL must end with /api/auth/google/callback");
      }
    } catch {
      errors.push("GOOGLE_CALLBACK_URL is not a valid absolute URL");
    }
  }
}

if (!has("MARKETPLACE_IMAGE_SEARCH_URL")) warnings.push("Image search provider is disabled");
if (!has("MARKETPLACE_DISCOVERY_URL")) warnings.push("Semantic discovery uses the MongoDB fallback");

console.log(`Environment: ${production ? "production" : "development"}`);
ok.forEach((message) => console.log(`[OK] ${message}`));
warnings.forEach((message) => console.warn(`[WARN] ${message}`));
errors.forEach((message) => console.error(`[ERROR] ${message}`));

if (errors.length) {
  console.error(`Environment check failed with ${errors.length} error(s).`);
  process.exitCode = 1;
} else {
  console.log(`Environment check passed with ${warnings.length} warning(s).`);
}
