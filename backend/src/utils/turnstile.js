const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_TOKEN_LENGTH = 2048;

function enabledByEnvironment() {
  return String(process.env.TURNSTILE_ENABLED || "false").toLowerCase() === "true";
}

function siteKey() {
  return String(process.env.TURNSTILE_SITE_KEY || "").trim();
}

function secretKey() {
  return String(process.env.TURNSTILE_SECRET_KEY || "").trim();
}

function expectedAction() {
  return String(process.env.TURNSTILE_EXPECTED_ACTION || "").trim();
}

function expectedHostname() {
  return String(process.env.TURNSTILE_EXPECTED_HOSTNAME || "").trim().toLowerCase();
}

function turnstileError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function marketplaceTurnstileConfig() {
  const enabled = enabledByEnvironment() && Boolean(siteKey() && secretKey());
  return {
    enabled,
    provider: enabled ? "turnstile" : "none",
    siteKey: enabled ? siteKey() : "",
    action: enabled ? (expectedAction() || "marketplace_download") : "",
  };
}

export async function verifyMarketplaceTurnstile({ token, remoteIp = "", expectedCData = "" } = {}) {
  const config = marketplaceTurnstileConfig();
  if (!config.enabled) return { success: true, skipped: true };

  const normalizedToken = String(token || "").trim();
  if (!normalizedToken) {
    throw turnstileError("Please verify that you are human before downloading.", "TURNSTILE_REQUIRED");
  }
  if (normalizedToken.length > MAX_TOKEN_LENGTH) {
    throw turnstileError("Human verification is invalid. Please try again.", "TURNSTILE_INVALID");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response;
  let result;
  try {
    response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret: secretKey(),
        response: normalizedToken,
        ...(remoteIp ? { remoteip: String(remoteIp).slice(0, 80) } : {}),
      }),
      signal: controller.signal,
    });
    result = await response.json().catch(() => ({}));
  } catch (error) {
    const message = error?.name === "AbortError"
      ? "Human verification timed out. Please try again."
      : "Human verification is temporarily unavailable. Please try again.";
    throw turnstileError(message, "TURNSTILE_UNAVAILABLE", 503);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw turnstileError("Human verification is temporarily unavailable. Please try again.", "TURNSTILE_UNAVAILABLE", 503);
  }
  if (!result.success) {
    throw turnstileError("Human verification failed or expired. Please try again.", "TURNSTILE_FAILED");
  }

  const requiredAction = expectedAction();
  if (requiredAction && String(result.action || "") !== requiredAction) {
    throw turnstileError("Human verification does not match this download.", "TURNSTILE_ACTION_MISMATCH");
  }

  const requiredHostname = expectedHostname();
  if (requiredHostname && String(result.hostname || "").toLowerCase() !== requiredHostname) {
    throw turnstileError("Human verification does not match this website.", "TURNSTILE_HOSTNAME_MISMATCH");
  }

  const requiredCData = String(expectedCData || "").slice(0, 255);
  if (requiredCData && String(result.cdata || "") !== requiredCData) {
    throw turnstileError("Human verification does not match this asset.", "TURNSTILE_CDATA_MISMATCH");
  }

  return {
    success: true,
    hostname: String(result.hostname || ""),
    action: String(result.action || ""),
    cData: String(result.cdata || ""),
    challengeAt: result.challenge_ts || null,
  };
}
