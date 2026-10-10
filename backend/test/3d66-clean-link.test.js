import assert from "node:assert/strict";
import test from "node:test";
import {
  assert3D66BrowserDownloadRequest, assert3D66CleanModelUrl, assert3D66DownloadFields,
  assert3D66StoredDownload, required3D66AccountMarker,
} from "../src/utils/3d66CleanLink.js";
import { isSwitchable3D66Error, shouldDegrade3D66Cookie } from "../src/utils/3d66CookiePool.js";
import { chargeAndCreateGetlink } from "../src/utils/getlinkChargeService.js";
import { request3D66File } from "../src/utils/3d66Service.js";

const modelId = "ACH89635771442400";
const foreignId = "BCH01077971442400";
const base = "https://3d.3d66.com/reshtmla/model/items/fixture/model.html";
const clean = `${base}?sof=${modelId}&sign=fixture-sign`;
const cookie = "PHPSESSID=fixture; login_token=fixture; login_sign=fixture";

function configure(t, overrides = {}) {
  const env = { THREED66_MOCK: "false", THREED66_REQUIRED_ACCOUNT_MARKER: "89635771", ...overrides };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

function rejectsLink(fn, reason) {
  assert.throws(fn, (error) => error.code === "THREED66_CLEAN_LINK_REQUIRED"
    && (!reason || error.details.reason === reason));
}

test("the required marker defaults to the intended account, not the search configuration", () => {
  assert.equal(required3D66AccountMarker({ THREED66_ACCOUNT_MARKER: "12345678" }), "89635771");
  for (const value of ["", "false", "# THREED66", "89635771 # comment", "1", "1234567890123"]) {
    rejectsLink(() => required3D66AccountMarker({ THREED66_REQUIRED_ACCOUNT_MARKER: value }), "invalid_required_marker");
  }
});

test("a signed model URL with the exact account marker and asset identity passes unchanged", (t) => {
  configure(t);
  assert.equal(assert3D66CleanModelUrl(clean, { expectedProductId: foreignId }), modelId);
  assert3D66DownloadFields(modelId, clean);
  assert3D66StoredDownload({ productId: foreignId, resolvedSourceUrl: clean });
});

const invalidLinks = [
  ["foreign account", `${base}?sof=${foreignId}&sign=fixture`, "account_marker_mismatch"],
  ["marker in a tracking param", `${base}?sof=${foreignId}&sign=fixture&kw=89635771`, "account_marker_mismatch"],
  ["marker in a hash", `${base}?sof=${foreignId}&sign=fixture#resolved=footprint&logical=${modelId}`, "account_marker_mismatch"],
  ["marker inside another marker", `${base}?sof=ACH189635771442400&sign=fixture`, "account_marker_mismatch"],
  ["missing asset suffix", `${base}?sof=ACH89635771&sign=fixture`, "account_marker_mismatch"],
  ["short asset suffix", `${base}?sof=ACH896357711234&sign=fixture`, "account_marker_mismatch"],
  ["missing sof", `${base}?kw=${modelId}&sign=fixture`, "missing_or_duplicate_sof"],
  ["duplicate sof", `${clean}&sof=${foreignId}`, "missing_or_duplicate_sof"],
  ["conflicting id", `${clean}&id=${foreignId}`, "conflicting_model_id"],
  ["no signature", `${base}?sof=${modelId}`, "missing_or_duplicate_signature"],
  ["empty signature", `${base}?sof=${modelId}&sign=`, "missing_or_duplicate_signature"],
  ["duplicate signature", `${clean}&sign=another`, "missing_or_duplicate_signature"],
  ["HTTP", clean.replace("https:", "http:"), "invalid_model_url"],
  ["credentials", clean.replace("https://", "https://user:pass@"), "invalid_model_url"],
  ["another host", clean.replace("3d.3d66.com", "3d66.com.evil.test"), "invalid_model_url"],
  ["nonstandard port", clean.replace("3d.3d66.com", "3d.3d66.com:8080"), "invalid_model_url"],
  ["non-model path", clean.replace("/reshtmla/model/items/fixture/model.html", "/login"), "invalid_model_url"],
];
for (const [name, url, reason] of invalidLinks) {
  test(`clean-link gate rejects ${name}`, (t) => {
    configure(t);
    rejectsLink(() => assert3D66CleanModelUrl(url), reason);
  });
}

test("another asset or download payload cannot reuse the valid URL", (t) => {
  configure(t);
  rejectsLink(() => assert3D66CleanModelUrl(clean, { expectedProductId: "ACH89635771999999" }), "asset_identity_mismatch");
  rejectsLink(() => assert3D66CleanModelUrl(clean, { expectedProductId: "ACI89635771442400" }), "asset_identity_mismatch");
  rejectsLink(() => assert3D66DownloadFields(foreignId, clean), "download_payload_mismatch");
});

test("stored downloads require resolved context and cannot use the original pasted URL as proof", (t) => {
  configure(t);
  rejectsLink(() => assert3D66StoredDownload({ productId: modelId, sourceUrl: clean }), "missing_or_invalid_url");
  rejectsLink(() => assert3D66StoredDownload({ productId: foreignId, resolvedSourceUrl: `${base}?sof=${foreignId}&sign=fixture` }));
});

test("browser API requests validate their frame, body IDs, and embedded source before network delivery", (t) => {
  configure(t);
  const request = {
    url: "https://user.3d66.com/api/v1/download/handle", method: "POST",
    contentType: "application/x-www-form-urlencoded", body: `ll_id=${modelId}`, sourceUrl: clean,
  };
  assert3D66BrowserDownloadRequest(request);
  assert3D66BrowserDownloadRequest({ ...request, contentType: "application/json", body: JSON.stringify({ ll_id: modelId, resUrl: clean }) });
  assert3D66BrowserDownloadRequest({ ...request, url: "https://user.3d66.com/api/v1/download/pop", body: `sof=${modelId}` });
  rejectsLink(() => assert3D66BrowserDownloadRequest({ ...request, body: `ll_id=${foreignId}` }));
  rejectsLink(() => assert3D66BrowserDownloadRequest({ ...request, body: `ll_id=${modelId}&ll_id=${foreignId}` }));
  rejectsLink(() => assert3D66BrowserDownloadRequest({ ...request, body: `ll_id=${modelId}&sof=${foreignId}` }));
  rejectsLink(() => assert3D66BrowserDownloadRequest({ ...request, body: new URLSearchParams({ ll_id: modelId, resUrl: `${base}?sof=${foreignId}&sign=fixture` }).toString() }));
  rejectsLink(() => assert3D66BrowserDownloadRequest({ ...request, sourceUrl: `${base}?sof=${foreignId}&sign=fixture` }));
  rejectsLink(() => assert3D66BrowserDownloadRequest({ ...request, sourceUrl: "" }));
});

test("a validation failure never switches or degrades cookies", (t) => {
  configure(t);
  let failure;
  try { assert3D66CleanModelUrl(`${base}?sof=${foreignId}&sign=fixture`); }
  catch (error) { failure = error; }
  assert.equal(isSwitchable3D66Error(failure), false);
  assert.equal(shouldDegrade3D66Cookie(failure), false);
});

test("unsafe context is rejected before a credit debit or history write", async (t) => {
  configure(t);
  const calls = [];
  await assert.rejects(chargeAndCreateGetlink({
    userId: "fixture-user", creditCost: 28,
    historyPayload: { productId: foreignId, resolvedSourceUrl: `${base}?sof=${foreignId}&sign=fixture` },
  }, {
    forceNonTransactional: true,
    deduct: async () => { calls.push("debit"); },
    getlinkModel: { create: async () => { calls.push("history"); } },
  }), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  assert.deepEqual(calls, []);
});

test("file streaming rejects dirty or absent model context before fetching bytes", async (t) => {
  configure(t);
  let fetches = 0;
  t.mock.method(globalThis, "fetch", async () => { fetches += 1; assert.fail("No upstream call allowed"); });
  for (const sourceUrl of [undefined, `${base}?sof=${foreignId}&sign=fixture`]) {
    await assert.rejects(request3D66File("https://download.3d66.com/fixture.zip", cookie, { sourceUrl }), { code: "THREED66_CLEAN_LINK_REQUIRED" });
  }
  assert.equal(fetches, 0);
});
