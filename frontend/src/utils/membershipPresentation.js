const VI_FEATURE_LABELS = new Map([
  ["member models", "Tải Model/Scene Pro"],
  ["pro models", "Tải Model/Scene Pro"],
  ["fast download", "Tải nhanh"],
  ["s-vip access", "Quyền truy cập S-VIP"],
  ["keep existing monthly pro", "Giữ nguyên gói Pro tháng hiện tại"],
]);

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

export function membershipDurationLabel(plan, language = "vi", separator = " · ") {
  const durationDays = Number(plan?.durationDays || 0);
  const dailyLimit = Number(plan?.dailyDownloadLimit || 0);
  if (language === "vi") {
    return `${durationDays} ngày${separator}${dailyLimit} lượt/ngày`;
  }
  return `${durationDays} ${durationDays === 1 ? "day" : "days"}${separator}${dailyLimit}/day`;
}
