import SiteSetting from "../models/SiteSetting.js";
import { timoConfigurationIssues } from "../config/timoConfig.js";
import { paymentError, paymentProvider } from "./paymentMoney.js";

export function vndProviderIssues(provider) {
  if (provider === "timo") return timoConfigurationIssues({ ...process.env, VND_PAYMENT_PROVIDER: "timo" }, { force: true });
  const issues = [];
  if (process.env.SEPAY_ENABLED === "false") issues.push("SEPAY_ENABLED must be true");
  for (const key of ["SEPAY_MERCHANT_ID", "SEPAY_SECRET_KEY"]) {
    if (!String(process.env[key] || "").trim()) issues.push(`${key} is required`);
  }
  return issues;
}

export async function vndPaymentRouting() {
  const setting = await SiteSetting.findOne({ key: "homepage" }).select("vndPaymentProvider").lean();
  const provider = setting?.vndPaymentProvider || String(process.env.VND_PAYMENT_PROVIDER || "sepay").trim();
  if (!["sepay", "timo"].includes(provider)) throw paymentError("Invalid VND payment configuration", "PAYMENT_PROVIDER_INVALID", 503);
  return { provider, source: setting?.vndPaymentProvider ? "database" : "env", enabled: !vndProviderIssues(provider).length };
}

export async function newPaymentProvider(requested) {
  const explicit = requested === undefined ? null : paymentProvider(requested);
  if (explicit === "paypal") return explicit;
  const { provider } = await vndPaymentRouting();
  if (explicit && explicit !== provider) {
    throw paymentError("Payment method changed. Refresh the page before creating a new order.", "PAYMENT_PROVIDER_CHANGED", 409);
  }
  return provider;
}
