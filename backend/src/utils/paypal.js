import { createHash } from "node:crypto";
import { paymentError, usdCents } from "./paymentMoney.js";
import { paypalConfigurationIssues } from "../config/paypalConfig.js";

const HOSTS = { sandbox: "https://api-m.sandbox.paypal.com", live: "https://api-m.paypal.com" };
let tokenCache;

export function paypalConfiguration({ newCheckout = false } = {}) {
  const environment = process.env.PAYPAL_ENV || "sandbox";
  const clientId = String(process.env.PAYPAL_CLIENT_ID || "").trim();
  const secret = String(process.env.PAYPAL_CLIENT_SECRET || "").trim();
  const webhookId = String(process.env.PAYPAL_WEBHOOK_ID || "").trim();
  const merchantId = String(process.env.PAYPAL_MERCHANT_ID || "").trim();
  if ((newCheckout && process.env.PAYPAL_ENABLED !== "true") || paypalConfigurationIssues(process.env).length || !HOSTS[environment] || !clientId || !secret || !webhookId || !merchantId) {
    throw paymentError("PayPal is not configured or enabled", "PAYPAL_UNAVAILABLE", 503);
  }
  return { environment, clientId, secret, webhookId, merchantId, host: HOSTS[environment] };
}

export function paypalAvailability() {
  try { paypalConfiguration({ newCheckout: true }); return { enabled: true, currency: "USD" }; }
  catch { return { enabled: false, currency: "USD" }; }
}

export function paypalRequestId(operation, id) {
  return createHash("sha256").update(`${operation}:${id}`).digest("hex").slice(0, 36);
}

function safeDiagnosticCode(value, fallback = "") {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : fallback;
}

async function readResponse(response, stage) {
  let data;
  try { data = await response.json(); } catch (error) {
    if (error.name !== "SyntaxError") throw error;
    data = {};
  }
  if (!response.ok) {
    const issue = safeDiagnosticCode(data?.details?.[0]?.issue || data?.name || data?.error, "API_ERROR");
    const error = paymentError(`PayPal ${stage} request failed (HTTP ${response.status}: ${issue})`, "PAYPAL_API_ERROR", 502);
    error.paypalStage = stage;
    error.paypalIssue = issue;
    error.paypalStatus = response.status;
    error.paypalDebugId = safeDiagnosticCode(data?.debug_id);
    throw error;
  }
  return data;
}

async function requestPaypal(url, options, stage) {
  try {
    const response = await fetch(url, { ...options, redirect: "error", signal: AbortSignal.timeout(10000) });
    if (stage === "api" && response.status === 401) tokenCache = null;
    return await readResponse(response, stage);
  } catch (error) {
    if (error.code === "PAYPAL_API_ERROR") throw error;
    const timeout = ["TimeoutError", "AbortError"].includes(error.name);
    throw Object.assign(paymentError(
      `PayPal ${stage} ${timeout ? "request timed out" : "connection failed"}`,
      timeout ? "PAYPAL_API_TIMEOUT" : "PAYPAL_CONNECTION_FAILED",
      timeout ? 504 : 502,
    ), { paypalStage: stage, paypalIssue: safeDiagnosticCode(error.cause?.code || error.code, timeout ? "TIMEOUT" : "NETWORK_ERROR") });
  }
}

async function accessToken(config) {
  const key = createHash("sha256").update(`${config.environment}:${config.clientId}:${config.secret}`).digest("hex");
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const data = await requestPaypal(`${config.host}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  }, "oauth");
  if (!data.access_token) throw paymentError("PayPal authentication failed", "PAYPAL_AUTH_FAILED", 502);
  tokenCache = { key, token: data.access_token, expiresAt: Date.now() + Math.max(0, Number(data.expires_in || 0) - 60) * 1000 };
  return data.access_token;
}

export async function paypalApi(path, { method = "GET", body, requestId, environment } = {}) {
  const config = paypalConfiguration();
  if (environment && environment !== config.environment) {
    throw paymentError("PayPal environment does not match this order", "PAYPAL_ENVIRONMENT_MISMATCH", 409);
  }
  if (!/^\/v[12]\/[a-z0-9/-]+$/i.test(path)) throw paymentError("Invalid PayPal API path", "PAYPAL_PATH_INVALID");
  const token = await accessToken(config);
  return requestPaypal(config.host + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(requestId ? { "PayPal-Request-Id": requestId } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }, "api");
}

export function paypalApprovalUrl(data, environment) {
  const link = data.links?.find((item) => ["payer-action", "approve"].includes(item.rel));
  const url = new URL(link?.href || "https://invalid.local");
  const expected = environment === "live" ? "www.paypal.com" : "www.sandbox.paypal.com";
  if (url.protocol !== "https:" || url.hostname !== expected || url.username || url.password || url.port) {
    throw paymentError("PayPal returned an invalid approval URL", "PAYPAL_APPROVAL_URL_INVALID", 502);
  }
  return url.href;
}

export function validatePaypalOrder(data, payment) {
  const units = data.purchase_units;
  if (!data.id || (payment.paypalOrderId && data.id !== payment.paypalOrderId) || data.intent !== "CAPTURE" || !Array.isArray(units) || units.length !== 1) {
    throw paymentError("PayPal order does not match", "PAYPAL_ORDER_MISMATCH", 409);
  }
  const unit = units[0];
  if (unit.invoice_id !== payment.invoiceId || unit.custom_id !== payment._id || unit.payee?.merchant_id !== payment.merchantId ||
      unit.amount?.currency_code !== "USD" || usdCents(unit.amount.value) !== payment.amountMinor) {
    throw paymentError("PayPal merchant, currency or amount does not match", "PAYPAL_ORDER_MISMATCH", 409);
  }
  return unit;
}

export function validatePaypalCapture(capture, payment) {
  if (!/^[A-Z0-9]+$/i.test(capture?.id || "") || capture.amount?.currency_code !== "USD" || usdCents(capture.amount.value) !== payment.amountMinor || capture.final_capture !== true) {
    throw paymentError("PayPal capture does not match", "PAYPAL_CAPTURE_MISMATCH", 409);
  }
  const fee = capture.seller_receivable_breakdown?.paypal_fee;
  if (fee && fee.currency_code !== "USD") throw paymentError("PayPal fee currency does not match", "PAYPAL_CAPTURE_MISMATCH", 409);
  return { captureId: capture.id, feeMinor: fee ? usdCents(fee.value) : 0 };
}

export async function verifyPaypalWebhook(req) {
  const config = paypalConfiguration();
  const required = ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"];
  if (required.some((name) => !req.get(name))) throw paymentError("Missing PayPal webhook signature", "PAYPAL_WEBHOOK_INVALID", 401);
  let certificate;
  try { certificate = new URL(req.get("paypal-cert-url")); } catch {
    throw paymentError("Invalid PayPal certificate URL", "PAYPAL_WEBHOOK_INVALID", 401);
  }
  const certificateHosts = config.environment === "live" ? ["api.paypal.com", "api-m.paypal.com"] : ["api.sandbox.paypal.com", "api-m.sandbox.paypal.com"];
  if (certificate.protocol !== "https:" || !certificateHosts.includes(certificate.hostname) || certificate.username || certificate.password || certificate.port) {
    throw paymentError("Invalid PayPal certificate URL", "PAYPAL_WEBHOOK_INVALID", 401);
  }
  const result = await paypalApi("/v1/notifications/verify-webhook-signature", {
    method: "POST",
    body: {
      auth_algo: req.get("paypal-auth-algo"), cert_url: certificate.href,
      transmission_id: req.get("paypal-transmission-id"), transmission_sig: req.get("paypal-transmission-sig"),
      transmission_time: req.get("paypal-transmission-time"), webhook_id: config.webhookId, webhook_event: req.body,
    },
  });
  if (result.verification_status !== "SUCCESS") throw paymentError("Invalid PayPal webhook signature", "PAYPAL_WEBHOOK_INVALID", 401);
  return config.environment;
}
