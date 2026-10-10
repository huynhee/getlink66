import assert from "node:assert/strict";
import test from "node:test";
import { fetch3D66Preview, fetchFrom3D66 } from "../src/utils/3d66Service.js";
import { normalizeAccountModelId } from "../src/utils/parse3d66.js";

const inputId = "BCH01077971442400";
const accountId = "BCH89635771442400";
const modelPage = "https://3d.3d66.com/reshtmla/model/items/fixture/model.html";
const cookie = "PHPSESSID=fixture; login_token=fixture; login_sign=fixture";
const fileUrl = "https://download.3d66.com/fixture.zip?auth_key=fixture";

function configure(t, overrides = {}) {
  const values = {
    THREED66_MOCK: "false",
    THREED66_PROXY_ENABLED: "false",
    THREED66_ACCOUNT_SEARCH_ENABLED: "true",
    THREED66_MODEL_RESOLVE_MODE: "search",
    THREED66_ACCOUNT_ID: "177536980",
    THREED66_ACCOUNT_MARKER: "89635771",
    THREED66_REQUIRED_ACCOUNT_MARKER: "89635771",
    THREED66_BROWSER_ALWAYS: "false",
    THREED66_DISABLE_BROWSER_PAGE_FALLBACK: "true",
    THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK: "true",
    THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK: "false",
    THREED66_DOWNLOAD_ENDPOINT: "https://user.3d66.com/api/v1/download/handle",
    THREED66_DOWNLOAD_POP_ENDPOINT: "https://user.3d66.com/api/v1/download/pop",
    ...overrides,
  };
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function sourceUrl(tracked = false) {
  const url = new URL(modelPage);
  url.searchParams.set("sof", inputId);
  url.searchParams.set("sign", "old-fixture-sign");
  url.searchParams.set("action_id", "old-fixture-action");
  if (tracked) {
    url.searchParams.set("r_id", "old-fixture-request");
    url.searchParams.set("parentId", "BBG0107797125605");
    url.searchParams.set("a_v", "34.1");
    url.searchParams.set("p", "16");
  } else {
    url.searchParams.set("kw", inputId);
  }
  return url.toString();
}

function signedAccountUrl(productId = accountId) {
  const url = new URL(modelPage);
  url.searchParams.set("sof", productId);
  url.searchParams.set("sign", "fresh-fixture-sign");
  url.searchParams.set("action_id", "fresh-fixture-action");
  return url.toString();
}

function mockDownloadApis(t, resolvedUrl = signedAccountUrl()) {
  const searches = [];
  const downloads = [];
  const resolvedId = new URL(resolvedUrl).searchParams.get("sof");
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    assert.equal(options.headers.cookie, cookie);
    if (url.pathname === "/api/v1/search/checkKeyword") {
      searches.push({ keyword: url.searchParams.get("keyword"), referer: options.headers.referer });
      return Response.json({ status: 200, data: { url: resolvedUrl } });
    }
    if (url.pathname === "/api/v1/download/pop") {
      assert.equal(options.body.get("sof"), resolvedId);
      return Response.json({
        status: 200,
        data: {
          token: "fixture-download-token",
          is_direct_download: 1,
          resInfo: { sof: resolvedId, res_name: "Fixture model", res_price: 28, res_type: "1" },
        },
      });
    }
    if (url.pathname === "/api/v1/download/handle") {
      downloads.push(options.body);
      return Response.json({ status: 200, data: { fileUrl } });
    }
    assert.fail(`Unexpected upstream request: ${url.origin}${url.pathname}`);
  });
  return { searches, downloads };
}

for (const tracked of [false, true]) {
  test(`pasted ${tracked ? "tracked" : "search"} model URLs resolve using the configured account marker`, async (t) => {
    configure(t);
    const source = sourceUrl(tracked);
    const { searches, downloads } = mockDownloadApis(t);

    const result = await fetchFrom3D66(source, cookie);

    assert.equal(searches.length, 1);
    assert.equal(searches[0].keyword, accountId);
    const referer = new URL(searches[0].referer);
    assert.equal(referer.searchParams.get("sof"), accountId);
    assert.equal(referer.searchParams.has("sign"), false);
    assert.equal(referer.searchParams.has("action_id"), false);
    assert.equal(referer.searchParams.has("r_id"), false);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].get("ll_id"), accountId);
    assert.equal(downloads[0].get("action_id"), "fresh-fixture-action");
    assert.equal(new URL(downloads[0].get("resUrl")).searchParams.get("sign"), "fresh-fixture-sign");
    assert.equal(result.sourceUrl, source);
    assert.equal(result.productId, inputId);
    assert.equal(new URL(result.resolvedSourceUrl).searchParams.get("sof"), accountId);
    assert.equal(result.fileUrl, fileUrl);
  });
}

test("account resolution honors a configured marker instead of hardcoding the default", async (t) => {
  configure(t, { THREED66_ACCOUNT_MARKER: "12345678", THREED66_REQUIRED_ACCOUNT_MARKER: "12345678" });
  const expectedId = "BCH12345678442400";
  const { searches, downloads } = mockDownloadApis(t, signedAccountUrl(expectedId));

  await fetchFrom3D66(sourceUrl(), cookie);

  assert.equal(searches[0].keyword, expectedId);
  assert.equal(downloads[0].get("ll_id"), expectedId);
  assert.equal(normalizeAccountModelId(expectedId), expectedId);
});

test("a comment-only VPS marker still obtains fresh context for the account ID", async (t) => {
  configure(t, { THREED66_ACCOUNT_MARKER: "# Override marker; derive from THREED66_ACCOUNT_ID." });
  const { searches, downloads } = mockDownloadApis(t);

  const result = await fetchFrom3D66(sourceUrl(true), cookie);

  assert.equal(searches[0].keyword, accountId);
  assert.equal(downloads[0].get("ll_id"), accountId);
  assert.equal(result.productId, inputId);
  assert.equal(new URL(result.resolvedSourceUrl).searchParams.get("sof"), accountId);
});

test("an input already using the configured marker is not rewritten twice", async (t) => {
  configure(t);
  const { searches, downloads } = mockDownloadApis(t);

  const result = await fetchFrom3D66(signedAccountUrl(), cookie);

  assert.equal(searches.length, 1);
  assert.equal(searches[0].keyword, accountId);
  assert.equal(downloads[0].get("ll_id"), accountId);
  assert.equal(result.productId, accountId);
});

test("a lookup miss stops without searching the original account or calling download APIs", async (t) => {
  configure(t);
  const resolvedId = "FCH4563033442400";
  const resolvedUrl = signedAccountUrl(resolvedId);
  const { searches, downloads } = mockDownloadApis(t, resolvedUrl);
  const mockFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/search/checkKeyword" && url.searchParams.get("keyword") === accountId) {
      searches.push({ keyword: accountId });
      return Response.json({ status: 200, data: {} });
    }
    return mockFetch(input, options);
  });

  await assert.rejects(fetchFrom3D66(sourceUrl(), cookie), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.deepEqual(searches.map((search) => search.keyword), [accountId]);
  assert.equal(downloads.length, 0);
});

test("search misses never synthesize an unsigned model URL for preview or download", async (t) => {
  configure(t);
  const searches = [];
  t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input);
    if (url.pathname === "/api/v1/search/checkKeyword") {
      searches.push(url.searchParams.get("keyword"));
      return Response.json({ status: 200, data: {} });
    }
    assert.fail(`Unexpected download request: ${url.pathname}`);
  });

  await assert.rejects(fetch3D66Preview(sourceUrl(true), cookie), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.deepEqual(searches, [accountId]);
});

test("fresh footprint URLs keep the actual cookie account ID and signature", async (t) => {
  configure(t, { THREED66_MODEL_RESOLVE_MODE: "footprint" });
  const resolvedId = "ACH89635771442400";
  const resolved = new URL(signedAccountUrl(resolvedId));
  resolved.hash = new URLSearchParams({ resolved: "footprint", logical: inputId }).toString();
  const { searches, downloads } = mockDownloadApis(t, resolved.toString());

  const result = await fetchFrom3D66(resolved.toString(), cookie);

  assert.equal(searches.length, 0);
  assert.equal(downloads[0].get("ll_id"), resolvedId);
  assert.equal(new URL(downloads[0].get("resUrl")).searchParams.get("sign"), "fresh-fixture-sign");
  assert.equal(result.productId, inputId);
  assert.equal(new URL(result.resolvedSourceUrl).searchParams.get("sof"), resolvedId);
});

test("explicit direct mode preserves the caller's signed URL", async (t) => {
  configure(t, { THREED66_MODEL_RESOLVE_MODE: "direct" });
  const source = signedAccountUrl();
  const { searches, downloads } = mockDownloadApis(t, source);

  const result = await fetchFrom3D66(source, cookie);

  assert.equal(searches.length, 0);
  assert.equal(downloads[0].get("ll_id"), accountId);
  assert.equal(new URL(downloads[0].get("resUrl")).searchParams.get("sign"), "fresh-fixture-sign");
  assert.equal(result.resolvedSourceUrl, source);
});

for (const [name, resolved] of [
  ["original account", signedAccountUrl(inputId)],
  ["other cookie account", signedAccountUrl("FCH4563033442400")],
  ["unsigned URL", `${modelPage}?sof=${accountId}`],
  ["duplicate ID", `${signedAccountUrl()}&sof=${inputId}`],
]) {
  test(`search output with ${name} is rejected before any popup or purchase API`, async (t) => {
    configure(t);
    const { searches, downloads } = mockDownloadApis(t, resolved);
    await assert.rejects(fetchFrom3D66(sourceUrl(), cookie), { code: "THREED66_CLEAN_LINK_REQUIRED" });
    assert.equal(searches.length, 1);
    assert.equal(downloads.length, 0);
  });
}

for (const mode of ["direct", "footprint"]) {
  test(`${mode} cannot bypass the account gate with an original-account signed URL`, async (t) => {
    configure(t, { THREED66_MODEL_RESOLVE_MODE: mode });
    const source = new URL(sourceUrl());
    if (mode === "footprint") source.hash = new URLSearchParams({ resolved: "footprint", logical: inputId });
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => { calls += 1; assert.fail("No upstream call allowed"); });
    await assert.rejects(fetchFrom3D66(source.toString(), cookie), { code: "THREED66_CLEAN_LINK_REQUIRED" });
    assert.equal(calls, 0);
  });
}

test("a popup response for another model stops without browser or purchase fallback", async (t) => {
  configure(t);
  const { downloads } = mockDownloadApis(t);
  const mockFetch = globalThis.fetch;
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    if (new URL(input).pathname === "/api/v1/download/pop") {
      return Response.json({ status: 200, data: { resInfo: { sof: "ACH89635771999999" } } });
    }
    return mockFetch(input, options);
  });
  await assert.rejects(fetchFrom3D66(sourceUrl(), cookie), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.equal(downloads.length, 0);
});

test("an empty required marker cannot disable validation or trigger upstream calls", async (t) => {
  configure(t, { THREED66_REQUIRED_ACCOUNT_MARKER: "" });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls += 1; assert.fail("No upstream call allowed"); });
  await assert.rejects(fetchFrom3D66(sourceUrl(), cookie), { code: "THREED66_CLEAN_LINK_REQUIRED", status: 503 });
  assert.equal(calls, 0);
});
