import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { rarExtraFilesPatch } from "../src/utils/archiveExtraRar.js";
import { rar4CommentPatch } from "../src/utils/archiveCommentRar4.js";
import { rar5Block, rar5CommentPatch } from "../src/utils/archiveCommentFormat.js";
import { createArchiveExtraFiles, readArchiveExtraFiles } from "../src/utils/archiveExtraFiles.js";
import { createArchiveTrace, readArchiveTrace } from "../src/utils/archiveTrace.js";
import { rar4Fixture } from "./fixtures/archiveFixture.js";
import { prepareArchiveComment, openCommentedArchive } from "../src/utils/archiveCommentStream.js";

const rarExe = "C:/Program Files/WinRAR/Rar.exe";
const env = { ARCHIVE_TRACE_SECRET: "76".repeat(32) };
const claims = { userId: "000000000000000000000001", modelId: "000000000000000000000002",
  sessionId: "000000000000000000000003", assetType: "scene" };
const token = createArchiveTrace(claims, env);
const files = readArchiveExtraFiles(createArchiveExtraFiles({ archiveTextFileEnabled: true,
  archiveTextFileText: "3dipl.org\nTài nguyên được cấp phép" }, token));

function apply(original, patches) {
  const chunks = [];
  let sourceAt = 0;
  for (const patch of patches) {
    chunks.push(original.subarray(sourceAt, patch.start), patch.bytes);
    sourceAt = patch.end;
  }
  return Buffer.concat([...chunks, original.subarray(sourceAt)]);
}

test("RAR extra files are appended after original data and reject non-plain end records", () => {
  for (const format of ["rar4", "rar5"]) {
    const end = format === "rar4" ? rar4Fixture().subarray(-7) : rar5Block(Buffer.from([5, 0, 0]));
    const total = 300000;
    const patch = rarExtraFilesPatch(format, end, total, files);
    assert.equal(patch.start, total - end.length);
    assert.equal(patch.end, patch.start);
    assert.ok(patch.bytes.includes(Buffer.from(files[0].text, "utf8")));
    assert.ok(patch.bytes.includes(Buffer.from(files[1].text, "utf8")));
    for (const invalid of [Buffer.alloc(0), Buffer.from("invalid-end"), Buffer.concat([end, Buffer.from([0])])]) {
      assert.throws(() => rarExtraFilesPatch(format, invalid, total, files), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
    }
    const corrupt = Buffer.from(end); corrupt[0] ^= 1;
    assert.throws(() => rarExtraFilesPatch(format, corrupt, total, files), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  }
});

for (const format of ["rar4", "rar5"]) test(`independent WinRAR extracts original ${format} data, TXT and URL and validates all checksums`, { skip: !existsSync(rarExe) }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "3dipl-rar-extra-oracle-"));
  try {
    const original = path.join(root, "original.rar");
    const marked = path.join(root, "marked.rar");
    const first = Buffer.alloc(200000, 82);
    const second = Buffer.alloc(200000, 82);
    const run = (args, options = {}) => {
      const result = spawnSync(rarExe, args, { windowsHide: true, timeout: 30000, encoding: "utf8", ...options });
      assert.equal(result.status, 0, String(result.stderr || result.stdout));
      return result;
    };
    if (format === "rar4") await writeFile(original, rar4Fixture(first, "old comment"));
    else {
      await writeFile(path.join(root, "fixture.max"), first);
      await writeFile(path.join(root, "second.max"), second);
      run(["a", "-ma5", "-s", "-m5", "-qo+", "-ep", "-idq", original, path.join(root, "fixture.max"), path.join(root, "second.max")]);
    }
    const bytes = await readFile(original);
    const comment = `3dipl.org\n\n${token}`;
    const prefix = format === "rar4" ? rar4CommentPatch(bytes, bytes.length, Buffer.from(comment), bytes.subarray(-7))
      : rar5CommentPatch(bytes, bytes.length, Buffer.from(comment));
    const end = rarExtraFilesPatch(format, bytes.subarray(-32), bytes.length, files);
    const expected = apply(bytes, [prefix, end]);
    const session = { archiveFormat: "rar", fileSize: bytes.length, archiveExtraFiles: JSON.stringify(files), fileName: "marked.rar" };
    const open = async (_source, { range }) => {
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(range);
      const start = Number(from); const last = Number(to);
      return { stream: Readable.from([bytes.subarray(start, last + 1)]), statusCode: 206,
        contentLength: last - start + 1, contentRange: `bytes ${start}-${last}/${bytes.length}`, etag: '"rar-fixture"' };
    };
    const plan = await prepareArchiveComment(session, comment, { open });
    const file = await openCommentedArchive(session, plan, { open });
    const chunks = [];
    for await (const chunk of file.stream) chunks.push(chunk);
    const output = Buffer.concat(chunks);
    assert.deepEqual(output, expected);
    assert.deepEqual(output.subarray(prefix.start + prefix.bytes.length, prefix.start + prefix.bytes.length + end.start - prefix.end), bytes.subarray(prefix.end, end.start));
    await writeFile(marked, output);
    run(["t", "-idq", marked]);
    assert.deepEqual(run(["p", "-inul", marked, "fixture.max"], { encoding: null, maxBuffer: first.length * 2 }).stdout, first);
    if (format === "rar5") assert.deepEqual(run(["p", "-inul", marked, "second.max"], { encoding: null, maxBuffer: second.length * 2 }).stdout, second);
    for (const file of files) {
      const extracted = run(["p", "-inul", marked, file.name], { encoding: null }).stdout;
      assert.deepEqual(extracted, Buffer.from(file.text, "utf8"));
      if (file.name.endsWith(".txt")) assert.equal(readArchiveTrace(extracted.toString("utf8"), env).userId, claims.userId);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
