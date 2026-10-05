export function checkoutCurrency(language) {
  return language === "en" ? "USD" : "VND";
}

export function packagePrice(pack, language, { pro = false } = {}) {
  if (language !== "en") {
    if (pro) return Number(pack?.price || 0);
    return Number(pack?.salePrice || 0) > 0 ? Number(pack.salePrice) : Math.round(Number(pack?.price || 0) * (100 - Number(pack?.salePercent || 0)) / 100);
  }
  if (pro && Number(pack?.price) === 0) return 0;
  if (!Number.isSafeInteger(pack?.paypalPriceCents)) return null;
  return pack.paypalPriceCents / 100;
}

export function discountedPaymentPrice(price, percent, currency) {
  if (price === null) return null;
  const scale = currency === "USD" ? 100 : 1;
  const originalMinor = Math.round(price * scale);
  return (originalMinor - Math.min(originalMinor, Math.round(originalMinor * Number(percent || 0) / 100))) / scale;
}

export function formatPaymentMoney(value, currency = "VND", locale = "vi-VN") {
  if (value === null || value === undefined) return locale === "vi-VN" ? "Chưa có giá" : "Price unavailable";
  if (currency === "USD") return `US$${Number(value).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return `${Number(value).toLocaleString(locale)}đ`;
}

export function parseAdminUsdPrice(value) {
  if (value === "") return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(String(value))) throw new Error("PayPal price must have at most two decimal places");
  const [whole, fraction = ""] = String(value).split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function submitPaymentCheckout(payment) {
  if (!payment?.checkoutUrl) return false;
  if (payment.provider === "paypal" && payment.method === "GET") {
    const url = new URL(payment.checkoutUrl);
    if (url.protocol !== "https:" || !["www.paypal.com", "www.sandbox.paypal.com"].includes(url.hostname) || url.username || url.password || url.port) return false;
    window.location.assign(url.href);
    return true;
  }
  if (!payment.fields) return false;
  const form = document.createElement("form");
  form.method = "POST";
  form.action = payment.checkoutUrl;
  form.style.display = "none";
  Object.entries(payment.fields).forEach(([name, value]) => {
    if (value === undefined || value === null) return;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = String(value);
    form.appendChild(input);
  });
  document.body.appendChild(form);
  form.submit();
  return true;
}
