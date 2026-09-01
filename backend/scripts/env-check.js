import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { productionReadinessIssues } from "../src/config/productionReadiness.js";

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

function requireDriveFolderId(name, options = {}) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const message = `${name} is not configured`;
    if (options.productionOnly && !production) warnings.push(message);
    else errors.push(message);
    return false;
  }
  if (!/^[A-Za-z0-9_-]{10,}$/.test(value)) {
    errors.push(`${name} must be a plain Google Drive folder ID without comments or spaces`);
    return false;
  }
  pass(name);
  return true;
}

function validateOptional3D66Origin() {
  const value = String(process.env.THREED66_ORIGIN || "").trim();
  if (!value) return;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("unsupported protocol");
    }
    if (parsed.hostname !== "3d66.com" && !parsed.hostname.endsWith(".3d66.com")) {
      errors.push("THREED66_ORIGIN must use the 3d66.com domain");
      return;
    }
    pass("THREED66_ORIGIN");
  } catch {
    errors.push("THREED66_ORIGIN must be empty or a valid absolute 3d66.com URL");
  }
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
  requireValue("MONGO_MARKETPLACE_URI");
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
  "DATABASE_BACKUP_DRIVE_FOLDER_ID",
].forEach((name) => requireDriveFolderId(name, { productionOnly: true }));
requireValue("BACKUP_AGE_RECIPIENT", { productionOnly: true });
validateOptional3D66Origin();

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
  if (process.env.TURNSTILE_ENABLED === "true") {
    requireValue("TURNSTILE_EXPECTED_HOSTNAME");
    requireValue("TURNSTILE_EXPECTED_ACTION");
  }
  if (process.env.PLUGIN_API_ENABLED === "true") {
    requireValue("PLUGIN_JWT_SECRET");
  }
  if (process.env.PLUGIN_RELEASE_ENABLED === "true") {
    [
      "PLUGIN_RELEASE_VERSION",
      "PLUGIN_MINIMUM_VERSION",
      "PLUGIN_RELEASE_URL",
      "PLUGIN_RELEASE_SHA256",
    ].forEach((name) => requireValue(name));
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

const marketplaceSearchEngine = String(process.env.MARKETPLACE_SEARCH_ENGINE || "mongo").trim().toLowerCase();
if (marketplaceSearchEngine === "meilisearch") {
  requireValue("MEILISEARCH_URL");
  requireValue("MEILI_MASTER_KEY");
  try {
    const url = new URL(String(process.env.MEILISEARCH_URL || ""));
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("unsupported protocol");
    pass("Meilisearch URL");
  } catch {
    errors.push("MEILISEARCH_URL must be a valid HTTP(S) URL");
  }
  if (String(process.env.MEILI_MASTER_KEY || "").length < 16) {
    errors.push("MEILI_MASTER_KEY must contain at least 16 characters");
  }
  const rolloutPercent = Number(process.env.MARKETPLACE_MEILI_ROLLOUT_PERCENT ?? 100);
  if (!Number.isFinite(rolloutPercent) || rolloutPercent < 0 || rolloutPercent > 100) {
    errors.push("MARKETPLACE_MEILI_ROLLOUT_PERCENT must be between 0 and 100");
  }
  if (rolloutPercent === 100 && process.env.MARKETPLACE_MEILI_SHADOW_ENABLED === "true") {
    warnings.push("Meilisearch shadow mode has no effect at 100% rollout");
  }
  if (process.env.MARKETPLACE_SEARCH_SEMANTIC_ENABLED !== "true") {
    warnings.push("Meilisearch semantic search is disabled; lexical typo search remains active");
  }
} else if (marketplaceSearchEngine === "mongo") {
  warnings.push("Marketplace search uses the bounded MongoDB fallback");
} else {
  errors.push("MARKETPLACE_SEARCH_ENGINE must be mongo or meilisearch");
}

if (process.env.MARKETPLACE_COVER_CACHE_ENABLED === "true") {
  requireValue("MARKETPLACE_COVER_CACHE_DIR");
  requireValue("MARKETPLACE_COVER_PUBLIC_BASE_URL");
  if (process.env.MARKETPLACE_COVER_WORKER_ENABLED !== "true") {
    warnings.push("Cover cache is enabled but MARKETPLACE_COVER_WORKER_ENABLED is not true");
  }
  const publicBase = String(process.env.MARKETPLACE_COVER_PUBLIC_BASE_URL || "").trim();
  if (publicBase && !publicBase.startsWith("/")) {
    errors.push("MARKETPLACE_COVER_PUBLIC_BASE_URL must be an absolute URL path starting with /");
  }
}

const productionIssues = productionReadinessIssues(process.env);
productionIssues.warnings.forEach((message) => {
  if (!warnings.includes(message)) warnings.push(message);
});
productionIssues.errors.forEach((message) => {
  if (!errors.includes(message)) errors.push(message);
});

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
