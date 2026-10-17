import { OAuth2Client } from "google-auth-library";
import { assertTimoConfigured } from "../config/timoConfig.js";

let cachedClient;
let cachedKey;

const GOOGLE_REASONS = {
  invalid_client: "INVALID_CLIENT", unauthorized_client: "INVALID_CLIENT",
  invalid_grant: "INVALID_GRANT", access_denied: "ACCESS_DENIED",
  invalid_scope: "INSUFFICIENT_SCOPE", insufficientPermissions: "INSUFFICIENT_SCOPE",
  ACCESS_TOKEN_SCOPE_INSUFFICIENT: "INSUFFICIENT_SCOPE",
  accessNotConfigured: "GMAIL_API_DISABLED", SERVICE_DISABLED: "GMAIL_API_DISABLED", API_DISABLED: "GMAIL_API_DISABLED",
  rateLimitExceeded: "RATE_LIMITED", userRateLimitExceeded: "RATE_LIMITED", dailyLimitExceeded: "RATE_LIMITED",
  quotaExceeded: "RATE_LIMITED", RESOURCE_EXHAUSTED: "RATE_LIMITED",
  authError: "UNAUTHENTICATED", UNAUTHENTICATED: "UNAUTHENTICATED",
};
const FAILURE_HINTS = {
  INVALID_CLIENT: "Check the Gmail OAuth client ID and secret belong to the same client.",
  INVALID_GRANT: "Reauthorize the mailbox using this OAuth client and use its new refresh token, not the access token or authorization code.",
  ACCESS_DENIED: "Check OAuth consent and the mailbox account access policy.",
  INSUFFICIENT_SCOPE: "Reauthorize with https://www.googleapis.com/auth/gmail.readonly and offline access.",
  GMAIL_API_DISABLED: "Enable Gmail API in the project owning the configured OAuth client.",
  RATE_LIMITED: "Google has limited this request. Wait before retrying.",
  UNAUTHENTICATED: "Reauthorize the configured mailbox and verify the refresh token.",
  PERMISSION_DENIED: "Check Gmail API access, OAuth scope and the account policy.",
  BAD_REQUEST: "Check OAuth credentials and the Gmail request configuration.",
  GOOGLE_UNAVAILABLE: "Google is temporarily unavailable. Retry later.",
  DNS_FAILED: "Check DNS resolution from inside the backend container.",
  TIMEOUT: "Check backend outbound connectivity to Google and retry later.",
  NETWORK_FAILED: "Check backend outbound HTTPS connectivity to Google.",
  TLS_FAILED: "Check the server clock, CA certificates and HTTPS connection. Do not disable TLS verification.",
  UNKNOWN: "Inspect the sanitized HTTP status and retry. Never publish the raw Google error object.",
};

function gmailFailure(error) {
  const http = Number(error.response?.status || 0);
  const gmailStatus = Number.isInteger(http) && http >= 100 && http <= 599 ? http : 0;
  const data = error.response?.data;
  const apiError = data?.error;
  const reasons = [typeof apiError === "string" ? apiError : null,
    ...(Array.isArray(apiError?.errors) ? apiError.errors.map((item) => item?.reason) : []),
    ...(Array.isArray(apiError?.details) ? apiError.details.map((item) => item?.reason) : [])];
  let gmailReason = reasons.map((reason) => Object.hasOwn(GOOGLE_REASONS, reason) ? GOOGLE_REASONS[reason] : null).find(Boolean);
  const networkCode = error.code || error.cause?.code;
  if (!gmailReason && ["ENOTFOUND", "EAI_AGAIN"].includes(networkCode)) gmailReason = "DNS_FAILED";
  if (!gmailReason && (["ETIMEDOUT", "ECONNABORTED", "UND_ERR_CONNECT_TIMEOUT"].includes(networkCode) || ["AbortError", "TimeoutError"].includes(error.name))) gmailReason = "TIMEOUT";
  if (!gmailReason && ["CERT_HAS_EXPIRED", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "ERR_TLS_CERT_ALTNAME_INVALID", "SELF_SIGNED_CERT_IN_CHAIN"].includes(networkCode)) gmailReason = "TLS_FAILED";
  if (!gmailReason && ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH"].includes(networkCode)) gmailReason = "NETWORK_FAILED";
  gmailReason ||= gmailStatus === 401 ? "UNAUTHENTICATED" : gmailStatus === 403 ? "PERMISSION_DENIED"
    : gmailStatus === 429 ? "RATE_LIMITED" : gmailStatus >= 500 ? "GOOGLE_UNAVAILABLE" : gmailStatus === 400 ? "BAD_REQUEST" : "UNKNOWN";
  return { gmailStatus, gmailReason, gmailHint: FAILURE_HINTS[gmailReason] };
}

function gmailClient() {
  const config = assertTimoConfigured();
  const key = JSON.stringify([config.clientId, config.clientSecret, config.refreshToken]);
  if (cachedKey !== key) {
    cachedClient = new OAuth2Client(config.clientId, config.clientSecret);
    cachedClient.setCredentials({ refresh_token: config.refreshToken });
    cachedClient.transporter.defaults = { ...cachedClient.transporter.defaults, timeout: 15_000 };
    cachedKey = key;
  }
  return cachedClient;
}

export async function gmailApi(path, params = {}) {
  if (!/^\/(profile|messages(?:\/[a-f0-9]+)?)$/.test(path)) throw new Error("Unsupported read-only Gmail operation");
  const client = gmailClient();
  try {
    const response = await client.request({
      url: `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
      method: "GET", params, timeout: 15_000, retry: false,
      maxContentLength: 2 * 1024 * 1024,
    });
    return response.data;
  } catch (error) {
    // Google client errors include request headers and tokens; never propagate them.
    const diagnostic = gmailFailure(error);
    throw Object.assign(new Error(`Cannot read the configured Timo Gmail mailbox (${diagnostic.gmailReason})`), {
      code: "TIMO_GMAIL_UNAVAILABLE", status: 503,
      ...diagnostic,
    });
  }
}

export async function assertTimoMailbox() {
  const profile = await gmailApi("/profile");
  if (String(profile.emailAddress || "").toLowerCase() !== assertTimoConfigured().mailbox) {
    throw Object.assign(new Error("Gmail token does not belong to TIMO_GMAIL_ADDRESS"), { code: "TIMO_GMAIL_ACCOUNT_MISMATCH", status: 503 });
  }
  return profile;
}
