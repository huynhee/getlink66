const TURNSTILE_TEST_SITE_KEYS = new Set([
  "1x00000000000000000000AA",
  "2x00000000000000000000AB",
  "3x00000000000000000000FF",
]);

const TURNSTILE_TEST_SECRET_KEYS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

function text(env, name) {
  return String(env?.[name] || "").trim();
}

function isTrue(env, name) {
  return text(env, name).toLowerCase() === "true";
}

function hostname(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function productionReadinessIssues(env = process.env) {
  if (text(env, "NODE_ENV") !== "production") {
    return { errors: [], warnings: [] };
  }

  const errors = [];
  const warnings = [];
  const turnstileEnabled = isTrue(env, "TURNSTILE_ENABLED");
  const turnstileSiteKey = text(env, "TURNSTILE_SITE_KEY");
  const turnstileSecretKey = text(env, "TURNSTILE_SECRET_KEY");
  const expectedHostname = text(env, "TURNSTILE_EXPECTED_HOSTNAME").toLowerCase();
  const expectedAction = text(env, "TURNSTILE_EXPECTED_ACTION");
  const clientHostname = hostname(text(env, "CLIENT_URL"));

  if (!turnstileEnabled) {
    errors.push("TURNSTILE_ENABLED must be true in production");
  } else {
    if (!turnstileSiteKey || TURNSTILE_TEST_SITE_KEYS.has(turnstileSiteKey)) {
      errors.push("TURNSTILE_SITE_KEY must use a real production key");
    }
    if (!turnstileSecretKey || TURNSTILE_TEST_SECRET_KEYS.has(turnstileSecretKey)) {
      errors.push("TURNSTILE_SECRET_KEY must use a real production secret");
    }
    if (!expectedHostname) {
      errors.push("TURNSTILE_EXPECTED_HOSTNAME is required");
    } else if (clientHostname && expectedHostname !== clientHostname) {
      errors.push("TURNSTILE_EXPECTED_HOSTNAME must match CLIENT_URL hostname");
    }
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(expectedAction)) {
      errors.push("TURNSTILE_EXPECTED_ACTION must be 1-32 safe characters");
    }
  }

  if (!isTrue(env, "ADMIN_2FA_REQUIRED")) {
    errors.push("ADMIN_2FA_REQUIRED must be true in production");
  }
  if (!text(env, "ADMIN_EMAILS")) {
    errors.push("ADMIN_EMAILS must contain at least one production administrator");
  }
  if (isTrue(env, "ALLOW_DEV_LOGIN") || isTrue(env, "ALLOW_DEV_ADMIN_LOGIN")) {
    errors.push("Development login must be disabled in production");
  }
  if (isTrue(env, "THREED66_MOCK")) {
    errors.push("THREED66_MOCK must be false in production");
  }
  if (isTrue(env, "MARKETPLACE_STARTUP_MIGRATIONS_ENABLED")) {
    errors.push("MARKETPLACE_STARTUP_MIGRATIONS_ENABLED must be false in production");
  }
  if (isTrue(env, "PLUGIN_API_ENABLED")) {
    const pluginSecret = text(env, "PLUGIN_JWT_SECRET");
    const releaseUrl = text(env, "PLUGIN_RELEASE_URL");
    const releaseSha256 = text(env, "PLUGIN_RELEASE_SHA256");
    const releaseSignature = text(env, "PLUGIN_RELEASE_SIGNATURE");
    const releasePublicKey = text(env, "PLUGIN_RELEASE_PUBLIC_KEY");
    const releasePublishedAt = text(env, "PLUGIN_RELEASE_PUBLISHED_AT");
    const challengeMode = text(env, "PLUGIN_DOWNLOAD_CHALLENGE_MODE").toLowerCase();
    if (pluginSecret.length < 32) {
      errors.push("PLUGIN_JWT_SECRET must contain at least 32 characters");
    }
    if (!/^https:\/\//i.test(releaseUrl)) {
      errors.push("PLUGIN_RELEASE_URL must be an HTTPS URL");
    }
    if (!/^[a-f0-9]{64}$/i.test(releaseSha256)) {
      errors.push("PLUGIN_RELEASE_SHA256 must be a 64-character SHA-256");
    }
    if (!/^[A-Za-z0-9+/=_-]{40,}$/.test(releaseSignature)) {
      errors.push("PLUGIN_RELEASE_SIGNATURE must contain a detached release signature");
    }
    if (!releasePublishedAt || Number.isNaN(new Date(releasePublishedAt).getTime())) {
      errors.push("PLUGIN_RELEASE_PUBLISHED_AT must be a valid timestamp");
    }
    if (!text(env, "PLUGIN_RELEASE_VERSION")) {
      errors.push("PLUGIN_RELEASE_VERSION is required");
    }
    if (!text(env, "PLUGIN_MINIMUM_VERSION")) {
      errors.push("PLUGIN_MINIMUM_VERSION is required");
    }
    if (challengeMode !== "risk") {
      errors.push("PLUGIN_DOWNLOAD_CHALLENGE_MODE must be risk in production");
    }
    if (!/^[A-Za-z0-9+/=]{80,}$/.test(releasePublicKey)) {
      errors.push("PLUGIN_RELEASE_PUBLIC_KEY must contain the pinned ES256 SPKI public key");
    }
  }
  if (
    text(env, "PLUGIN_DEPLOYMENT_ENV").toLowerCase() === "production"
    && text(env, "PLUGIN_QA_RISK_SECRET")
  ) {
    errors.push("PLUGIN_QA_RISK_SECRET must not exist in Production");
  }
  if (text(env, "MARKETPLACE_DB_TARGET").toLowerCase() !== "vps") {
    errors.push("MARKETPLACE_DB_TARGET must be vps in production");
  }
  if (!text(env, "MONGO_CORE_URI")) {
    errors.push("MONGO_CORE_URI is required in production");
  }
  if (!text(env, "MONGO_MARKETPLACE_URI")) {
    errors.push("MONGO_MARKETPLACE_URI is required in production");
  }
  if (!isTrue(env, "MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED")) {
    errors.push("MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED must be true in production");
  }
  if (!text(env, "DATABASE_BACKUP_DRIVE_FOLDER_ID")) {
    errors.push("DATABASE_BACKUP_DRIVE_FOLDER_ID is required in production");
  }
  if (!text(env, "BACKUP_AGE_RECIPIENT").startsWith("age1")) {
    errors.push("BACKUP_AGE_RECIPIENT must contain a valid age public recipient");
  }
  if (!isTrue(env, "MARKETPLACE_DRIVE_WRITE_ENABLED")) {
    errors.push("MARKETPLACE_DRIVE_WRITE_ENABLED must be true for verified backups and archives");
  }
  if (!isTrue(env, "TRUST_PROXY")) {
    warnings.push("TRUST_PROXY should be true behind the production reverse proxy");
  }

  const delivery = text(env, "MARKETPLACE_DOWNLOAD_DELIVERY").toLowerCase() || "proxy";
  if (delivery === "drive_redirect") {
    if (!isTrue(env, "MARKETPLACE_ALLOW_PUBLIC_DRIVE_LINKS")) {
      errors.push(
        "drive_redirect requires MARKETPLACE_ALLOW_PUBLIC_DRIVE_LINKS=true as an explicit risk acceptance",
      );
    }
    warnings.push(
      "drive_redirect exposes a reusable Google Drive URL after authorization; proxy is safer",
    );
  } else if (delivery !== "proxy") {
    errors.push("MARKETPLACE_DOWNLOAD_DELIVERY must be proxy or drive_redirect");
  }

  if (
    isTrue(env, "HISTORY_RETENTION_JOB_ENABLED")
    && !isTrue(env, "MARKETPLACE_DRIVE_WRITE_ENABLED")
  ) {
    errors.push(
      "HISTORY_RETENTION_JOB_ENABLED requires MARKETPLACE_DRIVE_WRITE_ENABLED=true",
    );
  }

  if (
    text(env, "SEPAY_ENABLED").toLowerCase() !== "false"
    && text(env, "SEPAY_ENV").toLowerCase() !== "production"
  ) {
    errors.push("SEPAY_ENV must be production when SePay is enabled in production");
  }

  const imageSearchRequired = text(env, "MARKETPLACE_IMAGE_SEARCH_REQUIRED").toLowerCase() !== "false";
  const imageSearchUrl = text(env, "MARKETPLACE_IMAGE_SEARCH_URL");
  const imageSearchApiKey = text(env, "MARKETPLACE_IMAGE_SEARCH_API_KEY");
  if (imageSearchRequired) {
    if (!/^https:\/\//i.test(imageSearchUrl)) {
      errors.push("MARKETPLACE_IMAGE_SEARCH_URL must be HTTPS when image search is required");
    }
    if (imageSearchApiKey.length < 16) {
      errors.push("MARKETPLACE_IMAGE_SEARCH_API_KEY is required when image search is required");
    }
  } else if (!imageSearchUrl || !imageSearchApiKey) {
    warnings.push("Marketplace image search is explicitly disabled");
  }

  return { errors, warnings };
}

export function assertProductionReadiness(env = process.env) {
  const issues = productionReadinessIssues(env);
  if (!issues.errors.length) return issues;
  const error = new Error(
    `Production configuration is not ready:\n- ${issues.errors.join("\n- ")}`,
  );
  error.code = "PRODUCTION_CONFIG_NOT_READY";
  error.issues = issues;
  throw error;
}
