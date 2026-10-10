export const NOTIFICATION_PAGES = [
  { key: "home", vi: "Trang chủ", en: "Homepage" },
  { key: "getlink", vi: "Getlink", en: "Getlink" },
  { key: "models", vi: "Model", en: "Models" },
  { key: "scenes", vi: "Scene", en: "Scenes" },
  { key: "topup", vi: "Gói nạp", en: "Top-up" },
  { key: "membership", vi: "Subscription", en: "Subscription" },
  { key: "history", vi: "Lịch sử", en: "History" },
  { key: "invite", vi: "Giới thiệu bạn bè", en: "Referrals" },
  { key: "guide", vi: "Hướng dẫn", en: "Guides" },
  { key: "plugin", vi: "Tải plugin", en: "Plugin downloads" },
  { key: "privacy", vi: "Chính sách bảo mật", en: "Privacy policy" },
  { key: "terms", vi: "Điều khoản", en: "Terms" },
  { key: "pluginActivate", vi: "Đăng nhập plugin", en: "Plugin sign-in" },
  { key: "pluginSessions", vi: "Phiên plugin", en: "Plugin sessions" },
  { key: "pluginChallenge", vi: "Xác minh lượt tải plugin", en: "Plugin download verification" },
  { key: "admin", vi: "Admin", en: "Admin" },
];

export function notificationMatchesPage(notification, page = "home") {
  const pages = notification.displayPages;
  if (pages == null) return true;
  return Array.isArray(pages) && (!pages.length || pages.includes(page || "home"));
}

export function notificationPageLabels(pages, language = "vi") {
  if (!Array.isArray(pages) || !pages.length) return language === "vi" ? "Tất cả trang" : "All pages";
  return pages.map((key) => {
    const option = NOTIFICATION_PAGES.find((page) => page.key === key);
    return option?.[language === "vi" ? "vi" : "en"] || key;
  }).join(", ");
}
