const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

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
