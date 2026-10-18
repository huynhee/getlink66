import test from "node:test";
import assert from "node:assert/strict";
import { createTimoPollScheduler, TIMO_ACTIVE_POLL_MS, TIMO_IDLE_POLL_MS, TIMO_MAX_BACKOFF_MS } from "../src/utils/timoPollScheduler.js";

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function clock() {
  let now = 0;
  const timers = new Set();
  return {
    now: () => now,
    setTimer(fn, delay) {
      const timer = { at: now + delay, fn, unref() {} };
      timers.add(timer);
      return timer;
    },
    clearTimer: (timer) => timers.delete(timer),
    pending: () => timers.size,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a.at - b.at)[0];
        if (!next || next.at > end) break;
        now = next.at;
        timers.delete(next);
        next.fn();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}

test("Timo scheduler accelerates idle polling on demand but coalesces repeated wakes", async () => {
  const time = clock();
  const calls = [];
  const scheduler = createTimoPollScheduler({ ...time, run: async () => { calls.push(time.now()); return { nextPollMs: TIMO_IDLE_POLL_MS }; } });
  assert.equal(scheduler.wake(), false);
  scheduler.start();
  scheduler.start();
  await time.advance(0);
  assert.deepEqual(calls, [0]);
  for (let index = 0; index < 100; index += 1) scheduler.wake();
  assert.equal(time.pending(), 1);
  await time.advance(TIMO_ACTIVE_POLL_MS - 1);
  assert.equal(calls.length, 1);
  await time.advance(1);
  assert.deepEqual(calls, [0, 5000]);
  await time.advance(TIMO_IDLE_POLL_MS - 1);
  assert.equal(calls.length, 2);
  await time.advance(1);
  assert.deepEqual(calls, [0, 5000, 35000]);
  await scheduler.stop();
  assert.equal(time.pending(), 0);
});

test("active polling continues without an open browser and returns to idle afterwards", async () => {
  const time = clock();
  let count = 0;
  const scheduler = createTimoPollScheduler({ ...time, run: async () => ({ nextPollMs: ++count < 3 ? TIMO_ACTIVE_POLL_MS : TIMO_IDLE_POLL_MS }) });
  scheduler.start();
  await time.advance(10000);
  assert.equal(count, 3);
  await time.advance(29999);
  assert.equal(count, 3);
  await time.advance(1);
  assert.equal(count, 4);
  await scheduler.stop();
});

test("wakes during a running scan cannot overlap Gmail calls or get lost", async () => {
  const time = clock();
  let release;
  let count = 0;
  const scheduler = createTimoPollScheduler({ ...time, run: () => { count += 1; return new Promise((resolve) => { release = resolve; }); } });
  scheduler.start();
  await time.advance(0);
  for (let index = 0; index < 100; index += 1) scheduler.wake();
  await time.advance(20000);
  assert.equal(count, 1);
  assert.equal(time.pending(), 0);
  release({ nextPollMs: TIMO_IDLE_POLL_MS });
  await flush();
  await time.advance(4999);
  assert.equal(count, 1);
  await time.advance(1);
  assert.equal(count, 2);
  const stopped = scheduler.stop();
  release({ nextPollMs: TIMO_ACTIVE_POLL_MS });
  await stopped;
  await flush();
  assert.equal(time.pending(), 0);
});

test("Gmail backoff cannot be shortened by repeated checkout or focus requests", async () => {
  const time = clock();
  let calls = 0;
  const failures = [];
  const scheduler = createTimoPollScheduler({ ...time, onError: (error) => failures.push(error.code), run: async () => {
    calls += 1;
    if (calls === 1) throw Object.assign(new Error("Fixture rate limit"), { code: "TIMO_GMAIL_UNAVAILABLE", retryAfterMs: 60000 });
    return { nextPollMs: TIMO_IDLE_POLL_MS };
  } });
  scheduler.start();
  await time.advance(0);
  assert.deepEqual(failures, ["TIMO_GMAIL_UNAVAILABLE"]);
  for (let index = 0; index < 100; index += 1) scheduler.wake();
  await time.advance(59999);
  assert.equal(calls, 1);
  await time.advance(1);
  assert.equal(calls, 2);
  await scheduler.stop();
});

test("another worker's persisted cooldown is respected locally", async () => {
  const time = clock();
  let calls = 0;
  const scheduler = createTimoPollScheduler({ ...time, run: async () => { calls += 1; return { busy: true, nextPollMs: 90000 }; } });
  scheduler.start();
  await time.advance(0);
  scheduler.wake();
  await time.advance(89999);
  assert.equal(calls, 1);
  await time.advance(1);
  assert.equal(calls, 2);
  await scheduler.stop();
});

test("stopped polling never restarts itself, and restart creates only one timer", async () => {
  const time = clock();
  let count = 0;
  const scheduler = createTimoPollScheduler({ ...time, run: async () => { count += 1; return { nextPollMs: TIMO_ACTIVE_POLL_MS }; } });
  scheduler.start();
  await time.advance(0);
  await scheduler.stop();
  assert.equal(scheduler.wake(), false);
  await time.advance(60000);
  assert.equal(count, 1);
  scheduler.start();
  scheduler.start();
  assert.equal(time.pending(), 1);
  await time.advance(0);
  assert.equal(count, 2);
  await scheduler.stop();
});

test("backoff timers are bounded even for unexpected retry values", async () => {
  const time = clock();
  let calls = 0;
  const scheduler = createTimoPollScheduler({ ...time, run: async () => {
    calls += 1;
    throw Object.assign(new Error("Fixture outage"), { retryAfterMs: Number.MAX_SAFE_INTEGER });
  } });
  scheduler.start();
  await time.advance(TIMO_MAX_BACKOFF_MS - 1);
  assert.equal(calls, 1);
  await time.advance(1);
  assert.equal(calls, 2);
  await scheduler.stop();
});
