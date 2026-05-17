import crypto from "node:crypto";

function requiredEnv(name) {
  return String(process.env[name] || "").trim();
}

export function getVietQrConfig() {
  return {
    bankId: requiredEnv("VIETQR_BANK_ID"),
    accountNo: requiredEnv("VIETQR_ACCOUNT_NO"),
    accountName: requiredEnv("VIETQR_ACCOUNT_NAME"),
    template: requiredEnv("VIETQR_TEMPLATE") || "compact2",
    imageHost:
      requiredEnv("VIETQR_IMAGE_HOST") || "https://api.vietqr.io/image",
    imageExt: requiredEnv("VIETQR_IMAGE_EXT") || "jpg",
  };
}

export function assertVietQrConfigured() {
  const config = getVietQrConfig();
  if (!config.bankId || !config.accountNo || !config.accountName) {
    const error = new Error(
      "VietQR chưa cấu hình. Cần VIETQR_BANK_ID, VIETQR_ACCOUNT_NO, VIETQR_ACCOUNT_NAME trong backend/.env.",
    );
    error.status = 400;
    throw error;
  }
  return config;
}

export function createPaymentCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  // CSPRNG: 9 byte -> 12 char base64url (>72 bit entropy, khong doan duoc).
  const random = crypto
    .randomBytes(9)
    .toString("base64url")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 12);
  return `NAP${stamp}${random}`.slice(0, 24);
}

export function buildVietQrUrl({ amount, paymentCode }) {
  const config = assertVietQrConfigured();
  const base = `${config.imageHost.replace(/\/$/, "")}/${encodeURIComponent(config.bankId)}-${encodeURIComponent(config.accountNo)}-${encodeURIComponent(config.template)}.${encodeURIComponent(config.imageExt)}`;
  const params = new URLSearchParams({
    amount: String(amount),
    addInfo: paymentCode,
    accountName: config.accountName,
  });

  return {
    qrUrl: `${base}?${params.toString()}`,
    bankId: config.bankId,
    accountNo: config.accountNo,
    accountName: config.accountName,
    paymentCode,
  };
}
