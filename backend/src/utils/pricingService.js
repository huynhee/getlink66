export const VND_PER_CNY = Number(process.env.VND_PER_CNY || 4000);
export const WEB_CREDIT_PER_CNY = Number(process.env.WEB_CREDIT_PER_CNY || 10);
export const VND_PER_WEB_CREDIT = VND_PER_CNY / WEB_CREDIT_PER_CNY;

export function topupCreditFromVnd(vnd) {
  const amount = Number(vnd || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.round((amount / VND_PER_WEB_CREDIT) * 10) / 10;
}

export function normalizeDownloadCreditCost(value, fallback = 1) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return fallback;
  return Math.ceil(amount * 10) / 10;
}
