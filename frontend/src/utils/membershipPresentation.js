const VI_FEATURE_LABELS = new Map([
  ["member models", "Tải Model/Scene Pro"],
  ["pro models", "Tải Model/Scene Pro"],
  ["fast download", "Tải nhanh"],
  ["s-vip access", "Quyền truy cập S-VIP"],
  ["keep existing monthly pro", "Giữ nguyên gói Pro tháng hiện tại"],
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
  const dailyPlan = String(plan?.code || "").toUpperCase() === "DAILY"
    || Number(plan?.durationDays || 0) <= 1;
  const standard = language === "vi"
    ? dailyPlan
      ? [
          `Quyền Pro đến 23:59 hôm nay; nếu đang Pro, cộng thêm ${dailyLimit} lượt hôm nay`,
          "Model trừ 1 lượt, Scene trừ 5 lượt",
          "Dùng quota Pro, không trừ Credit",
        ]
      : [
          `${dailyLimit} lượt/ngày: Model trừ 1 lượt, Scene trừ 5 lượt`,
          "Tải Model/Scene Pro, không trừ Credit",
          "Hết hạn lúc 23:59 ngày cuối của gói",
        ]
    : dailyPlan
      ? [
          `Pro access until 23:59 today; active Pro users receive ${dailyLimit} extra downloads today`,
          "Model costs 1 download, Scene costs 5 downloads",
          "Uses Pro quota and does not spend Credits",
        ]
      : [
          `${dailyLimit}/day: Model costs 1 download, Scene costs 5 downloads`,
          "Download Pro Models/Scenes without spending Credits",
          "Expires at 23:59 on the final day",
        ];
  const custom = (plan?.features || [])
    .filter((feature) => !isGeneratedFeature(feature))
    .map((feature) => membershipFeatureLabel(feature, language));
  return [...standard, ...custom].filter((value, index, items) => items.indexOf(value) === index);
}

export function membershipDurationLabel(plan, language = "vi", separator = " · ") {
  const durationDays = Number(plan?.durationDays || 0);
  const dailyLimit = Number(plan?.dailyDownloadLimit || 0);
  const dailyPlan = String(plan?.code || "").toUpperCase() === "DAILY" || durationDays <= 1;
  if (language === "vi") {
    return dailyPlan
      ? `Đến 23:59 hôm nay${separator}${dailyLimit} lượt`
      : `${durationDays} ngày${separator}${dailyLimit} lượt/ngày`;
  }
  return dailyPlan
    ? `Until 23:59 today${separator}${dailyLimit} downloads`
    : `${durationDays} days${separator}${dailyLimit}/day`;
}
