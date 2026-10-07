import { packagePrice } from "./paymentPresentation.js";

export const SUBSCRIPTION_PERIODS = ["day", "month", "year"];
export const DEFAULT_SUBSCRIPTION_PERIOD = "month";

export function subscriptionBillingPeriod(plan) {
  if (SUBSCRIPTION_PERIODS.includes(plan?.billingPeriod)) return plan.billingPeriod;
  const durationDays = Number(plan?.durationDays);
  if (Number.isFinite(durationDays) && durationDays <= 1) return "day";
  return durationDays >= 365 ? "year" : "month";
}

export function subscriptionPeriodLabel(period, language = "vi") {
  const labels = language === "vi"
    ? { day: "Ngày", month: "Tháng", year: "Năm" }
    : { day: "Day", month: "Month", year: "Year" };
  return labels[period] || labels.month;
}

export function subscriptionPlansForPeriod(plans, period = DEFAULT_SUBSCRIPTION_PERIOD) {
  return (plans || []).filter((plan) => plan.isActive !== false && subscriptionBillingPeriod(plan) === period);
}

export function initialSubscriptionSelection(plans, requestedPlanId = "", period = DEFAULT_SUBSCRIPTION_PERIOD) {
  const available = (plans || []).filter((plan) => plan.isActive !== false);
  const requested = available.find((plan) => String(plan._id) === String(requestedPlanId));
  return requested
    ? { period: subscriptionBillingPeriod(requested), planId: String(requested._id) }
    : { period, planId: String(subscriptionPlansForPeriod(available, period)[0]?._id || "") };
}

export function subscriptionPlanPrice(plan, language = "vi") {
  if (plan?.price === null || plan?.price === undefined || String(plan.price).trim() === "") return null;
  const vndPrice = Number(plan.price);
  if (!Number.isFinite(vndPrice) || vndPrice < 0) return null;
  const price = packagePrice(plan, language, { pro: true });
  return price !== null && Number.isFinite(price) && price >= 0 ? price : null;
}

export function subscriptionDateLabel(value, language = "vi", { exclusiveEnd = false } = {}) {
  if (!value) return "-";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "-";
  return new Intl.DateTimeFormat(language === "vi" ? "vi-VN" : "en-GB", {
    timeZone: "Asia/Saigon",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(time - (exclusiveEnd ? 1 : 0)));
}

export function subscriptionMembershipFromResponse(data) {
  if (!data?.membership) return null;
  return {
    ...data.membership,
    currentPeriod: data.currentPeriod ?? data.membership.currentPeriod ?? null,
    upcomingPeriods: data.upcomingPeriods ?? data.membership.upcomingPeriods ?? [],
  };
}

export function subscriptionApprovalMessage(data, language = "vi", { free = false } = {}) {
  const order = data?.order || {};
  const startsAt = data?.activatedFrom || order.activatedFrom;
  const startTime = startsAt ? new Date(startsAt).getTime() : NaN;
  const queued = Number.isFinite(startTime) ? startTime > Date.now()
    : data?.subscriptionQueued === true || order.subscriptionQueued === true;
  if (queued) {
    const date = subscriptionDateLabel(startsAt, language);
    return language === "vi"
      ? `Đã thanh toán Subscription, đang chờ bắt đầu${date !== "-" ? ` từ ${date} (giờ Việt Nam)` : ""}. Quota hiện tại không thay đổi.`
      : `Subscription paid, waiting to start${date !== "-" ? ` on ${date} (Vietnam time)` : ""}. Your current quota is unchanged.`;
  }
  if (order.isQuotaAddon || data?.isQuotaAddon) {
    const amount = Number(order.quotaBoostAmount ?? data.quotaBoostAmount ?? order.dailyDownloadLimit);
    return language === "vi"
      ? `Đã cộng${amount > 0 ? ` ${amount}` : ""} lượt tải cho hôm nay. Lịch Subscription không thay đổi.`
      : `Extra downloads${amount > 0 ? ` (${amount})` : ""} added for today. Your Subscription schedule is unchanged.`;
  }
  return language === "vi"
    ? free ? "Subscription miễn phí đã có hiệu lực." : "Thanh toán thành công. Subscription đã có hiệu lực."
    : free ? "Free Subscription is now active." : "Payment successful. Your Subscription is now active.";
}

export function subscriptionCheckoutDescription(plan, membership, language = "vi") {
  if (!plan) return language === "vi" ? "Chọn gói Subscription để tiếp tục." : "Select a Subscription plan to continue.";
  const quota = Number(plan.dailyDownloadLimit || 0);
  if (subscriptionBillingPeriod(plan) === "day" && membership?.active) {
    return language === "vi"
      ? `Cộng thêm ${quota} lượt chỉ hôm nay; không đổi thời hạn hoặc lịch Subscription đã mua.`
      : `Adds ${quota} downloads for today only, without changing your existing Subscription schedule or expiry.`;
  }
  if (membership?.active && subscriptionBillingPeriod(plan) !== "day") {
    return language === "vi"
      ? `${quota} lượt/ngày trong ${plan.durationDays} ngày. Kỳ mới bắt đầu sau các kỳ đã mua; không đổi quota hiện tại.`
      : `${quota} downloads/day for ${plan.durationDays} days. Starts after your purchased periods, without changing your current quota.`;
  }
  return language === "vi"
    ? `${membershipDurationLabel(plan, language)}. Thanh toán từng lần, không tự động gia hạn.`
    : `${membershipDurationLabel(plan, language)}. One-time payment, no automatic renewal.`;
}

export function subscriptionVoucherApplies(voucher, plan) {
  if (!voucher || !plan || voucher.appliesToMembership === false || voucher.targetKind === "credit" || Number(voucher.discountPercent || 0) <= 0) return false;
  const ids = Array.isArray(voucher.applicablePlanIds) ? voucher.applicablePlanIds.map((id) => String(id?._id || id)) : [];
  return ids.length === 0 || ids.includes(String(plan._id));
}

const VI_FEATURE_LABELS = new Map([
  ["member models", "Tải Model/Scene Pro"],
  ["pro models", "Tải Model/Scene Pro"],
  ["fast download", "Tải nhanh"],
  ["s-vip access", "Quyền truy cập S-VIP"],
  ["keep existing monthly pro", "Giữ nguyên lịch Subscription hiện tại"],
]);

const STANDARD_FEATURES = new Set([
  "member models",
  "pro models",
  "fast download",
  "keep existing monthly pro",
]);

function normalizedFeature(feature) {
  return String(feature || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isGeneratedFeature(feature) {
  const normalized = normalizedFeature(feature);
  return STANDARD_FEATURES.has(normalized)
    || /^add\s+\d+\s+downloads?\s+today$/.test(normalized)
    || /^\d+\s+downloads?\/day$/.test(normalized)
    || /^\d+\s+lượt tải(?: model)?(?: mỗi ngày|\/ngày)$/.test(normalized)
    || /^tải (?:model|model\/scene) pro$/.test(normalized)
    || /^model\s*-?\s*1.*scene\s*-?\s*5/.test(normalized);
}

export function membershipFeatureLabel(feature, language = "vi") {
  const value = String(feature || "").trim();
  if (!value || language !== "vi") return value;

  const normalized = value.toLowerCase().replace(/\s+/g, " ");
  if (VI_FEATURE_LABELS.has(normalized)) return VI_FEATURE_LABELS.get(normalized);

  const addToday = normalized.match(/^add\s+(\d+)\s+downloads?\s+today$/);
  if (addToday) return `Cộng thêm ${addToday[1]} lượt tải hôm nay`;

  const daily = normalized.match(/^(\d+)\s+downloads?\/day$/);
  if (daily) return `${daily[1]} lượt tải/ngày`;

  const monthly = normalized.match(/^([0-9.,]+k?)\/month\s*x\s*(\d+)\s*months?$/);
  if (monthly) return `${monthly[1]}/tháng x ${monthly[2]} tháng`;

  return value;
}

export function membershipBenefitLabels(plan, language = "vi") {
  const dailyLimit = Math.max(1, Number(plan?.dailyDownloadLimit || 100));
  const dailyPlan = subscriptionBillingPeriod(plan) === "day";
  const standard = language === "vi"
    ? dailyPlan
      ? [
          `Dùng đến 23:59 hôm nay; nếu đang Subscription, cộng thêm ${dailyLimit} lượt chỉ hôm nay`,
          "Model trừ 1 lượt, Scene trừ 5 lượt",
          "Không trừ Credit, không đổi lịch đã mua",
        ]
      : [
          `${dailyLimit} lượt/ngày: Model trừ 1 lượt, Scene trừ 5 lượt`,
          "Tải Model/Scene Pro, không trừ Credit",
          "Không tự động gia hạn; reset quota lúc 00:00 giờ Việt Nam",
        ]
    : dailyPlan
      ? [
          `Access until 23:59 today; active subscribers receive ${dailyLimit} extra downloads for today only`,
          "Model costs 1 download, Scene costs 5 downloads",
          "No Credits spent; purchased periods stay unchanged",
        ]
      : [
          `${dailyLimit}/day: Model costs 1 download, Scene costs 5 downloads`,
          "Download Pro Models/Scenes without spending Credits",
          "No automatic renewal; quota resets at 00:00 Vietnam time",
        ];
  const custom = (plan?.features || [])
    .filter((feature) => !isGeneratedFeature(feature))
    .map((feature) => membershipFeatureLabel(feature, language));
  return [...standard, ...custom].filter((value, index, items) => items.indexOf(value) === index);
}

export function membershipDurationLabel(plan, language = "vi", separator = " · ") {
  const durationDays = Number(plan?.durationDays || 0);
  const dailyLimit = Number(plan?.dailyDownloadLimit || 0);
  const dailyPlan = subscriptionBillingPeriod(plan) === "day";
  if (language === "vi") {
    return dailyPlan
      ? `Đến 23:59 hôm nay${separator}${dailyLimit} lượt/ngày`
      : `${durationDays} ngày${separator}${dailyLimit} lượt/ngày`;
  }
  return dailyPlan
    ? `Until 23:59 today${separator}${dailyLimit}/day`
    : `${durationDays} days${separator}${dailyLimit}/day`;
}
