export function formatReferralReward({ proDays = 0, credit = 0, modelDownloads = 100 }, language = "vi") {
  const isVi = language === "vi";
  return [
    Number(proDays) > 0 ? (isVi ? `Pro hôm nay (${modelDownloads} lượt Model)` : `Pro today (${modelDownloads} Model downloads)`) : "",
    Number(credit) > 0 ? `${credit} ${isVi ? "credit" : "credits"}` : "",
  ].filter(Boolean).join(" + ");
}

export function referralInviteTitle(reward, language = "vi") {
  const label = formatReferralReward(reward, language);
  if (reward.mode === "referrer_only") {
    return language === "vi" ? `Mời bạn bè để nhận ${label}.` : `Invite friends to receive ${label}.`;
  }
  return language === "vi" ? `Mời bạn bè, cả hai nhận ${label}.` : `Invite friends and both receive ${label}.`;
}
