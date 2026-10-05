import "dotenv/config";
import { paypalApi, paypalConfiguration } from "../src/utils/paypal.js";

try {
  const config = paypalConfiguration();
  console.log("PayPal configuration:", { environment: config.environment, enabled: process.env.PAYPAL_ENABLED === "true" });
  // OAuth and this GET are read-only; do not create/capture an order or touch the DB.
  const webhook = await paypalApi(`/v1/notifications/webhooks/${encodeURIComponent(config.webhookId)}`);
  console.log("PayPal connection: OK", {
    oauth: "OK",
    webhook: "OK",
    expectedUrlMatches: webhook.url === new URL("/api/payments/paypal/webhook", process.env.CLIENT_URL || process.env.PUBLIC_BASE_URL).href,
    eventTypes: webhook.event_types?.map((event) => event.name),
  });
} catch (error) {
  console.error("PayPal connection: FAILED", {
    code: error.code || "PAYPAL_CHECK_FAILED",
    stage: error.paypalStage || "configuration",
    http: error.paypalStatus || null,
    issue: error.paypalIssue || null,
    debugId: error.paypalDebugId || null,
  });
  process.exitCode = 1;
}
