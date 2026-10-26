import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import yauzl from "yauzl";
import { archiveCommentText, createArchiveTrace, readArchiveTrace, validArchiveComment } from "../src/utils/archiveTrace.js";
import { archiveCrc32, rar5Block, rarVint, zipCommentPatch, rar5CommentPatch, ZIP_TAIL_BYTES } from "../src/utils/archiveCommentFormat.js";
import { prepareArchiveComment, openCommentedArchive } from "../src/utils/archiveCommentStream.js";
import { zipFixture } from "./fixtures/archiveFixture.js";

const env = { ARCHIVE_TRACE_SECRET: "91".repeat(32) };
const claims = { userId: "000000000000000000000001", modelId: "000000000000000000000002", sessionId: "000000000000000000000003", assetType: "scene", at: 1793000000000 };

test("randomized authenticated references hide IDs, survive session expiry, and reject tampering", () => {
  const first = createArchiveTrace(claims, env);
  const second = createArchiveTrace(claims, env);
  assert.notEqual(first, second);
  for (const id of [claims.userId, claims.modelId, claims.sessionId]) assert.ok(!first.includes(id));
  const decoded = readArchiveTrace(archiveCommentText("3dipl.org\r\nLicensed asset", first), env);
  const { at, ...identity } = claims;
  assert.deepEqual(decoded, { ...identity, issuedAt: new Date(at).toISOString() });
});

test("trace key, ciphertext and input validation are fail closed", () => {
  const token = createArchiveTrace(claims, env);
  const bytes = Buffer.from(token.slice(5), "base64url");
  bytes[35] ^= 1;
  for (const input of ["", "a".repeat(8193), `${token}\n${token}`, "ipl1." + bytes.toString("base64url")]) {
    assert.throws(() => readArchiveTrace(input, env), { code: "ARCHIVE_TRACE_INVALID" });
  }
  assert.throws(() => readArchiveTrace(token, { ARCHIVE_TRACE_SECRET: "81".repeat(32) }), { code: "ARCHIVE_TRACE_INVALID" });
  assert.throws(() => createArchiveTrace(claims, {}), { code: "ARCHIVE_TRACE_KEY_REQUIRED" });
  assert.equal(validArchiveComment("a".repeat(4097)), false);
  assert.equal(validArchiveComment("a\x1b[0m"), false);
  assert.equal(validArchiveComment("Tiếng Việt\n3dipl.org"), true);
});

function fakeSource(payload, requests = [], { ignoreRange = false, etag = '"original"' } = {}) {
  return async (_session, { range, signal }) => {
    assert.ok(!signal || signal instanceof AbortSignal);
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(from); const end = Number(to);
    requests.push({ start, end });
    return { stream: Readable.from([payload.subarray(start, end + 1)]), contentLength: end - start + 1,
      contentRange: `bytes ${start}-${end}/${payload.length}`, statusCode: ignoreRange ? 200 : 206, etag };
  };
}

async function consume(file) {
  const chunks = [];
  for await (const chunk of file.stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function zipRead(bytes) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, decodeStrings: false }, (err, zip) => {
      if (err) return reject(err);
      zip.once("error", reject);
      zip.once("entry", (entry) => zip.openReadStream(entry, (error, stream) => {
        if (error) return reject(error);
        consume({ stream }).then((data) => { const comment = zip.comment; zip.close(); resolve({ data, comment }); }, reject);
      }));
      zip.readEntry();
    });
  });
}

test("ZIP streams preserve compressed payload, replace comments and map all output range types", async () => {
  const payload = Buffer.alloc(2 * 1024 * 1024, 82);
  const original = zipFixture(payload);
  const requests = [];
  const open = fakeSource(original, requests);
  const session = { fileSize: original.length, archiveFormat: "zip", fileName: "fixture.zip" };
  const comment = archiveCommentText("3dipl.org", createArchiveTrace(claims, env));
  const plan = await prepareArchiveComment(session, comment, { open });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].end - requests[0].start + 1 <= ZIP_TAIL_BYTES);
  const full = await openCommentedArchive(session, plan, { open });
  const output = await consume(full);
  assert.equal(output.length, full.contentLength);
  assert.deepEqual(output.subarray(0, plan.start), original.subarray(0, plan.start));
  const decoded = await zipRead(output);
  assert.deepEqual(decoded.data, payload);
  assert.deepEqual(decoded.comment, Buffer.from(comment));
  for (const range of ["bytes=0-99", `bytes=${plan.start - 5}-`, "bytes=-40", `bytes=${plan.start + 23}-${plan.start + 50}`]) {
    const file = await openCommentedArchive(session, plan, { open, range, ifRange: plan.etag });
    const [, start, end] = /bytes (\d+)-(\d+)\//.exec(file.contentRange);
    assert.equal(file.statusCode, 206);
    assert.deepEqual(await consume(file), output.subarray(Number(start), Number(end) + 1));
  }
  const stale = await openCommentedArchive(session, plan, { open, range: "bytes=0-99", ifRange: '"old-version"' });
  assert.equal(stale.statusCode, 200);
  assert.deepEqual(await consume(stale), output);
  await assert.rejects(openCommentedArchive(session, plan, { open, range: `bytes=${output.length}-` }), { status: 416 });
  await assert.rejects(prepareArchiveComment(session, comment, { open: fakeSource(original, [], { ignoreRange: true }) }), { code: "ARCHIVE_SOURCE_CHANGED" });
  await assert.rejects(prepareArchiveComment(session, comment, { open: fakeSource(original, [], { etag: "" }) }), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
});

function rarFixture(flags = 0, oldComment = false, extra = Buffer.alloc(0)) {
  const main = rar5Block(Buffer.concat([rarVint(1), rarVint(extra.length ? 1 : 0), ...(extra.length ? [rarVint(extra.length)] : []), rarVint(flags), extra]));
  const comment = oldComment ? Buffer.concat([rar5Block(Buffer.concat([rarVint(3), rarVint(2), rarVint(3), rarVint(0), rarVint(3), rarVint(0), rarVint(0), rarVint(0), rarVint(3), Buffer.from("CMT")])), Buffer.from("old")]) : Buffer.alloc(0);
  const file = rar5Block(Buffer.concat([rarVint(2), rarVint(2), rarVint(4), rarVint(0), rarVint(4), rarVint(0), rarVint(0), rarVint(0), rarVint(11), Buffer.from("fixture.max")]));
  return Buffer.concat([Buffer.from("526172211a070100", "hex"), main, comment, file, Buffer.from("DATA"), rar5Block(Buffer.from([5, 0, 0]))]);
}

test("RAR5 replaces CMT, removes stale locator, preserves every file byte and supports ranges", async () => {
  assert.equal(archiveCrc32(Buffer.from("123456789")), 0xcbf43926);
  const locator = Buffer.from([3, 1, 1, 100]);
  const original = rarFixture(4, true, locator);
  const open = fakeSource(original);
  const session = { archiveFormat: "rar", fileSize: original.length, fileName: "fixture.rar" };
  const plan = await prepareArchiveComment(session, "3dipl.org\nRef: fixture", { open });
  const output = await consume(await openCommentedArchive(session, plan, { open }));
  assert.deepEqual(output.subarray(plan.start + plan.bytes.length), original.subarray(plan.end));
  assert.equal(output.toString().split("CMT").length - 1, 1);
  assert.ok(!output.includes(Buffer.from("old")));
  const pieces = await Promise.all(Array.from({ length: 6 }, async (_, i) => {
    const start = Math.floor(i * output.length / 6);
    const end = Math.floor((i + 1) * output.length / 6) - 1;
    return consume(await openCommentedArchive(session, plan, { open, range: `bytes=${start}-${end}` }));
  }));
  assert.deepEqual(Buffer.concat(pieces), output);
  for (const flags of [1, 2, 8, 16]) assert.throws(() => rar5CommentPatch(rarFixture(flags), 1000, Buffer.from("comment")), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  const corrupt = Buffer.from(original); corrupt[9] ^= 1;
  assert.throws(() => rar5CommentPatch(corrupt, corrupt.length, Buffer.from("comment")), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  assert.throws(() => rar5CommentPatch(Buffer.from("526172211a07000000000000000000", "hex"), 100, Buffer.from("comment")), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
});

test("ZIP rejects malformed and split end records before streaming", () => {
  const original = zipFixture();
  const split = Buffer.from(original); split.writeUInt16LE(1, original.length - 11 - 22 + 4);
  assert.throws(() => zipCommentPatch(split, split.length, Buffer.from("new")), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  assert.throws(() => zipCommentPatch(Buffer.from("invalid"), 7, Buffer.from("new")), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
});

test("single-volume ZIP64 retains its locator and extracts correctly after adding the comment", async () => {
  const data = Buffer.from("ZIP64 fixture contents");
  const ordinary = zipFixture(data, "");
  const end = Buffer.from(ordinary.subarray(-22));
  const zip64 = Buffer.alloc(56);
  zip64.writeUInt32LE(0x06064b50); zip64.writeBigUInt64LE(44n, 4);
  zip64.writeUInt16LE(45, 12); zip64.writeUInt16LE(45, 14);
  zip64.writeBigUInt64LE(1n, 24); zip64.writeBigUInt64LE(1n, 32);
  zip64.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40);
  zip64.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(ordinary.length - 22), 8); locator.writeUInt32LE(1, 16);
  end.writeUInt16LE(65535, 8); end.writeUInt16LE(65535, 10);
  end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
  const original = Buffer.concat([ordinary.subarray(0, -22), zip64, locator, end]);
  const open = fakeSource(original);
  const session = { fileSize: original.length, archiveFormat: "zip" };
  const plan = await prepareArchiveComment(session, "ZIP64 reference", { open });
  const output = await consume(await openCommentedArchive(session, plan, { open }));
  assert.deepEqual((await zipRead(output)).data, data);
  assert.deepEqual((await zipRead(output)).comment, Buffer.from("ZIP64 reference"));
});

test("destroying a marked transfer closes its already-open upstream, and upstream errors propagate", async () => {
  const original = zipFixture(Buffer.alloc(100000, 82));
  const session = { fileSize: original.length, archiveFormat: "zip" };
  const plan = await prepareArchiveComment(session, "reference", { open: fakeSource(original) });
  const sources = [];
  const open = async (...args) => {
    const file = await fakeSource(original)(...args);
    sources.push(file.stream);
    return file;
  };
  const file = await openCommentedArchive(session, plan, { open });
  file.stream.destroy();
  await new Promise((resolve) => file.stream.once("close", resolve));
  assert.equal(sources[0].destroyed, true);
  const failed = await openCommentedArchive(session, plan, { open });
  const rejected = assert.rejects(consume(failed), /fixture upstream failed/);
  sources[1].destroy(new Error("fixture upstream failed"));
  await rejected;
});

const rarExe = "C:/Program Files/WinRAR/Rar.exe";
test("independent WinRAR verifies real RAR5 comment and original file after byte splice", { skip: !existsSync(rarExe) }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3dipl-archive-oracle-"));
  try {
    const input = path.join(root, "fixture.max");
    const original = path.join(root, "original.rar");
    const result = path.join(root, "marked.rar");
    const text = path.join(root, "comment.txt");
    const payload = Buffer.alloc(256 * 1024, 82);
    await writeFile(input, payload);
    await writeFile(text, "original archive comment");
    const made = spawnSync(rarExe, ["a", "-ma5", "-m5", "-qo+", "-idq", "-ep", `-z${text}`, original, input], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(made.status, 0, made.stderr || made.stdout);
    const bytes = await readFile(original);
    const patch = rar5CommentPatch(bytes, bytes.length, Buffer.from("3dipl.org\nRef: verified-fixture"));
    await writeFile(result, Buffer.concat([bytes.subarray(0, patch.start), patch.bytes, bytes.subarray(patch.end)]));
    const verified = spawnSync(rarExe, ["t", "-idq", result], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(verified.status, 0, verified.stderr || verified.stdout);
    const extracted = spawnSync(rarExe, ["p", "-inul", result, "fixture.max"], { windowsHide: true, maxBuffer: payload.length * 2, timeout: 30000 });
    assert.equal(extracted.status, 0, String(extracted.stderr));
    assert.deepEqual(extracted.stdout, payload);
    const listing = spawnSync(rarExe, ["l", result], { encoding: "utf8", windowsHide: true, timeout: 30000 });
    assert.equal(listing.status, 0, listing.stderr || listing.stdout);
    assert.match(listing.stdout, /Ref: verified-fixture/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
