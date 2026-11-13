import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { adminArchiveCommentSettings, adminUpdateArchiveCommentSettings } = await import("../src/controllers/archiveCommentController.js");

beforeEach(async (t) => {
  await SiteSetting.deleteMany({});
  const previous = process.env.ARCHIVE_TRACE_SECRET;
  process.env.ARCHIVE_TRACE_SECRET = "67".repeat(32);
  t.after(() => {
    if (previous === undefined) delete process.env.ARCHIVE_TRACE_SECRET;
    else process.env.ARCHIVE_TRACE_SECRET = previous;
  });
});

async function request(handler, body) {
  const res = {
    statusCode: 200, headers: {}, body: null,
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  await handler({ body }, res, (error) => { throw error; });
  return res;
}

const update = (body) => request(adminUpdateArchiveCommentSettings, body);
const read = () => request(adminArchiveCommentSettings);
const defaults = { enabled: false, text: "3dipl.org", keyConfigured: true,
  textFileEnabled: false, textFileName: "3dipl.txt", textFileText: "3dipl.org" };
const configured = { enabled: true, text: "Archive comment", textFileEnabled: true,
  textFileName: "licensed-asset.txt", textFileText: "Licensed asset\n3dipl.org" };

test("settings expose safe TXT defaults for absent and legacy records without caching", async () => {
  const absent = await read();
  assert.deepEqual(absent.body, defaults);
  assert.equal(absent.headers["cache-control"], "no-store");
  await SiteSetting.create({ key: "homepage", archiveCommentEnabled: true, archiveCommentText: "Legacy" });
  assert.deepEqual((await read()).body, { ...defaults, enabled: true, text: "Legacy" });
});

test("TXT/URL settings roundtrip, normalize line endings and leave unrelated settings alone", async () => {
  await SiteSetting.create({ key: "homepage", heroText: "Unrelated home setting" });
  const saved = await update({ ...configured, text: "Archive\r\ncomment", textFileText: "Licensed\r\nasset\r3dipl.org" });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.headers["cache-control"], "no-store");
  assert.deepEqual(saved.body, { ...configured, keyConfigured: true, text: "Archive\ncomment", textFileText: "Licensed\nasset\n3dipl.org" });
  assert.deepEqual((await read()).body, saved.body);
  const stored = await SiteSetting.findOne({ key: "homepage" }).lean();
  assert.equal(stored.archiveTextFileEnabled, true);
  assert.equal(stored.archiveTextFileName, configured.textFileName);
  assert.equal(stored.archiveTextFileText, "Licensed\nasset\n3dipl.org");
  assert.equal(stored.heroText, "Unrelated home setting");
  assert.ok(!JSON.stringify(saved.body).includes(process.env.ARCHIVE_TRACE_SECRET));
});

test("old clients updating only enabled and text preserve all saved TXT/URL settings", async () => {
  await update(configured);
  const saved = await update({ enabled: false, text: "New comment" });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body, { ...configured, keyConfigured: true, enabled: false, text: "New comment" });
  assert.deepEqual((await read()).body, saved.body);
});

test("each optional TXT field updates independently, including explicit false and empty text", async () => {
  await update(configured);
  const base = { enabled: true, text: configured.text };
  let saved = await update({ ...base, textFileEnabled: false });
  assert.deepEqual(saved.body, { ...configured, keyConfigured: true, textFileEnabled: false });
  saved = await update({ ...base, textFileName: "other.txt" });
  assert.deepEqual(saved.body, { ...configured, keyConfigured: true, textFileEnabled: false, textFileName: "other.txt" });
  saved = await update({ ...base, textFileText: "" });
  assert.deepEqual(saved.body, { ...configured, keyConfigured: true, textFileEnabled: false, textFileName: "other.txt", textFileText: "" });
});

test("legacy clients creating the first record receive TXT/URL defaults", async () => {
  const saved = await update({ enabled: false, text: "" });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body, { ...defaults, text: "" });
});

test("TXT validation accepts exactly 4096 UTF-8 bytes including multibyte text", async () => {
  for (const textFileText of ["a".repeat(4096), "\u{1f642}".repeat(1024), "\tPlain\ntext\r\n"]) {
    const saved = await update({ ...configured, textFileText });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.textFileText, textFileText.replace(/\r\n?/g, "\n"));
  }
});

test("safe TXT basenames support the full length limit and uppercase extensions", async () => {
  for (const textFileName of ["a".repeat(60) + ".txt", "License (WEB)_01.TXT"]) {
    const saved = await update({ ...configured, textFileName });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.body.textFileName, textFileName);
  }
});

test("invalid TXT settings reject atomically even when the feature is off", async () => {
  await update(configured);
  const previous = await SiteSetting.findOne({ key: "homepage" }).lean();
  const invalid = [
    ...[null, undefined, 0, 1, "false", [], {}].map((textFileEnabled) => ({ textFileEnabled })),
    ...["", "../notice.txt", "sub/notice.txt", "sub\\notice.txt", "C:\\notice.txt", "notice.url",
      "https://3dipl.org/notice.txt", "a\0.txt", "CON.txt", "aux.txt", "COM1.txt", "double..dot.txt", "trailing .txt",
      "a".repeat(61) + ".txt", null, undefined, 42].map((textFileName) => ({ textFileName })),
    ...["a".repeat(4097), "\u{1f642}".repeat(1025), "bad\x1bcontrol", "bad\x7fcontrol", "bad\0text", null, undefined, 42, {}]
      .map((textFileText) => ({ textFileText })),
  ];
  for (const fields of invalid) {
    const result = await update({ enabled: false, text: "Must not be saved", ...fields });
    assert.equal(result.statusCode, 400, `Must reject ${JSON.stringify(fields)}`);
    assert.equal(result.body.code, "ARCHIVE_TEXT_FILE_INVALID");
    assert.deepEqual(await SiteSetting.findOne({ key: "homepage" }).lean(), previous);
  }
});

test("enabled and comment text remain required and validated for every update", async () => {
  for (const body of [null, {}, { text: "Comment" }, { enabled: false }, { enabled: "true", text: "Comment" },
    { enabled: false, text: null }, { enabled: false, text: "bad\0comment" }, { enabled: false, text: "a".repeat(4097) }]) {
    const result = await update(body);
    assert.equal(result.statusCode, 400);
    assert.equal(result.body.code, "ARCHIVE_COMMENT_INVALID");
  }
  assert.equal(await SiteSetting.countDocuments({}), 0);
});

test("arbitrary URL destinations, private keys and unknown storage keys cannot be configured", async () => {
  for (const field of ["url", "textFileUrl", "urlFileUrl", "keyConfigured", "ARCHIVE_TRACE_SECRET", "archiveTextFileEnabled"]) {
    assert.equal((await update({ ...configured, [field]: "https://untrusted.example/" })).statusCode, 400);
  }
  assert.equal(await SiteSetting.countDocuments({}), 0);
});

test("TXT settings may be staged without a trace key but marking cannot be enabled", async () => {
  delete process.env.ARCHIVE_TRACE_SECRET;
  const staged = await update({ ...configured, enabled: false });
  assert.equal(staged.statusCode, 200);
  assert.deepEqual(staged.body, { ...configured, enabled: false, keyConfigured: false });
  const rejected = await update({ ...configured, textFileName: "not-saved.txt" });
  assert.equal(rejected.statusCode, 409);
  assert.equal(rejected.body.code, "ARCHIVE_TRACE_KEY_REQUIRED");
  assert.deepEqual((await read()).body, staged.body);
});

test("a lost trace key still allows marking to be disabled without resetting TXT/URL", async () => {
  await update(configured);
  delete process.env.ARCHIVE_TRACE_SECRET;
  const saved = await update({ enabled: false, text: configured.text });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(saved.body, { ...configured, enabled: false, keyConfigured: false });
});
