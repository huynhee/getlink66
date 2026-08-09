import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } }
      : undefined,
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      "req.body.accessToken",
      "req.body.refreshToken",
      "req.body.challengeToken",
      "*.accessToken",
      "*.refreshToken",
      "*.challengeToken",
      "*.downloadUrl",
      "*.signedUrl",
      "*.signature",
      "*.password",
      "*.secret",
      "*.cookieValue",
      "*.value"
    ],
    censor: "[REDACTED]"
  }
});

export default logger;

/**
 * Log a security-relevant event (rate limit, auth failure, CSRF, etc.).
 * Always logged at `warn` level so it stands out.
 */
export function securityEvent(event, details = {}) {
  logger.warn({ type: "SECURITY", event, ...details });
}

/**
 * Log an admin action for audit trail.
 */
export function auditEvent(event, details = {}) {
  logger.info({ type: "AUDIT", event, ...details });
}
