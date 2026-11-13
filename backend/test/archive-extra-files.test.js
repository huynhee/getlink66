import assert from "node:assert/strict";
import test from "node:test";
import { createArchiveTrace, readArchiveTrace } from "../src/utils/archiveTrace.js";
import { ARCHIVE_WEBSITE_SHORTCUT, createArchiveExtraFiles, readArchiveExtraFiles, validArchiveTextName } from "../src/utils/archiveExtraFiles.js";

const env = { ARCHIVE_TRACE_SECRET: "53".repeat(32) };
const claims = { userId: "000000000000000000000001", modelId: "000000000000000000000002",
  sessionId: "000000000000000000000003", assetType: "model" };
const setting = { archiveTextFileEnabled: true, archiveTextFileName: "3dipl.txt", archiveTextFileText: "3dipl.org\nTài nguyên 3D" };

test("information files contain a fixed HTTPS shortcut and the same opaque per-download identity", () => {
  const token = createArchiveTrace(claims, env);
  const snapshot = createArchiveExtraFiles(setting, token);
  const files = readArchiveExtraFiles(snapshot);
  assert.equal(files.length, 2);
  assert.match(files[0].name, /^3dipl-[a-f0-9]{32}\.txt$/);
  assert.equal(files[1].name, files[0].name.slice(0, -4) + ".url");
  assert.equal(files[1].text, ARCHIVE_WEBSITE_SHORTCUT);
  assert.equal(files[0].text, setting.archiveTextFileText + "\n\n" + token);
  assert.equal(readArchiveTrace(files[0].text, env).userId, claims.userId);
  assert.ok(!snapshot.includes(claims.userId));
  assert.equal(createArchiveExtraFiles(setting, token), snapshot, "The session snapshot is stable for range retries");
  const other = createArchiveExtraFiles(setting, createArchiveTrace(claims, env));
  assert.notEqual(readArchiveExtraFiles(other)[0].name, files[0].name);
  assert.equal(createArchiveExtraFiles({}, token), "");
  assert.deepEqual(readArchiveExtraFiles(""), []);
});

test("information names and snapshots reject paths, reserved devices, controls, extra fields and unsafe URL targets", () => {
  for (const name of ["", ".txt", "../test.txt", "file..txt", "dir/file.txt", "dir\\file.txt", "CON.txt", "con.extra.txt", "LPT1.txt",
    "file.txt.exe", "a".repeat(61) + ".txt", "name .txt", "name\r\n.txt", "file.exe", "file:stream.txt"]) assert.equal(validArchiveTextName(name), false, name);
  for (const name of ["3dipl.txt", "Read me.TXT", "License (3).txt"]) assert.equal(validArchiveTextName(name), true, name);
  const token = createArchiveTrace(claims, env);
  for (const change of [{ archiveTextFileName: "../x.txt" }, { archiveTextFileText: "a".repeat(4097) }, { archiveTextFileText: "bad\0text" }]) {
    assert.throws(() => createArchiveExtraFiles({ ...setting, ...change }, token), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  }
  const files = readArchiveExtraFiles(createArchiveExtraFiles(setting, token));
  for (const invalid of ["[", "a".repeat(20001), "null", "{}", JSON.stringify(files.slice(0, 1)),
    JSON.stringify([{ ...files[0], name: "../" + files[0].name }, files[1]]),
    JSON.stringify([{ ...files[0], text: "bad\0content" }, files[1]]),
    JSON.stringify([{ ...files[0], extra: true }, files[1]]),
    JSON.stringify([files[0], { ...files[1], text: "[InternetShortcut]\r\nURL=file://server/share\r\n" }]),
    JSON.stringify([files[0], { ...files[1], text: "[InternetShortcut]\r\nURL=https://example.test/\r\n" }])]) {
    assert.throws(() => readArchiveExtraFiles(invalid), { code: "ARCHIVE_COMMENT_UNSUPPORTED" });
  }
});
