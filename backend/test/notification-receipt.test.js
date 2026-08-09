import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: Notification } = await import("../src/models/Notification.js");
const {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} = await import("../src/controllers/notificationController.js");

function responseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.payload = value;
      return value;
    },
  };
}

test("notification reads use a separate receipt and keep legacy readBy bounded", async () => {
  const user = { _id: "notification-user-1" };
  const notification = await Notification.create({
    title: "Notice",
    body: "Body",
    targetType: "all",
    isActive: true,
  });

  const before = responseRecorder();
  await listNotifications({ user }, before, (error) => { throw error; });
  assert.equal(before.payload.notifications[0].isRead, false);

  const marked = responseRecorder();
  await markNotificationRead(
    { user, params: { id: notification._id } },
    marked,
    (error) => { throw error; },
  );
  assert.equal(marked.payload.ok, true);

  const after = responseRecorder();
  await listNotifications({ user }, after, (error) => { throw error; });
  assert.equal(after.payload.notifications[0].isRead, true);
  assert.equal((await Notification.findById(notification._id)).readBy, undefined);
});

test("opening notifications can mark every visible notification as read", async () => {
  const user = { _id: "notification-user-read-all" };
  await Notification.create({
    title: "Global notice",
    body: "Visible to everyone",
    targetType: "all",
    isActive: true,
  });
  await Notification.create({
    title: "Private notice",
    body: "Visible to this user",
    targetType: "users",
    userIds: [user._id],
    isActive: true,
  });

  const marked = responseRecorder();
  await markAllNotificationsRead({ user }, marked, (error) => { throw error; });
  assert.equal(marked.payload.ok, true);
  assert.ok(marked.payload.markedCount >= 2);

  const after = responseRecorder();
  await listNotifications({ user }, after, (error) => { throw error; });
  assert.ok(after.payload.notifications.length >= 2);
  assert.equal(after.payload.notifications.every((item) => item.isRead), true);
  assert.equal(after.payload.unreadCount, 0);
});
