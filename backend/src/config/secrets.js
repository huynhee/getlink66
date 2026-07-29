const DEV_SECRET = "dev-secret";

function secretFromEnv(name, fallbackName = "SESSION_SECRET") {
  return String(process.env[name] || (fallbackName ? process.env[fallbackName] : "") || "");
}

function getSecret(name, fallbackName = "SESSION_SECRET") {
  const value = secretFromEnv(name, fallbackName);
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`${name} must be configured in production.`);
  }
  return DEV_SECRET;
}

export function jwtSecret() {
  return getSecret("JWT_SECRET");
}

export function pluginJwtSecret() {
  return getSecret("PLUGIN_JWT_SECRET", "");
}

export function csrfHmacSecret() {
  return getSecret("CSRF_HMAC_SECRET");
}

export function cookieSignatureSecret() {
  return getSecret("COOKIE_SIGNATURE_SECRET");
}

export function downloadTokenSecret() {
  return getSecret("DOWNLOAD_TOKEN_SECRET");
}
