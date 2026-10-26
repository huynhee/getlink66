import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { getStorageSourceValidator, openStorageStream } from "../src/utils/storageProvider.js";
import { openCommentedArchive, prepareArchiveComment } from "../src/utils/archiveCommentStream.js";
import { rar5Block, rarVint } from "../src/utils/archiveCommentFormat.js";
import { zipFixture } from "./fixtures/archiveFixture.js";
import { serializeArchiveCommentPlan, restoreArchiveCommentPlan } from "../src/utils/archiveCommentPlan.js";

process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "archive-validator-fixture-token";

function driveFixture(t, payload = zipFixture(Buffer.alloc(300000, 82))) {
  const session = { storageProvider: "google_drive", driveFileId: "fixture-file", fileSize: payload.length,
    fileName: "fixture.zip", archiveFormat: "zip" };
  const metadata = { id: session.driveFileId, size: String(payload.length), version: "18446744073709551612",
    md5Checksum: crypto.createHash("md5").update(payload).digest("hex"), trashed: false, capabilities: { canDownload: true } };
  const f = { session, metadata, payload, requests: [], metadataStatus: 200, mediaCount: 0,
    onMedia: () => {}, onMetadata: () => {} };
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(url.hostname, "www.googleapis.com");
    assert.equal(options.method || "GET", "GET", "Version checks must not modify Drive");
    const headers = new Headers(options.headers);
    const media = url.searchParams.get("alt") === "media";
    f.requests.push({ media, range: headers.get("range"), ifRange: headers.get("if-range"), signal: options.signal });
    if (!media) {
      assert.ok(url.searchParams.get("fields").includes("version"));
      await f.onMetadata();
      return Response.json(metadata, { status: f.metadataStatus });
    }
    f.mediaCount += 1;
    const match = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range") || "");
    const start = match ? Number(match[1]) : 0;
    const end = match ? Number(match[2]) : payload.length - 1;
    await f.onMedia();
    return new Response(payload.subarray(start, end + 1), { status: match ? 206 : 200, headers: {
      "content-length": String(end - start + 1),
      ...(match ? { "content-range": `bytes ${start}-${end}/${payload.length}` } : {}),
    } });
  });
  return f;
}

async function consume(file) {
  const chunks = [];
  for await (const chunk of file.stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function rarFixture() {
  const main = rar5Block(Buffer.from([1, 0, 0]));
  const file = rar5Block(Buffer.concat([rarVint(2), rarVint(2), rarVint(4), rarVint(0), rarVint(4),
    rarVint(0), rarVint(0), rarVint(0), rarVint(11), Buffer.from("fixture.max")]));
  return Buffer.concat([Buffer.from("526172211a070100", "hex"), main, file, Buffer.from("DATA"), rar5Block(Buffer.from([5, 0, 0]))]);
}

for (const format of ["zip", "rar"]) test(`Drive ${format} without HTTP validators uses a pinned version for full and parallel range downloads`, async (t) => {
  const f = driveFixture(t, format === "rar" ? rarFixture() : undefined);
  f.session.archiveFormat = format;
  const plan = await prepareArchiveComment(f.session, "3dipl.org\nRef: fixture");
  assert.match(plan.sourceValidator, /^gdrive-v1:[a-f0-9]{64}$/);
  assert.equal(plan.lastModified, "", "Do not fabricate an HTTP date from Drive metadata");
  assert.equal(f.mediaCount, 2, "Discard and repeat the unvalidated probe after pinning the version");
  const output = await consume(await openCommentedArchive(f.session, plan));
  assert.ok(output.includes(Buffer.from("3dipl.org\nRef: fixture")));
  assert.equal(output.length, plan.size);
  assert.deepEqual(output.subarray(0, plan.start), f.payload.subarray(0, plan.start));
  assert.deepEqual(output.subarray(plan.start + plan.bytes.length), f.payload.subarray(plan.end));
  const pieces = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const start = Math.floor(index * plan.size / 4);
    const end = Math.floor((index + 1) * plan.size / 4) - 1;
    return consume(await openCommentedArchive(f.session, plan, { range: `bytes=${start}-${end}`, ifRange: plan.etag }));
  }));
  assert.deepEqual(Buffer.concat(pieces), output);
  assert.deepEqual(await consume(await openCommentedArchive(f.session, plan, { range: "bytes=-20" })), output.subarray(-20));
  assert.ok(f.requests.every((request) => request.ifRange === null), "Private validators never become HTTP If-Range headers");
});

test("Drive version checks retain int64 precision and reject malformed or unavailable metadata", async (t) => {
  const f = driveFixture(t);
  const first = await getStorageSourceValidator(f.session);
  f.metadata.version = "18446744073709551613";
  assert.notEqual(await getStorageSourceValidator(f.session), first);
  const original = structuredClone(f.metadata);
  for (const invalid of [{ version: "" }, { version: 42 }, { version: "bad" }, { size: "1" },
    { size: "9007199254740993" }, { id: "different" }, { trashed: true }, { capabilities: { canDownload: false } }]) {
    Object.assign(f.metadata, original, invalid);
    await assert.rejects(getStorageSourceValidator(f.session), { code: "ARCHIVE_SOURCE_CHANGED" });
  }
  Object.assign(f.metadata, original);
  f.metadataStatus = 503;
  await assert.rejects(getStorageSourceValidator(f.session), { status: 502 });
});

test("a source change between version pin and repeated probe fails before creating a representation", async (t) => {
  const f = driveFixture(t);
  f.onMedia = () => { if (f.mediaCount === 2) f.metadata.version = "18446744073709551613"; };
  await assert.rejects(prepareArchiveComment(f.session, "comment"), { code: "ARCHIVE_SOURCE_CHANGED" });
});

test("a source change or metadata outage after preflight rejects the held body stream", async (t) => {
  const f = driveFixture(t);
  const plan = await prepareArchiveComment(f.session, "comment");
  f.onMedia = () => { f.metadata.version = "18446744073709551613"; };
  await assert.rejects(openCommentedArchive(f.session, plan), { code: "ARCHIVE_SOURCE_CHANGED" });
  f.metadataStatus = 503;
  await assert.rejects(openCommentedArchive(f.session, plan), { status: 502 });
});

test("a later source block cannot mix in a changed RAR version", async (t) => {
  const f = driveFixture(t, rarFixture());
  f.session.archiveFormat = "rar";
  const plan = await prepareArchiveComment(f.session, "comment");
  f.onMedia = () => { if (f.mediaCount === 4) f.metadata.version = "18446744073709551613"; };
  const file = await openCommentedArchive(f.session, plan);
  await assert.rejects(consume(file), { code: "ARCHIVE_SOURCE_CHANGED" });
});

test("a rejected Drive version destroys the held media stream and forwards cancellation to metadata", async (t) => {
  const f = driveFixture(t);
  const expected = await getStorageSourceValidator(f.session);
  let canceled = false;
  const abort = new AbortController();
  t.mock.method(globalThis, "fetch", async (input, options) => {
    assert.equal(options.signal, abort.signal);
    if (new URL(input).searchParams.get("alt") === "media") return new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
      cancel() { canceled = true; },
    }), { status: 206, headers: { "content-length": "3", "content-range": `bytes 0-2/${f.payload.length}` } });
    return Response.json({ ...f.metadata, version: "18446744073709551613" });
  });
  await assert.rejects(openStorageStream(f.session, { range: "bytes=0-2", sourceValidator: expected, signal: abort.signal }), { code: "ARCHIVE_SOURCE_CHANGED" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(canceled, true);
});

test("legacy HTTP validators keep the original path without extra metadata requests", async (t) => {
  const payload = zipFixture();
  let requests = 0;
  t.mock.method(globalThis, "fetch", async (_input, options) => {
    requests += 1;
    const [, start, end] = /^bytes=(\d+)-(\d+)$/.exec(new Headers(options.headers).get("range"));
    return new Response(payload.subarray(Number(start), Number(end) + 1), { status: 206, headers: {
      "content-length": String(Number(end) - Number(start) + 1), "content-range": `bytes ${start}-${end}/${payload.length}`,
      "last-modified": "Mon, 26 Oct 2026 00:00:00 GMT",
    } });
  });
  const plan = await prepareArchiveComment({ storageProvider: "google_drive", driveFileId: "fixture", fileSize: payload.length, archiveFormat: "zip" }, "comment");
  assert.equal(plan.sourceValidator, "");
  assert.equal(plan.validator, "Mon, 26 Oct 2026 00:00:00 GMT");
  assert.equal(requests, 1);
});

test("new Drive sessions pin once, persist a bounded patch and open without repeating archive probes", async (t) => {
  const f = driveFixture(t);
  const comment = "3dipl.org\n\nipl1.fixture";
  const plan = await prepareArchiveComment(f.session, comment, { pinDriveVersion: true });
  assert.equal(f.requests.length, 3, "Metadata pin, one bounded media probe, then version verification");
  assert.equal(f.mediaCount, 1);
  const session = { ...f.session, sourceFileSize: f.session.fileSize, fileSize: plan.size,
    archiveComment: comment, archiveSourceFingerprint: plan.fingerprint,
    archiveCommentPlan: serializeArchiveCommentPlan(f.session, comment, plan) };
  assert.ok(session.archiveCommentPlan.length < 2000);
  const restored = restoreArchiveCommentPlan(JSON.parse(JSON.stringify(session)));
  assert.deepEqual(restored.bytes, plan.bytes);
  assert.equal(restored.etag, plan.etag);
  const beforeOpen = f.requests.length;
  const file = await openCommentedArchive(f.session, restored, { range: "bytes=0-63" });
  assert.equal(f.requests.length - beforeOpen, 2, "Opening checks only the requested media and a fresh version");
  assert.equal(f.requests.at(-2).range, "bytes=0-63");
  assert.deepEqual(await consume(file), f.payload.subarray(0, 64));
  f.metadata.version = "18446744073709551613";
  await assert.rejects(openCommentedArchive(f.session, restored, { range: "bytes=0-63" }), { code: "ARCHIVE_SOURCE_CHANGED" });
});

test("saved patches are bound to the comment and source; malformed or corrupted snapshots cannot be used", async (t) => {
  const f = driveFixture(t);
  const comment = "3dipl.org\n\nipl1.fixture";
  const plan = await prepareArchiveComment(f.session, comment, { pinDriveVersion: true });
  const session = { ...f.session, sourceFileSize: f.session.fileSize, fileSize: plan.size,
    archiveComment: comment, archiveSourceFingerprint: plan.fingerprint,
    archiveCommentPlan: serializeArchiveCommentPlan(f.session, comment, plan) };
  for (const change of [{ archiveCommentPlan: "{" }, { archiveCommentPlan: "x".repeat(200001) },
    { driveFileId: "other" }, { archiveComment: "changed" }, { sourceFileSize: 42 }, { fileSize: 42 },
    { archiveSourceFingerprint: "a".repeat(64) }, { archiveFormat: "rar" }]) {
    assert.throws(() => restoreArchiveCommentPlan({ ...session, ...change }), { code: "ARCHIVE_SOURCE_CHANGED" });
  }
  const corrupt = JSON.parse(session.archiveCommentPlan);
  corrupt.bytes = Buffer.from("corrupt").toString("base64");
  assert.throws(() => restoreArchiveCommentPlan({ ...session, archiveCommentPlan: JSON.stringify(corrupt) }), { code: "ARCHIVE_SOURCE_CHANGED" });
  const { checksum: _checksum, ...data } = JSON.parse(session.archiveCommentPlan);
  for (const change of [{ start: -1 }, { end: session.sourceFileSize + 1 }, { end: data.start },
    { bytes: "not base64" }, { bytes: "" }, { size: session.fileSize + 1 }, { sourceValidator: '"not-a-Drive-version"' },
    { v: 2 }, { lastModified: "bad\r\nheader" }]) {
    const invalid = { ...data, ...change };
    const encoded = JSON.stringify({ ...invalid, checksum: crypto.createHash("sha256").update(JSON.stringify(invalid)).digest("hex") });
    assert.throws(() => restoreArchiveCommentPlan({ ...session, archiveCommentPlan: encoded }), { code: "ARCHIVE_SOURCE_CHANGED" });
  }
  assert.equal(restoreArchiveCommentPlan({}), null, "Older sessions keep the validated legacy path");
});

test("a patch-only range still verifies Drive before billing, and a patch-first range preopens its source", async (t) => {
  const f = driveFixture(t, rarFixture());
  f.session.archiveFormat = "rar";
  const plan = await prepareArchiveComment(f.session, "comment", { pinDriveVersion: true });
  const patchRange = `bytes=${plan.start}-${plan.start + plan.bytes.length - 1}`;
  const before = f.mediaCount;
  assert.deepEqual(await consume(await openCommentedArchive(f.session, plan, { range: patchRange })), plan.bytes);
  assert.equal(f.mediaCount, before, "A generated-only range requires metadata, not a media probe");
  f.metadata.version = "18446744073709551613";
  await assert.rejects(openCommentedArchive(f.session, plan, { range: patchRange }), { code: "ARCHIVE_SOURCE_CHANGED" });
  await assert.rejects(openCommentedArchive(f.session, plan, { range: `bytes=${plan.start}-` }), { code: "ARCHIVE_SOURCE_CHANGED" });
});
