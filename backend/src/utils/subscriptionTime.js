export const DAY_MS = 86400000;

export function vietnamDayKey(date = new Date()) {
  return new Date(new Date(date).getTime() + 7 * 3600000).toISOString().slice(0, 10);
}

export function nextVietnamReset(date = new Date()) {
  const [year, month, day] = vietnamDayKey(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 17));
}

export function endOfVietnamDay(date = new Date()) {
  return new Date(nextVietnamReset(date).getTime() - 1);
}

export function normalizeProUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? endOfVietnamDay(date) : null;
}

export function subscriptionEnd(startsAt, durationDays) {
  if (!Number.isSafeInteger(durationDays) || durationDays < 1) {
    throw new Error("Subscription duration must be a positive integer");
  }
  return nextVietnamReset(new Date(new Date(startsAt).getTime() + (durationDays - 1) * DAY_MS));
}

export function billingPeriodFor(plan) {
  if (["day", "month", "year"].includes(plan?.billingPeriod)) return plan.billingPeriod;
  return Number(plan?.durationDays) <= 1 ? "day" : Number(plan?.durationDays) >= 365 ? "year" : "month";
}
