export function paymentError(message, code, status = 400) {
  return Object.assign(new Error(message), { code, status });
}

export function paymentProvider(value) {
  const provider = value === undefined ? "sepay" : String(value);
  if (!["sepay", "paypal"].includes(provider)) {
    throw paymentError("Invalid payment provider", "PAYMENT_PROVIDER_INVALID");
  }
  return provider;
}

export function usdCents(value) {
  const text = String(value ?? "");
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) {
    throw paymentError("Invalid USD amount", "PAYMENT_AMOUNT_INVALID");
  }
  const [whole, fraction = ""] = text.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) throw paymentError("Invalid USD amount", "PAYMENT_AMOUNT_INVALID");
  return cents;
}

export function paypalPrice(pack, { freeTrial = false } = {}) {
  if (freeTrial && pack.price != null && String(pack.price).trim() !== "" && Number(pack.price) === 0) return 0;
  const cents = pack.paypalPriceCents;
  if (!Number.isSafeInteger(cents) || cents < (freeTrial ? 0 : 1)) {
    throw paymentError("PayPal price is not configured for this package", "PAYPAL_PRICE_UNAVAILABLE", 409);
  }
  return cents;
}

export function adminPaypalPrice(value, { allowZero = false } = {}) {
  if (value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > 100000000) {
    throw paymentError("PayPal price must be an integer number of USD cents", "PAYPAL_PRICE_INVALID");
  }
  return value;
}

export function moneySnapshot(originalMinor, discountPercent = 0, currency = "VND", { minimumMinor = 0 } = {}) {
  if (!Number.isSafeInteger(originalMinor) || originalMinor < 0) {
    throw paymentError("Invalid payment amount", "PAYMENT_AMOUNT_INVALID");
  }
  if (!Number.isFinite(Number(discountPercent)) || discountPercent < 0 || discountPercent > 100) {
    throw paymentError("Invalid payment discount", "PAYMENT_AMOUNT_INVALID");
  }
  const discountMinor = Math.min(Math.max(0, originalMinor - minimumMinor), Math.round(originalMinor * discountPercent / 100));
  const amountMinor = originalMinor - discountMinor;
  const scale = currency === "USD" ? 100 : 1;
  return {
    currency,
    originalAmountMinor: originalMinor,
    discountAmountMinor: discountMinor,
    amountMinor,
    originalAmount: originalMinor / scale,
    discountAmount: discountMinor / scale,
    amount: amountMinor / scale,
  };
}

export function paymentReceiptMoney(order) {
  const currency = order.currency || "VND";
  return {
    currency,
    amountMinor: order.amountMinor ?? Math.round(Number(order.amount || 0) * (currency === "USD" ? 100 : 1)),
  };
}
