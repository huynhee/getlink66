import test from "node:test";
import assert from "node:assert/strict";

process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "true";
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
process.env.TELEGRAM_CHAT_ID = "123456";
process.env.TELEGRAM_DEDUP_WINDOW_MS = "0";

const { notifyMembershipApproved } = await import("../src/utils/telegramNotifier.js");

test("approved Pro orders send a Telegram notification", async () => {
  const originalFetch = globalThis.fetch;
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true };
  };

  try {
    await notifyMembershipApproved({
      order: {
        _id: "membership-order-1",
        planName: "Silver",
        amount: 199000,
        paymentCode: "PRO123456",
        activatedUntil: new Date("2026-08-31T16:59:59.999Z"),
      },
      user: { email: "pro@example.test" },
      source: "Payment webhook",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.match(request.url, /\/bottest-bot-token\/sendMessage$/);
  const body = JSON.parse(request.options.body);
  assert.equal(body.chat_id, "123456");
  assert.match(body.text, /Pro membership approved/);
  assert.match(body.text, /pro@example\.test/);
  assert.match(body.text, /Silver/);
  assert.match(body.text, /PRO123456/);
});
