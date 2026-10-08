export const REFERRAL_REWARD_FIELDS = {
  referralRewardCredit: { fallback: 28, min: 1, max: 100000 },
  referralRewardModelDownloads: { fallback: 100, min: 1, max: 100000 },
};

export function validReferralRewardAmount(value, field) {
  const range = REFERRAL_REWARD_FIELDS[field];
  if (!range || (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value)))) return false;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= range.min && amount <= range.max;
}

export function referralRewardAmount(value, field) {
  return validReferralRewardAmount(value, field) ? Number(value) : REFERRAL_REWARD_FIELDS[field].fallback;
}
