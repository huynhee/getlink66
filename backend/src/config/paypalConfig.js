export function paypalConfigurationIssues(env = process.env) {
  const errors = [];
  const enabled = env.PAYPAL_ENABLED === "true";
  if (env.PAYPAL_ENABLED && !["true", "false"].includes(env.PAYPAL_ENABLED)) errors.push("PAYPAL_ENABLED must be true or false");
  if (env.PAYPAL_ENV && !["sandbox", "live"].includes(env.PAYPAL_ENV)) errors.push("PAYPAL_ENV must be sandbox or live");
  const keys = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID", "PAYPAL_MERCHANT_ID"];
  if (enabled || keys.some((key) => String(env[key] || "").trim())) {
    for (const key of keys) {
      const value = String(env[key] || "").trim();
      if (!value || /^REPLACE|^CHANGEME|^<.*>$/i.test(value)) errors.push(`${key} is required for PayPal checkout and reconciliation`);
    }
    try {
      const url = new URL(env.CLIENT_URL || env.PUBLIC_BASE_URL);
      if (env.NODE_ENV === "production" && url.protocol !== "https:") errors.push("PayPal return URL must use HTTPS in production");
    } catch { errors.push("CLIENT_URL must be a valid absolute URL for PayPal returns"); }
  }
  return errors;
}
