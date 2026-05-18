import { SePayPgClient } from "sepay-pg-node";

let client;

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    const error = new Error(`Sepay chua cau hinh ${name}.`);
    error.status = 500;
    throw error;
  }
  return value;
}

function frontendUrl(path) {
  const base = String(process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
  return `${base}${path}`;
}

export function getSepayClient() {
  if (client) return client;
  client = new SePayPgClient({
    env: process.env.SEPAY_ENV === "production" ? "production" : "sandbox",
    merchant_id: requiredEnv("SEPAY_MERCHANT_ID"),
    secret_key: requiredEnv("SEPAY_SECRET_KEY"),
  });
  return client;
}

export function assertSepayConfigured() {
  if (process.env.SEPAY_ENABLED === "false") {
    const error = new Error("Sepay payment is disabled.");
    error.status = 503;
    throw error;
  }
  getSepayClient();
}

export function createSepayCheckout({ topup, user, pack }) {
  assertSepayConfigured();
  const sepay = getSepayClient();
  const paymentCode = String(topup.paymentCode || "");
  const successUrl = process.env.SEPAY_SUCCESS_URL || frontendUrl("/topup?payment=success");
  const errorUrl = process.env.SEPAY_ERROR_URL || frontendUrl("/topup?payment=error");
  const cancelUrl = process.env.SEPAY_CANCEL_URL || frontendUrl("/topup?payment=cancel");

  const fields = sepay.checkout.initOneTimePaymentFields({
    operation: "PURCHASE",
    payment_method: process.env.SEPAY_PAYMENT_METHOD || "BANK_TRANSFER",
    order_invoice_number: paymentCode,
    order_amount: Number(topup.amount || 0),
    currency: "VND",
    order_description: `Nap credit 3DIPL ${paymentCode}`,
    customer_id: String(user?._id || topup.userId || ""),
    success_url: successUrl,
    error_url: errorUrl,
    cancel_url: cancelUrl,
    custom_data: JSON.stringify({
      topupId: String(topup._id),
      packageId: String(pack?._id || ""),
      userId: String(user?._id || topup.userId || ""),
    }),
  });

  return {
    provider: "sepay",
    checkoutUrl: sepay.checkout.initCheckoutUrl(),
    fields,
  };
}
