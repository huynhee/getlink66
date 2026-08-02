const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";
const DEFAULT_JSON_BODY_LIMIT = "1mb";
const MAX_JSON_BODY_BYTES = 10 * 1024 * 1024;

export function validatedJsonBodyLimit(value = process.env.JSON_BODY_LIMIT) {
  const input = String(value || DEFAULT_JSON_BODY_LIMIT).trim().toLowerCase();
  const match = input.match(/^(\d+(?:\.\d+)?)(b|kb|mb)$/);
  if (!match) {
    throw new Error("JSON_BODY_LIMIT must use b, kb or mb units, for example 100kb or 1mb.");
  }
  const multiplier = { b: 1, kb: 1024, mb: 1024 * 1024 }[match[2]];
  const bytes = Number(match[1]) * multiplier;
  if (!Number.isFinite(bytes) || bytes < 1024 || bytes > MAX_JSON_BODY_BYTES) {
    throw new Error("JSON_BODY_LIMIT must be between 1kb and 10mb.");
  }
  return input;
}

function appendIf(values, condition, value) {
  return condition ? [...values, value] : values;
}

export function buildHelmetOptions({
  production = process.env.NODE_ENV === "production",
  turnstileEnabled = process.env.TURNSTILE_ENABLED === "true",
} = {}) {
  if (!production) {
    return {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      hsts: false,
    };
  }

  return {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: appendIf(
          ["'self'", "https://cdnjs.cloudflare.com"],
          turnstileEnabled,
          TURNSTILE_ORIGIN,
        ),
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: [
          "'self'",
          "https://respic.3d66.com",
          "https://api.vietqr.io",
          "data:",
        ],
        connectSrc: appendIf(
          ["'self'"],
          turnstileEnabled,
          TURNSTILE_ORIGIN,
        ),
        formAction: [
          "'self'",
          "https://pay.sepay.vn",
          "https://pay-sandbox.sepay.vn",
        ],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        frameSrc: appendIf(
          [
            "'self'",
            "https://www.youtube.com",
            "https://www.youtube-nocookie.com",
          ],
          turnstileEnabled,
          TURNSTILE_ORIGIN,
        ),
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
    },
  };
}

export { TURNSTILE_ORIGIN };
