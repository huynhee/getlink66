import assert from "node:assert/strict";
import test from "node:test";
import { notifyServerError } from "../src/utils/telegramNotifier.js";

test("server error alerts omit download tokens from request paths", async () => {
  const prior = {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    enabled: process.env.TELEGRAM_NOTIFICATIONS_ENABLED,
    fetch: globalThis.fetch,
  };
  const sent = [];
  try {
    process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";
    process.env.TELEGRAM_CHAT_ID = "test-chat";
    process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "true";
    globalThis.fetch = async (_url, options) => {
      sent.push(JSON.parse(options.body).text);
      return new Response("ok", { status: 200 });
    };

    notifyServerError({
      error: new Error("terminated"),
      req: {
        method: "GET",
        originalUrl: "/api/download/session/example/file?t=private-download-token",
        correlationId: "download-test-id",
        ip: "127.0.0.1",
      },
      status: 502,
    });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(sent.length, 1);
    assert.match(sent[0], /GET \/api\/download\/session\/example\/file/);
    assert.match(sent[0], /Correlation: <code>download-test-id<\/code>/);
    assert.doesNotMatch(sent[0], /private-download-token|\?t=/);
  } finally {
    if (prior.token === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = prior.token;
    if (prior.chatId === undefined) delete process.env.TELEGRAM_CHAT_ID;
    else process.env.TELEGRAM_CHAT_ID = prior.chatId;
    if (prior.enabled === undefined) delete process.env.TELEGRAM_NOTIFICATIONS_ENABLED;
    else process.env.TELEGRAM_NOTIFICATIONS_ENABLED = prior.enabled;
    globalThis.fetch = prior.fetch;
  }
});
