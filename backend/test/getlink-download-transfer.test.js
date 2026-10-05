import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Writable } from "node:stream";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createGetlinkDownloadLimiter, streamGetlinkFile } from "../src/utils/getlinkDownloadTransfer.js";

const connection = { userId: "download-owner", ip: "192.0.2.1" };

test("Getlink accepts six range connections without lifting the full-file limit", () => {
  const limiter = createGetlinkDownloadLimiter({});
  const slots = Array.from({ length: 6 }, (_, i) => limiter.acquire({ ...connection, range: `bytes=${i * 100}-${i * 100 + 99}` }));
  assert.ok(slots.every((slot) => slot.ok));
  assert.equal(limiter.acquire({ ...connection, range: "bytes=600-699" }).status, 429);
  slots.forEach((slot) => slot.release());

  const first = limiter.acquire(connection);
  const second = limiter.acquire(connection);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(limiter.acquire(connection).status, 429);
  first.release();
  second.release();
});

test("Getlink range and full downloads share the global capacity", () => {
  const limiter = createGetlinkDownloadLimiter({ MAX_GLOBAL_DOWNLOADS: "2" });
  const first = limiter.acquire(connection);
  const second = limiter.acquire({ ...connection, range: "bytes=0-99" });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(limiter.acquire({ userId: "other", ip: "192.0.2.2", range: "bytes=100-199" }).status, 429);
  second.release();
  second.release();
  const replacement = limiter.acquire({ userId: "other", ip: "192.0.2.2" });
  assert.equal(replacement.ok, true);
  assert.equal(limiter.acquire({ userId: "third", ip: "192.0.2.3" }).status, 429);
  replacement.release();
  first.release();
});

test("Getlink limits ranges per IP across separate accounts", () => {
  const limiter = createGetlinkDownloadLimiter({ MAX_DOWNLOADS_PER_IP: "1", MAX_DOWNLOAD_RANGE_CONNECTIONS_PER_IP: "3" });
  const slots = ["one", "two", "three"].map((userId) => limiter.acquire({ ...connection, userId, range: "bytes=0-99" }));
  assert.ok(slots.every((slot) => slot.ok));
  assert.equal(limiter.acquire({ ...connection, userId: "four", range: "bytes=100-199" }).status, 429);
  slots.forEach((slot) => slot.release());
});

test("invalid or multipart Range headers do not bypass the full-file limit", () => {
  const limiter = createGetlinkDownloadLimiter({ MAX_DOWNLOADS_PER_USER: "1" });
  const first = limiter.acquire(connection);
  for (const range of ["invalid", "bytes=-", "bytes=-0", "bytes=10-1", "bytes=0-1,2-3", "bytes=9007199254740992-"]) {
    assert.equal(limiter.acquire({ ...connection, range }).status, 429, range);
  }
  const suffix = limiter.acquire({ ...connection, range: "bytes=-100" });
  const resume = limiter.acquire({ ...connection, range: "bytes=100-" });
  assert.equal(suffix.ok, true);
  assert.equal(resume.ok, true);
  suffix.release();
  resume.release();
  first.release();
});

test("Getlink streams preserve bytes and backpressure instead of buffering the file", async () => {
  let pulls = 0;
  let writtenBytes = 0;
  let startWriting;
  let releaseFirstWrite;
  const writing = new Promise((resolve) => { startWriting = resolve; });
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const expectedHash = createHash("sha256");
  const receivedHash = createHash("sha256");
  for (let i = 0; i < 200; i += 1) expectedHash.update(Buffer.alloc(64 * 1024, i));
  const body = new ReadableStream({
    pull(controller) {
      if (pulls === 200) return controller.close();
      controller.enqueue(Buffer.alloc(64 * 1024, pulls));
      pulls += 1;
    },
  });
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      receivedHash.update(chunk);
      writtenBytes += chunk.length;
      if (writtenBytes === chunk.length) {
        startWriting();
        firstWrite.then(() => callback());
      } else callback();
    },
  });
  const metrics = [];
  const transfer = streamGetlinkFile(body, destination, { onMetrics: (value) => metrics.push(value) });
  await writing;
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(pulls < 32, `Read-ahead must remain bounded; pulled ${pulls} chunks`);
  releaseFirstWrite();
  await transfer;
  assert.equal(receivedHash.digest("hex"), expectedHash.digest("hex"));
  assert.equal(writtenBytes, 200 * 64 * 1024);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].completed, true);
  assert.equal(metrics[0].receivedBytes, writtenBytes);
  assert.equal(typeof metrics[0].firstByteMs, "number");
  assert.ok(metrics[0].proxyMiBPerSecond > 0);
});

test("Getlink cancel closes the upstream and records one interrupted transfer", async () => {
  const controller = new AbortController();
  let canceled = false;
  const body = new ReadableStream({
    pull(stream) { stream.enqueue(Buffer.alloc(64 * 1024)); },
    cancel() { canceled = true; },
  });
  const destination = new Writable({
    write(_chunk, _encoding, callback) {
      controller.abort();
      callback();
    },
  });
  const metrics = [];
  await assert.rejects(streamGetlinkFile(body, destination, {
    signal: controller.signal,
    onMetrics: (value) => metrics.push(value),
  }), { name: "AbortError" });
  assert.equal(canceled, true);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].completed, false);
});

test("Getlink upstream truncation is propagated, not logged as success", async () => {
  const body = new ReadableStream({ start(stream) { stream.error(new Error("upstream terminated")); } });
  const metrics = [];
  await assert.rejects(streamGetlinkFile(body, new Writable({ write(_chunk, _encoding, callback) { callback(); } }), {
    onMetrics: (value) => metrics.push(value),
  }), /upstream terminated/);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].completed, false);
  assert.equal(metrics[0].receivedBytes, 0);
});

test("transfer telemetry cannot fail a completed download or mask an upstream error", async () => {
  const destination = () => new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const onMetrics = () => { throw new Error("logger unavailable"); };
  await streamGetlinkFile(new ReadableStream({
    start(stream) { stream.enqueue(Buffer.from("file")); stream.close(); },
  }), destination(), { onMetrics });
  await assert.rejects(streamGetlinkFile(new ReadableStream({
    start(stream) { stream.error(new Error("source failed")); },
  }), destination(), { onMetrics }), /source failed/);
});

test("Nginx streaming location covers web/plugin Getlink and marketplace downloads", async () => {
  const nginx = await readFile(new URL("../../ops/nginx/3dipl.conf", import.meta.url), "utf8");
  const block = /location ~ (\S+) \{([\s\S]*?)\n {4}\}/.exec(nginx);
  assert.ok(block);
  const routes = new RegExp(block[1]);
  for (const path of ["/api/getlink/download/asset-1", "/api/plugin/getlink/download/asset-1", "/api/download/session/session-1/file", "/api/plugin/download/session/session-1/file"]) {
    assert.ok(routes.test(path), path);
  }
  assert.equal(routes.test("/api/getlink/history"), false);
  assert.match(block[2], /gzip off;/);
  assert.match(block[2], /proxy_buffering off;/);
  assert.match(block[2], /proxy_max_temp_file_size 0;/);
  assert.match(block[2], /proxy_set_header If-Range \$http_if_range;/);
});
