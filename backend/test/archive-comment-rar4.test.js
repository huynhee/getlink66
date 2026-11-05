import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { archiveCrc32, RAR_PREFIX_BYTES } from "../src/utils/archiveCommentFormat.js";
import { rar4CommentPatch } from "../src/utils/archiveCommentRar4.js";
import { prepareArchiveComment, openCommentedArchive } from "../src/utils/archiveCommentStream.js";
import { createArchiveTrace, readArchiveTrace } from "../src/utils/archiveTrace.js";
import { rar4Fixture, rar4Header } from "./fixtures/archiveFixture.js";

function source(bytes, requests = [], mutate) {
  return async (_session, { range }) => {
    const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = Number(from); const end = Number(to);
    requests.push({ start, end });
    return { stream: Readable.from([bytes.subarray(start, end + 1)]), statusCode: 206,
      contentLength: end - start + 1, contentRange: `bytes ${start}-${end}/${bytes.length}`,
      etag: mutate?.(start) || '"rar4-fixture"' };
  };
}

async function consume(file) {
  const chunks = [];
  for await (const chunk of file.stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

test("RAR4 replaces leading comments with Unicode CMT, preserves file bytes, and supports resumed ranges", async () => {
  for (const previous of ["", "old comment"]) {
    const original = rar4Fixture(Buffer.alloc(300000, 82), previous);
    const requests = [];
    const open = source(original, requests);
    const session = { archiveFormat: "rar", fileSize: original.length };
    const comment = "3dipl.org\nTiếng Việt\nipl1.test-reference";
    const plan = await prepareArchiveComment(session, comment, { open });
    assert.equal(plan.format, "rar4");
    assert.deepEqual(requests, [{ start: 0, end: RAR_PREFIX_BYTES - 1 }, { start: original.length - 7, end: original.length - 1 }]);
    const output = await consume(await openCommentedArchive(session, plan, { open }));
    assert.equal(output.length, plan.size);
    assert.deepEqual(output.subarray(0, 20), original.subarray(0, 20));
    assert.deepEqual(output.subarray(plan.start + plan.bytes.length), original.subarray(plan.end));
    assert.ok(output.includes(Buffer.from(comment, "utf16le")));
    assert.equal(output.toString().split("CMT").length - 1, 1);
    if (previous) assert.ok(!output.includes(Buffer.from(previous)));
    for (const range of ["bytes=0-25", "bytes=19-75", `bytes=${plan.start + plan.bytes.length - 10}-`, "bytes=-40"]) {
      const file = await openCommentedArchive(session, plan, { open, range, ifRange: plan.etag });
      const [, start, end] = /bytes (\d+)-(\d+)\//.exec(file.contentRange);
      assert.deepEqual(await consume(file), output.subarray(Number(start), Number(end) + 1));
    }
  }
});

test("small RAR4 archives reuse the prefix probe; a changed tail validator fails closed", async () => {
  const small = rar4Fixture();
  const requests = [];
  await prepareArchiveComment({ archiveFormat: "rar", fileSize: small.length }, "reference", { open: source(small, requests) });
  assert.equal(requests.length, 1);
  const large = rar4Fixture(Buffer.alloc(300000));
  await assert.rejects(prepareArchiveComment({ archiveFormat: "rar", fileSize: large.length }, "reference", {
    open: source(large, [], (start) => start ? '"changed"' : ""),
  }), { code: "ARCHIVE_SOURCE_CHANGED" });
});

test("RAR4 rejects split, encrypted-main, recovery, signed, legacy, malformed and ambiguous layouts", () => {
  const original = rar4Fixture();
  const patch = (bytes, tail = bytes.subarray(-7)) => rar4CommentPatch(bytes, bytes.length, Buffer.from("trace"), tail);
  const rejects = (bytes, tail) => assert.throws(() => patch(bytes, tail), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  const recalc = (bytes, start) => {
    bytes.writeUInt16LE(archiveCrc32(bytes.subarray(start + 2, start + bytes.readUInt16LE(start + 5))) & 0xffff, start);
    return bytes;
  };
  for (const flag of [1, 2, 4, 0x20, 0x40, 0x80, 0x100, 0x8000]) {
    const bytes = Buffer.from(original); bytes.writeUInt16LE(flag, 10);
    rejects(recalc(bytes, 7));
  }
  for (const flag of [1, 2, 4, 8]) rejects(original, rar4Header(0x7b, flag));
  const signed = Buffer.from(original); signed.writeUInt16LE(1, 14); rejects(recalc(signed, 7));
  const split = Buffer.from(original); split.writeUInt16LE(0x8001, 23); rejects(recalc(split, 20));
  const overrun = Buffer.from(original); overrun.writeUInt32LE(original.length, 27); rejects(recalc(overrun, 20));
  const badName = Buffer.from(original); badName.writeUInt16LE(65535, 46); rejects(recalc(badName, 20));
  const corrupt = Buffer.from(original); corrupt[9] ^= 1; rejects(corrupt);
  rejects(Buffer.concat([Buffer.from("MZ"), original]));
  for (let size = 0; size < 63; size += 1) rejects(original.subarray(0, size));
  const old = rar4Fixture(Buffer.from("DATA"), "old comment");
  const duplicate = Buffer.concat([old.subarray(0, 66), old.subarray(20)]);
  rejects(duplicate);
  const oversized = Buffer.from(old); oversized.writeUInt32LE(200000, 27); rejects(recalc(oversized, 20));
  const unknown = Buffer.from(old); unknown.write("ACL", 52); rejects(recalc(unknown, 20));
});

const rarExe = "C:/Program Files/WinRAR/Rar.exe";
test("independent WinRAR reads a RAR4 Unicode trace, validates files and replaces its own native comment", { skip: !existsSync(rarExe) }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3dipl-rar4-oracle-"));
  try {
    const original = path.join(root, "original.rar");
    const marked = path.join(root, "marked.rar");
    const commentFile = path.join(root, "comment.txt");
    const exported = path.join(root, "exported.txt");
    const payload = Buffer.alloc(300000, 82);
    await writeFile(original, rar4Fixture(payload));
    await writeFile(commentFile, "WinRAR original comment".repeat(50));
    const run = (args, options = {}) => {
      const result = spawnSync(rarExe, args, { windowsHide: true, timeout: 30000, encoding: "utf8", ...options });
      assert.equal(result.status, 0, String(result.stderr || result.stdout));
      return result;
    };
    run(["t", "-idq", original]);
    for (const nativeComment of [false, true]) {
      if (nativeComment) run(["c", "-idq", `-z${commentFile}`, original]);
      const bytes = await readFile(original);
      const claims = { userId: "000000000000000000000001", modelId: "000000000000000000000002",
        sessionId: "000000000000000000000003", assetType: "scene" };
      const env = { ARCHIVE_TRACE_SECRET: "45".repeat(32) };
      const comment = `3dipl.org\nTiếng Việt\n${createArchiveTrace(claims, env)}`;
      const plan = await prepareArchiveComment({ archiveFormat: "rar", fileSize: bytes.length }, comment, { open: source(bytes) });
      assert.equal(plan.format, "rar4", "WinRAR must preserve the RAR4 archive when writing its comment");
      await writeFile(marked, await consume(await openCommentedArchive({ fileSize: bytes.length }, plan, { open: source(bytes) })));
      run(["t", "-idq", marked]);
      assert.deepEqual(run(["p", "-inul", marked, "fixture.max"], { encoding: null, maxBuffer: payload.length * 2 }).stdout, payload);
      run(["cw", "-y", "-scu", marked, exported]);
      const actual = await readFile(exported);
      const decoded = actual.toString("utf16le").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
      assert.equal(decoded, comment);
      assert.equal(readArchiveTrace(decoded, env).userId, claims.userId);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
