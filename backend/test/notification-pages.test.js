import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";
import { NOTIFICATION_PAGE_KEYS } from "../src/utils/notificationPages.js";
import { NOTIFICATION_PAGES, notificationMatchesPage, notificationPageLabels } from "../../frontend/src/utils/notificationPages.js";

useMemoryDb();
const { default: Notification } = await import("../src/models/Notification.js");
const { default: NotificationReceipt } = await import("../src/models/NotificationReceipt.js");
const {
  adminCreateNotification, adminUpdateNotification, listNotifications,
  markAllNotificationsRead, markNotificationRead,
} = await import("../src/controllers/notificationController.js");

const user = { _id: "notification-page-user" };
const baseBody = { title: "Notice", body: "Fixture content", targetType: "all" };

beforeEach(async () => {
  await Notification.deleteMany({});
  await NotificationReceipt.deleteMany({});
});

async function invoke(handler, input = {}) {
  const res = {
    statusCode: 200, payload: null, error: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return this; },
  };
  await handler({ user, body: {}, params: {}, query: {}, ...input }, res, (error) => { res.error = error; });
  return res;
}

async function create(body = {}) {
  const res = await invoke(adminCreateNotification, { body: { ...baseBody, ...body } });
  assert.equal(res.error, null);
  assert.equal(res.statusCode, 200);
  // The memory store does not apply the schema's isActive default.
  return Notification.findByIdAndUpdate(res.payload.notification._id, { $set: { isActive: true } }, { new: true });
}

async function list(page, options = {}) {
  const res = await invoke(listNotifications, { query: page === undefined ? {} : { page }, ...options });
  assert.equal(res.error, null);
  return res.payload;
}

test("admin page options match the backend whitelist and frontend page matching is exact", () => {
  assert.deepEqual(NOTIFICATION_PAGES.map((page) => page.key), NOTIFICATION_PAGE_KEYS);
  for (const notification of [{}, { displayPages: [] }, { displayPages: null }]) {
    assert.equal(notificationMatchesPage(notification, "home"), true);
    assert.equal(notificationMatchesPage(notification, "getlink"), true);
  }
  assert.equal(notificationMatchesPage({ displayPages: ["getlink"] }, "getlink"), true);
  assert.equal(notificationMatchesPage({ displayPages: ["getlink"] }, "models"), false);
  assert.equal(notificationMatchesPage({ displayPages: ["models", "scenes"] }, "scenes"), true);
  assert.equal(notificationMatchesPage({ displayPages: ["home"] }, ""), true);
  assert.equal(notificationMatchesPage({ displayPages: "getlink" }, "getlink"), false);
  assert.equal(notificationPageLabels(["home", "getlink"], "vi"), "Trang chủ, Getlink");
  assert.equal(notificationPageLabels(["home", "getlink"], "en"), "Homepage, Getlink");
  assert.equal(notificationPageLabels([], "en"), "All pages");
});

test("legacy notifications and newly created all-page notices stay visible on every page", async () => {
  await Notification.create({ ...baseBody, title: "Legacy", isActive: true });
  await Notification.create({ ...baseBody, title: "Legacy null", isActive: true, displayPages: null });
  const fresh = await create({ title: "New global" });
  assert.deepEqual(fresh.displayPages, []);
  for (const page of [undefined, ...NOTIFICATION_PAGE_KEYS]) {
    const result = await list(page);
    assert.equal(result.notifications.length, 3);
    assert.ok(result.notifications.every((item) => item.displayPages.length === 0));
  }
});

test("Getlink-only bell and fullscreen notices are hidden from other pages and older clients", async () => {
  const bell = await create({ title: "Getlink bell", displayPages: ["getlink"] });
  const popup = await create({ title: "Getlink popup", displayType: "fullscreen", displayPages: ["getlink"] });
  const global = await create({ title: "Global" });
  const visible = await list("getlink");
  assert.deepEqual(new Set(visible.notifications.map((item) => item._id)), new Set([bell._id, popup._id, global._id]));
  assert.equal(visible.unreadCount, 3);
  for (const page of [undefined, "home", "models", "scenes", "topup", "admin"]) {
    const result = await list(page);
    assert.deepEqual(result.notifications.map((item) => item._id), [global._id]);
    assert.equal(result.unreadCount, 1);
  }
});

test("one notice can target multiple pages and duplicate selections are normalized", async () => {
  const notice = await create({ displayPages: ["models", "scenes", "models"] });
  assert.deepEqual(notice.displayPages, ["models", "scenes"]);
  for (const page of ["models", "scenes"]) assert.equal((await list(page)).notifications[0]._id, notice._id);
  assert.equal((await list("getlink")).notifications.length, 0);
});

test("page filtering happens before the public 50-notice limit", async () => {
  const expected = await Notification.create({ ...baseBody, displayPages: ["getlink"], isActive: true, createdAt: "2020-01-01T00:00:00Z" });
  await Notification.findByIdAndUpdate(expected._id, { $set: { createdAt: "2020-01-01T00:00:00Z" } });
  for (let index = 0; index < 55; index += 1) {
    await create({ title: `Scene notice ${index}`, displayPages: ["scenes"] });
  }
  assert.deepEqual((await list("getlink")).notifications.map((item) => item._id), [expected._id]);
});

test("page scope never bypasses recipient, schedule, expiry or active checks", async () => {
  const visible = await Notification.create({ ...baseBody, targetType: "users", userIds: [user._id], displayPages: ["getlink"], isActive: true });
  for (const extra of [
    { targetType: "users", userIds: ["other-user"] },
    { startsAt: new Date(Date.now() + 60_000) },
    { expiresAt: new Date(Date.now() - 60_000) },
    { isActive: false },
  ]) await Notification.create({ ...baseBody, displayPages: ["getlink"], isActive: true, ...extra });
  assert.deepEqual((await list("getlink")).notifications.map((item) => item._id), [visible._id]);
  assert.equal((await list("getlink", { user: { _id: "unrelated-user" } })).notifications.length, 0);
  assert.equal((await list("models")).notifications.length, 0);
});

test("admin rejects malformed page scopes without creating or changing notices", async () => {
  const existing = await create({ displayPages: ["getlink"] });
  for (const displayPages of [null, "getlink", {}, ["unknown"], ["/getlink"], [1], Array(17).fill("getlink")]) {
    const body = { ...baseBody, displayPages };
    const created = await invoke(adminCreateNotification, { body });
    assert.equal(created.error?.status, 400);
    const updated = await invoke(adminUpdateNotification, { params: { id: existing._id }, body });
    assert.equal(updated.error?.status, 400);
    assert.deepEqual((await Notification.findById(existing._id)).displayPages, ["getlink"]);
  }
  assert.equal(await Notification.countDocuments(), 1);
});

test("editing scope persists, clears read receipts, and explicit empty scope restores all pages", async () => {
  const existing = await create();
  await invoke(markNotificationRead, { params: { id: existing._id }, query: { page: "getlink" } });
  assert.equal(await NotificationReceipt.countDocuments(), 1);
  const updated = await invoke(adminUpdateNotification, {
    params: { id: existing._id }, body: { ...baseBody, displayPages: ["getlink"] },
  });
  assert.equal(updated.error, null);
  assert.deepEqual(updated.payload.notification.displayPages, ["getlink"]);
  assert.equal(await NotificationReceipt.countDocuments(), 0);
  assert.equal((await list("home")).notifications.length, 0);
  assert.equal((await list("getlink")).notifications[0].isRead, false);
  await invoke(adminUpdateNotification, { params: { id: existing._id }, body: { ...baseBody, displayPages: [] } });
  assert.equal((await list("home")).notifications[0]._id, existing._id);
});

test("an older admin edit which omits displayPages preserves a restricted notice", async () => {
  const existing = await create({ displayPages: ["getlink"] });
  const result = await invoke(adminUpdateNotification, {
    params: { id: existing._id }, body: { ...baseBody, title: "Updated title" },
  });
  assert.equal(result.error, null);
  assert.deepEqual(result.payload.notification.displayPages, ["getlink"]);
  assert.equal((await list("home")).notifications.length, 0);
});

test("mark-all only reads the current page and preserves unread notices on other pages", async () => {
  const global = await create();
  const getlink = await create({ displayPages: ["getlink"] });
  const models = await create({ displayPages: ["models"] });
  const marked = await invoke(markAllNotificationsRead, { query: { page: "getlink" } });
  assert.equal(marked.payload.markedCount, 2);
  assert.equal((await list("getlink")).unreadCount, 0);
  const elsewhere = await list("models");
  assert.equal(elsewhere.unreadCount, 1);
  assert.equal(elsewhere.notifications.find((item) => item._id === global._id).isRead, true);
  assert.equal(elsewhere.notifications.find((item) => item._id === models._id).isRead, false);
  const receipts = await NotificationReceipt.find().lean();
  assert.deepEqual(new Set(receipts.map((item) => item.notificationId)), new Set([global._id, getlink._id]));
});

test("single-read does not mark a hidden or unauthorized scoped notice", async () => {
  const notice = await create({ displayPages: ["getlink"] });
  for (const query of [{}, { page: "home" }, { page: "models" }]) {
    const result = await invoke(markNotificationRead, { params: { id: notice._id }, query });
    assert.equal(result.statusCode, 404);
  }
  await Notification.findByIdAndUpdate(notice._id, { $set: { targetType: "users", userIds: ["other-user"] } });
  const result = await invoke(markNotificationRead, { params: { id: notice._id }, query: { page: "getlink" } });
  assert.equal(result.statusCode, 404);
  assert.equal(await NotificationReceipt.countDocuments(), 0);
});

test("malformed or unknown page queries cannot widen listing or read operations", async () => {
  const notice = await create({ displayPages: ["getlink"] });
  for (const page of ["", "unknown", "/getlink", ["getlink", "models"], { $ne: "getlink" }]) {
    for (const handler of [listNotifications, markAllNotificationsRead, markNotificationRead]) {
      const result = await invoke(handler, { params: { id: notice._id }, query: { page } });
      assert.equal(result.error?.status, 400);
      assert.equal(result.payload, null);
    }
  }
  assert.equal(await NotificationReceipt.countDocuments(), 0);
});

test("repeat-on-visit defaults off for old notices and remains available after reading", async () => {
  await Notification.create({ ...baseBody, title: "Legacy", isActive: true });
  const once = await create({ displayType: "fullscreen" });
  assert.equal(once.repeatOnVisit, false);
  const repeated = await create({ displayType: "fullscreen", displayPages: ["getlink"], repeatOnVisit: true });
  await invoke(markNotificationRead, { params: { id: repeated._id }, query: { page: "getlink" } });
  const notices = (await list("getlink")).notifications;
  assert.equal(notices.find((item) => item.title === "Legacy").repeatOnVisit, false);
  assert.equal(notices.find((item) => item._id === once._id).repeatOnVisit, false);
  assert.equal(notices.find((item) => item._id === repeated._id).repeatOnVisit, true);
  assert.equal(notices.find((item) => item._id === repeated._id).isRead, true);
  assert.ok(!(await list("models")).notifications.some((item) => item._id === repeated._id));
});

test("admin can enable and disable repeat-on-visit while older edits preserve the setting", async () => {
  const notice = await create({ displayType: "fullscreen" });
  const update = async (patch) => {
    const result = await invoke(adminUpdateNotification, {
      params: { id: notice._id }, body: { ...baseBody, displayType: "fullscreen", ...patch },
    });
    assert.equal(result.error, null);
    return result.payload.notification;
  };
  assert.equal((await update({ repeatOnVisit: true })).repeatOnVisit, true);
  assert.equal((await update({ title: "Older admin edit" })).repeatOnVisit, true);
  assert.equal((await update({ repeatOnVisit: false })).repeatOnVisit, false);
});

test("invalid repeat flags cannot be coerced into enabling popup replay", async () => {
  const notice = await create({ repeatOnVisit: true });
  for (const repeatOnVisit of [null, "true", "false", 0, 1, [], {}]) {
    const body = { ...baseBody, repeatOnVisit };
    const created = await invoke(adminCreateNotification, { body });
    const updated = await invoke(adminUpdateNotification, { params: { id: notice._id }, body });
    assert.equal(created.error?.status, 400);
    assert.equal(updated.error?.status, 400);
    assert.equal((await Notification.findById(notice._id)).repeatOnVisit, true);
  }
  assert.equal(await Notification.countDocuments(), 1);
});
