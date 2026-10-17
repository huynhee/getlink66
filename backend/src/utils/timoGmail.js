import { OAuth2Client } from "google-auth-library";
import { assertTimoConfigured } from "../config/timoConfig.js";

let cachedClient;
let cachedKey;

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
  try {
    const response = await gmailClient().request({
      url: `https://gmail.googleapis.com/gmail/v1/users/me${path}`,
      method: "GET", params, timeout: 15_000, retry: false,
      maxContentLength: 2 * 1024 * 1024,
    });
    return response.data;
  } catch (error) {
    // Google client errors include request headers and tokens; never propagate them.
    throw Object.assign(new Error("Cannot read the configured Timo Gmail mailbox"), {
      code: "TIMO_GMAIL_UNAVAILABLE", status: 503,
      gmailStatus: Number(error.response?.status || 0),
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
