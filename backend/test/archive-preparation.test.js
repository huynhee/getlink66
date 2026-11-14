import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { prepareDownloadArchive } from "../src/utils/archivePreparation.js";

const session = { storageProvider: "google_drive", archiveFormat: "zip" };
function options(prepare) {
  const entries = [];
  return { prepare, timeoutMs: 1000, retryDelayMs: 0, correlationId: "qa-correlation",
    entries, log: { info: (data) => entries.push(data), warn: (data) => entries.push(data) } };
}

test("archive preparation uses one attempt normally and logs only safe stage/timing data", async () => {
  const plan = { size: 42 };
  const opts = options(async (_source, _comment, { signal, onStage, pinDriveVersion }) => {
    assert.equal(pinDriveVersion, true);
    assert.equal(signal.aborted, false);
    onStage("read_archive_probe");
    return plan;
  });
  assert.equal(await prepareDownloadArchive({ ...session, driveFileId: "private-source-id" }, "private-trace-token", opts), plan);
  assert.equal(opts.entries.length, 1);
  assert.equal(opts.entries[0].stage, "complete");
  assert.equal(opts.entries[0].attempt, 1);
  assert.equal(opts.entries[0].correlationId, "qa-correlation");
  assert.ok(!JSON.stringify(opts.entries).includes("private"));
});

for (const failure of [new DOMException("Fixture timeout", "TimeoutError"),
  Object.assign(new Error("Fixture unavailable"), { status: 502 }),
  new TypeError("fetch failed", { cause: { code: "ECONNRESET" } })]) {
  test(`transient ${failure.name}/${failure.status || failure.cause?.code || "timeout"} gets one fresh, bounded retry`, async () => {
    const signals = [];
    const opts = options(async (_source, _comment, { signal, onStage }) => {
      signals.push(signal); onStage("read_archive_metadata");
      if (signals.length === 1) throw failure;
      return { size: 42 };
    });
    assert.deepEqual(await prepareDownloadArchive(session, "fixture", opts), { size: 42 });
    assert.equal(signals.length, 2);
    assert.notEqual(signals[0], signals[1]);
    assert.equal(opts.entries[0].retrying, true);
    assert.equal(opts.entries[0].stage, "read_archive_metadata");
    assert.equal(opts.entries[1].attempt, 2);
  });
}

for (const failure of [Object.assign(new Error("source changed"), { status: 409, code: "ARCHIVE_SOURCE_CHANGED" }),
  Object.assign(new Error("unsupported"), { status: 422, code: "ARCHIVE_COMMENT_UNSUPPORTED" }),
  Object.assign(new Error("OAuth revoked"), { status: 502, code: "GOOGLE_DRIVE_TOKEN_REFRESH_FAILED" }),
  Object.assign(new Error("missing"), { status: 404 })]) {
  test(`${failure.code || failure.status} fails closed without retry or an unmarked fallback`, async () => {
    let calls = 0;
    const opts = options(async () => { calls += 1; throw failure; });
    await assert.rejects(prepareDownloadArchive(session, "fixture", opts), (error) => error === failure);
    assert.equal(calls, 1);
  });
}

test("exhausted source timeouts return typed 504 instead of an unhandled DOMException/500", async () => {
  let calls = 0;
  const opts = options(async () => { calls += 1; throw new DOMException("fixture", "TimeoutError"); });
  await assert.rejects(prepareDownloadArchive(session, "fixture", opts), { status: 504, code: "DOWNLOAD_PREPARATION_TIMEOUT" });
  assert.equal(calls, 2);
  assert.equal(opts.entries.at(-1).retrying, false);
});

test("exhausted transient network failures return typed 502", async () => {
  const opts = options(async () => { throw new TypeError("fetch failed"); });
  await assert.rejects(prepareDownloadArchive(session, "fixture", opts), { status: 502, code: "DOWNLOAD_PREPARATION_UNAVAILABLE" });
});

test("a shared OAuth or non-cooperating operation cannot hold the caller beyond both deadlines", async () => {
  const signals = [];
  const opts = { ...options(async (_source, _comment, { signal }) => {
    signals.push(signal); return new Promise(() => {});
  }), timeoutMs: 10 };
  await assert.rejects(prepareDownloadArchive(session, "fixture", opts), { status: 504, code: "DOWNLOAD_PREPARATION_TIMEOUT" });
  assert.equal(signals.length, 2);
  assert.ok(signals.every((signal) => signal.aborted));
});

test("caller cancellation stops retries and preserves the original cancellation reason", async () => {
  const caller = new AbortController();
  let calls = 0;
  const opts = { ...options(async () => { calls += 1; return new Promise(() => {}); }), signal: caller.signal };
  const pending = prepareDownloadArchive(session, "fixture", opts);
  await delay(5);
  caller.abort();
  await assert.rejects(pending, (error) => error === caller.signal.reason);
  assert.equal(calls, 1);
});

test("late completion from an expired attempt cannot replace the successful retry", async () => {
  let finish;
  let calls = 0;
  const opts = { ...options(async () => ++calls === 1
    ? new Promise((resolve) => { finish = resolve; }) : { size: 200 }), timeoutMs: 10 };
  assert.deepEqual(await prepareDownloadArchive(session, "fixture", opts), { size: 200 });
  finish({ size: 100 });
  await delay(1);
  assert.equal(opts.entries.filter((entry) => entry.stage === "complete").length, 1);
});
