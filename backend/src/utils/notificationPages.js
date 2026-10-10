export const NOTIFICATION_PAGE_KEYS = [
  "home", "getlink", "models", "scenes", "topup", "membership", "history", "invite",
  "guide", "plugin", "privacy", "terms", "pluginActivate", "pluginSessions", "pluginChallenge", "admin",
];

export function parseNotificationDisplayPages(value = []) {
  if (!Array.isArray(value) || value.length > NOTIFICATION_PAGE_KEYS.length
    || value.some((page) => typeof page !== "string" || !NOTIFICATION_PAGE_KEYS.includes(page))) {
    throw Object.assign(new Error("Invalid notification display pages"), { status: 400 });
  }
  return [...new Set(value)];
}

export function parseNotificationRepeatOnVisit(value = false) {
  if (typeof value !== "boolean") {
    throw Object.assign(new Error("Invalid notification repeat setting"), { status: 400 });
  }
  return value;
}

export function notificationPageFromRequest(req) {
  const page = req.query?.page;
  if (page === undefined) return "";
  if (typeof page !== "string" || !NOTIFICATION_PAGE_KEYS.includes(page)) {
    throw Object.assign(new Error("Invalid notification page"), { status: 400 });
  }
  return page;
}

export function notificationPageQuery(page) {
  // The first-element check covers legacy records and an empty all-pages scope.
  const allPages = { "displayPages.0": { $exists: false } };
  return page ? { $or: [allPages, { displayPages: page }] } : allPages;
}
