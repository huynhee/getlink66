import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parse3D66InlineFormats } from "../src/utils/3d66InlineFormats.js";
import { fetch3D66Preview, fetchFrom3D66, parseFormatOptionsFromHtml } from "../src/utils/3d66Service.js";
import { read3D66InlineFormats, select3D66InlineFormat } from "../src/utils/3d66BrowserService.js";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: User } = await import("../src/models/User.js");
const { default: Cookie } = await import("../src/models/Cookie.js");
const { default: ProductCache } = await import("../src/models/ProductCache.js");
const { default: Getlink } = await import("../src/models/Getlink.js");
const { previewGetlink, getLink } = await import("../src/controllers/getlinkController.js");
const { default: GetlinkJob } = await import("../src/models/GetlinkJob.js");
const { createGetlinkJob, processGetlinkJobQueue } = await import("../src/utils/getlinkJobService.js");
const html = fs.readFileSync(new URL("./fixtures/3d66-inline-formats.html", import.meta.url), "utf8");
const options = parseFormatOptionsFromHtml(html);
const cookie = "PHPSESSID=fixture; login_sign=fixture";
const productId = "ACI896357714629725";
const source = `https://3d.3d66.com/reshtmla/model/items/fixture/formats.html?sof=${productId}&sign=fixture`;

function configure(t) {
  const env = { THREED66_MOCK: "false", THREED66_MODEL_RESOLVE_MODE: "direct",
    THREED66_REQUIRED_ACCOUNT_MARKER: "89635771", THREED66_PROXY_ENABLED: "false",
    THREED66_BROWSER_ALWAYS: "false", THREED66_DISABLE_BROWSER_PAGE_FALLBACK: "true",
    THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK: "true", THREED66_REQUEST_INTERVAL_MS: "0",
    THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK: "false" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function upstream(t, pageHtml = html) {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, request = {}) => {
    const url = new URL(input);
    calls.push({ path: url.pathname, body: request.body });
    if (url.pathname === "/api/v1/download/pop") return Response.json({ status: 200, data: {
      token: "fixture-token", is_direct_download: 1,
      resInfo: { sof: productId, res_name: "Fixture format model", res_price: 28, res_type: "1",
        img: "https://respic.3d66.com/fixture.jpg" },
    } });
    if (url.pathname === "/api/v1/download/handle") return Response.json({ status: 200,
      data: { fileUrl: "https://download.3d66.com/fixture.zip" } });
    assert.equal(url.pathname, "/reshtmla/model/items/fixture/formats.html");
    return new Response(`<title>Fixture format model</title>${pageHtml}`);
  });
  return calls;
}

test("inline cards preserve the exact upstream tuple, nested title, renderer and size", () => {
  assert.deepEqual(options.map((option) => [option.key, option.label, option.rendererLabel, option.size, option.isDefault]), [
    ["1|2014|4", "VR max 2014", "Vray", "774.97MB", true],
    ["1|max2016|3", "CR max 2016", "Corona", "774.63MB", false],
  ]);
});

test("active second card is the only default; duplicate and unusable cards are excluded", () => {
  const secondActive = html.replace("card active", "card");
  const swapped = secondActive.replace('class="tp-multi-format-card" data-format-index="1"', 'class="tp-multi-format-card active" data-format-index="1"');
  const result = parse3D66InlineFormats(swapped + swapped + '<li class="tp-multi-format-card" data-file-format="0"></li>');
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((option) => option.isDefault), [false, true]);
});

test("legacy popup formats still parse when no inline cards exist", () => {
  const result = parseFormatOptionsFromHtml('<li class="pop-bd-item active" data-file_format="1" data-format_version="2018" data-renderer_type="4"><div class="bd-title">Legacy max</div><div class="right-file-size">12MB</div></li>');
  assert.equal(result[0].key, "1|2018|4");
  assert.equal(result[0].size, "12MB");
});

test("preview reads inline choices even when the lightweight API omits them, without purchasing", async (t) => {
  configure(t);
  const calls = upstream(t);
  const result = await fetch3D66Preview(source, cookie, { includeFormatOptions: true });
  assert.deepEqual(result.formatOptions, options);
  assert.equal(result.creditCost, 28);
  assert.equal(result.selectedFormat.key, options[0].key);
  assert.equal(calls.filter((call) => call.path.includes("/model/items/")).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/handle")).length, 0);
});

test("chosen inline format is validated and sent unchanged to the download API", async (t) => {
  configure(t);
  const calls = upstream(t);
  const result = await fetchFrom3D66(source, cookie, { downloadFormat: options[1] });
  const payload = calls.find((call) => call.path.endsWith("/handle"))?.body;
  assert.ok(payload);
  assert.equal(payload.get("file_format"), "1");
  assert.equal(payload.get("format_version"), "max2016");
  assert.equal(payload.get("renderer_type"), "3");
  assert.equal(result.selectedFormat.key, options[1].key);
});

test("preview without a selector honors the disabled browser fallback and returns no choices", async (t) => {
  configure(t);
  const calls = upstream(t, "");
  const result = await fetch3D66Preview(source, cookie, { includeFormatOptions: true });
  assert.deepEqual(result.formatOptions, []);
  assert.equal(result.title, "Fixture format model");
  assert.equal(calls.filter((call) => call.path.endsWith("/handle")).length, 0);
});

test("removed inline choice stops before the source purchase API", async (t) => {
  configure(t);
  const calls = upstream(t, html.replace(/<li class="tp-multi-format-card"[\s\S]*?<\/li>/, ""));
  await assert.rejects(fetchFrom3D66(source, cookie, { downloadFormat: options[1] }), { code: "THREED66_FORMAT_UNAVAILABLE" });
  assert.equal(calls.filter((call) => call.path.endsWith("/handle")).length, 0);
});

function response() {
  return { on() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; } };
}
function request(user, body = {}) {
  return { user, body: { url: source, ...body }, query: {}, params: {}, protocol: "https",
    get: () => "fixture.example.test", ip: "127.0.0.1", path: "/fixture" };
}

test("preview API refreshes old format cache, exposes options, then reuses them without billing", async (t) => {
  configure(t);
  const calls = upstream(t);
  const user = await User.create({ email: "formats@example.test", credit: 100 });
  const savedCookie = await Cookie.create({ value: cookie, isActive: true });
  const cache = await ProductCache.create({ productId, title: "Old fixture", imageUrl: "https://respic.3d66.com/fixture.jpg",
    creditCost: 28, priceKnown: true, sourceUrl: source, formatOptionsVersion: 2 });
  t.after(() => Cookie.deleteMany({ _id: savedCookie._id }));
  t.after(() => ProductCache.deleteMany({ _id: cache._id }));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = response();
    await previewGetlink(request(user), res, (error) => { throw error; });
    assert.deepEqual(res.body.formatOptions, options);
    assert.equal(res.body.hasDownloadFormats, true);
    assert.equal(res.body.selectedFormat.key, options[0].key);
  }
  assert.equal((await ProductCache.findById(cache._id)).formatOptionsVersion, 4);
  assert.ok((await ProductCache.findById(cache._id)).formatOptionsCheckedAt);
  assert.equal(calls.filter((call) => call.path.includes("/model/items/")).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith("/handle")).length, 0);
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(await Getlink.countDocuments({ userId: user._id }), 0);
});

test("forged option or inconsistent key cannot bypass a preview choice or debit credit", async (t) => {
  configure(t);
  const user = await User.create({ email: "formats-forged@example.test", credit: 100 });
  const cache = await ProductCache.create({ productId, sourceUrl: source, title: "Fixture", creditCost: 28,
    priceKnown: true, formatOptionsVersion: 4, formatOptions: options });
  t.after(() => ProductCache.deleteMany({ _id: cache._id }));
  t.mock.method(globalThis, "fetch", () => assert.fail("No upstream request for a forged option"));
  for (const format of [{ ...options[1], key: "1|9999|3", formatVersion: "9999" }, { ...options[1], rendererType: "4" }]) {
    let failure;
    await getLink(request(user, { downloadFormat: format }), response(), (error) => { failure = error; });
    assert.equal(failure?.code, "THREED66_FORMAT_UNAVAILABLE");
  }
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(await Getlink.countDocuments({ userId: user._id }), 0);
});

test("browser selects inline card before download and refuses a missing card", async () => {
  const calls = [];
  const page = { async evaluate(read, value) {
    calls.push(value);
    return read.name === "evaluateFormatOptions" ? options : true;
  }, async waitForFunction(_read, key) { if (key) assert.equal(key, options[1].key); },
  async title() { return "Fixture model"; } };
  assert.equal((await select3D66InlineFormat(page, options[1])).selectedFormat.key, options[1].key);
  assert.deepEqual(calls, [true, options[1].key]);
  await assert.rejects(select3D66InlineFormat(page, { key: "1|9999|3" }), { code: "THREED66_FORMAT_UNAVAILABLE" });
});

test("a preview selection runs through the real job executor, bills once and records the exact format", async (t) => {
  configure(t);
  const previous = process.env.GETLINK_JOB_ENABLED;
  process.env.GETLINK_JOB_ENABLED = "true";
  t.after(() => {
    if (previous === undefined) delete process.env.GETLINK_JOB_ENABLED;
    else process.env.GETLINK_JOB_ENABLED = previous;
  });
  const user = await User.create({ email: "formats-job@example.test", credit: 100 });
  const selected = options[1];
  const cache = await ProductCache.create({ productId, sourceUrl: source, resolvedSourceUrl: source,
    title: "Fixture format model", imageUrl: "https://respic.3d66.com/fixture.jpg", creditCost: 28, priceKnown: true,
    fileUrl: "https://download.3d66.com/fixture.zip", isPurchased: true,
    formatOptionsVersion: 4, formatOptions: options, downloadFormatKey: selected.key,
    fileFormat: selected.fileFormat, formatVersion: selected.formatVersion, rendererType: selected.rendererType,
    rendererLabel: selected.rendererLabel, formatLabel: selected.label, formatSize: selected.size });
  t.after(() => ProductCache.deleteMany({ _id: cache._id }));
  t.mock.method(globalThis, "fetch", () => assert.fail("The purchased fixture must not call the source"));
  const { job } = await createGetlinkJob({ userId: user._id,
    body: { modelId: source, downloadFormat: selected, clientRequestId: "inline-format-request-001" } });
  for (let attempt = 0; attempt < 2; attempt += 1) await processGetlinkJobQueue();
  const completed = await GetlinkJob.findById(job._id);
  assert.equal(completed.status, "completed", JSON.stringify(completed.error));
  assert.equal(completed.selectedFormat.key, selected.key);
  assert.equal((await User.findById(user._id)).credit, 72);
  const history = await Getlink.find({ userId: user._id });
  assert.equal(history.length, 1);
  assert.equal(history[0].downloadFormat.key, selected.key);
  assert.equal(history[0].downloadFormat.formatVersion, "max2016");
});

test("an expired empty format result is re-read without clearing purchased files or history", async (t) => {
  configure(t);
  const calls = upstream(t);
  const user = await User.create({ email: "formats-negative-cache@example.test", credit: 100 });
  const savedCookie = await Cookie.create({ value: cookie, isActive: true });
  const fileUrl = "https://download.3d66.com/already-purchased.zip";
  const cache = await ProductCache.create({ productId, sourceUrl: source, resolvedSourceUrl: source,
    title: "Fixture format model", imageUrl: "https://respic.3d66.com/fixture.jpg", creditCost: 28, priceKnown: true,
    fileUrl, formatOptions: [], formatOptionsVersion: 4, formatOptionsCheckedAt: new Date(Date.now() - 31000) });
  t.after(() => Cookie.deleteMany({ _id: savedCookie._id }));
  t.after(() => ProductCache.deleteMany({ _id: cache._id }));
  const res = response();
  await previewGetlink(request(user), res, (error) => { throw error; });
  assert.deepEqual(res.body.formatOptions, options);
  assert.equal((await ProductCache.findById(cache._id)).fileUrl, fileUrl);
  assert.equal(calls.filter((call) => call.path.endsWith("/handle")).length, 0);
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("format inspection waits for late cards and never clicks download", async () => {
  let ready = false;
  const page = {
    async waitForFunction() { await Promise.resolve(); ready = true; },
    async title() { return "Fixture model"; },
    async evaluate(read) { assert.equal(ready, true); assert.equal(read.name, "evaluateFormatOptions"); return options; },
  };
  assert.deepEqual(await read3D66InlineFormats(page), options);
});

test("format inspection handles only selector timeout and does not hide challenge or closed-page errors", async () => {
  const page = { async waitForFunction() { throw Object.assign(new Error("No cards"), { name: "TimeoutError" }); },
    async title() { return "Fixture model"; }, async evaluate() { return []; } };
  assert.deepEqual(await read3D66InlineFormats(page), []);
  await assert.rejects(read3D66InlineFormats({ ...page, async title() { return "访问验证"; } }), { status: 403 });
  await assert.rejects(read3D66InlineFormats({ ...page, async waitForFunction() { throw new Error("Page closed"); } }), /Page closed/);
});
