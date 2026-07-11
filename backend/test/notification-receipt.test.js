import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: Notification } = await import("../src/models/Notification.js");
const {
  listNotifications,
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
