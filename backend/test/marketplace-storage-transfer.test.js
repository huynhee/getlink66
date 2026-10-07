import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import { DOWNLOAD_STREAM_BUFFER_BYTES, normalizeDownloadRange, streamDownloadFile } from "../src/utils/downloadTransfer.js";
import { openStorageStream } from "../src/utils/storageProvider.js";

test("Range normalization rejects unsafe, backwards and multipart ranges", () => {
  assert.equal(normalizeDownloadRange(" BYTES=100-199 "), "bytes=100-199");
  assert.equal(normalizeDownloadRange("bytes=-10"), "bytes=-10");
  assert.equal(normalizeDownloadRange("bytes=100-"), "bytes=100-");
  assert.equal(normalizeDownloadRange(""), "");
  for (const range of ["bytes=-", "bytes=-0", "bytes=10-1", "bytes=0-1,2-3", "bytes=9007199254740992-", `bytes=${"0".repeat(129)}-`]) {
    assert.throws(() => normalizeDownloadRange(range), (error) => error.status === 416 && error.code === "INVALID_BYTE_RANGE");
  }
});

test("local files preserve resume validators, bounded buffers and suffix ranges", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "marketplace-transfer-"));
  const previous = process.env.MARKETPLACE_LOCAL_STORAGE_ROOT;
  process.env.MARKETPLACE_LOCAL_STORAGE_ROOT = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.MARKETPLACE_LOCAL_STORAGE_ROOT;
    else process.env.MARKETPLACE_LOCAL_STORAGE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  });
  const payload = Buffer.alloc(1024 * 1024, 37);
  const target = path.join(root, "fixture.zip");
  await writeFile(target, payload);
  const lastModified = (await stat(target)).mtime.toUTCString();
  const session = { storageProvider: "local", storageKey: "fixture.zip", fileName: "model.zip" };
  const read = async (options) => {
    const file = await openStorageStream(session, options);
    assert.equal(file.stream.readableHighWaterMark, DOWNLOAD_STREAM_BUFFER_BYTES);
    assert.equal(file.lastModified, lastModified);
    const chunks = [];
    for await (const chunk of file.stream) chunks.push(chunk);
    return { ...file, bytes: Buffer.concat(chunks) };
  };
  const partial = await read({ range: "bytes=100-199", ifRange: lastModified });
  assert.equal(partial.statusCode, 206);
  assert.equal(partial.contentRange, `bytes 100-199/${payload.length}`);
  assert.deepEqual(partial.bytes, payload.subarray(100, 200));
  const suffix = await read({ range: "bytes=-25" });
  assert.equal(suffix.contentLength, 25);
  assert.deepEqual(suffix.bytes, payload.subarray(-25));
  for (const ifRange of ['"unknown-version"', 'W/"weak-version"', "Tue, 06 Oct 2026 02:00:00 GMT"]) {
    const full = await read({ range: "bytes=100-199", ifRange });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(full.bytes, payload);
  }
  await assert.rejects(openStorageStream(session, { range: "bytes=2000000-" }), (error) => error.status === 416 && error.contentRange === `bytes */${payload.length}`);
  const controller = new AbortController();
  const interrupted = await openStorageStream(session, { signal: controller.signal });
  const error = new Promise((resolve) => interrupted.stream.once("error", resolve));
  controller.abort();
  assert.equal((await error).name, "AbortError");
  assert.equal(interrupted.stream.destroyed, true);
});

test("the shared pipeline accepts Node streams and propagates cancellation with metrics", async () => {
  const controller = new AbortController();
  const source = Readable.from((function* () {
    for (let i = 0; i < 200; i += 1) yield Buffer.alloc(65536, i);
  })(), { objectMode: false, highWaterMark: DOWNLOAD_STREAM_BUFFER_BYTES });
  const destination = new Writable({ write(_chunk, _encoding, callback) { controller.abort(); callback(); } });
  const metrics = [];
  await assert.rejects(streamDownloadFile(source, destination, {
    signal: controller.signal, onMetrics: (value) => metrics.push(value),
  }), { name: "AbortError" });
  assert.equal(source.destroyed, true);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].completed, false);
  assert.ok(metrics[0].receivedBytes < 200 * 65536);
});
