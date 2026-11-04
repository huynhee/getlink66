import assert from "node:assert/strict";
import test from "node:test";
import { getlinkLanguage, isPublicGetlinkPath, publicGetlinkError, publicGetlinkJobData } from "../../frontend/src/utils/getlinkErrors.js";

const neutral = {
  vi: "Tạm thời chưa thể xử lý model này. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.",
  en: "This model is temporarily unavailable. Please try again later or contact support.",
};
let fixtureId = 0;

async function fixture(t, language, fetch) {
  const originalWindow = globalThis.window;
  globalThis.window = { localStorage: { getItem: (key) => key === "language" ? language : null } };
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  t.mock.method(globalThis, "fetch", fetch);
  return import(`../../frontend/src/api.js?public-error-ui=${++fixtureId}`);
}

for (const language of ["vi", "en"]) {
  test(`legacy technical errors become neutral ${language} feedback`, () => {
    for (const error of [
      { code: "THREED66_FUTURE_FAILURE", message: "private diagnostic" },
      { code: "THREED66_MANUAL_VERIFICATION_REQUIRED", message: "Please solve CAPTCHA in browser" },
      { message: "Please contact admin to replace the cookie" },
      { message: "Playwright profile is locked; relaunch Chromium" },
      { message: "rewritten_footprint failed while opening &st=2" },
      { message: "Open userDataDir and call launchPersistentContext" },
      { message: "Missing PHPSESSID or login_sign" },
      { message: "Use the collection resolver through the proxy" },
      { message: "Cần xác minh trình duyệt và hồ sơ tài khoản 3D66" },
      "BROWSER_TIMEOUT with CAPTCHA_REQUIRED",
    ]) {
      assert.deepEqual(publicGetlinkError(error, language), { code: "GETLINK_UNAVAILABLE", message: neutral[language] });
    }
  });

  test(`public codes are localized and legacy format/input codes stay actionable in ${language}`, () => {
    assert.equal(publicGetlinkError({ code: "GETLINK_UNAVAILABLE", message: "cookie=private" }, language).message, neutral[language]);
    for (const [code, expected] of [["THREED66_FORMAT_UNAVAILABLE", "GETLINK_FORMAT_UNAVAILABLE"],
      ["THREED66_MODEL_INPUT_INVALID", "GETLINK_INVALID_INPUT"], ["PLUGIN_INPUT_INVALID", "GETLINK_INVALID_INPUT"]]) {
      const safe = publicGetlinkError({ code, message: "Private browser information" }, language);
      assert.equal(safe.code, expected);
      assert.doesNotMatch(safe.message, /browser|cookie|THREED66_|CAPTCHA/i);
      assert.equal(safe.message, publicGetlinkError({ code: expected }, language).message);
      assert.notEqual(safe.message, neutral[language]);
    }
    assert.deepEqual(publicGetlinkError({ code: "THREED66_MODEL_REMOVED", message: "Private browser information" }, language),
      publicGetlinkError({ code: "GETLINK_MODEL_UNAVAILABLE" }, language));
  });

  test(`business error messages and codes survive in ${language}`, () => {
    for (const error of [
      { code: "INSUFFICIENT_CREDIT", message: "Insufficient credit: 28 required" },
      { code: "GETLINK_PRICE_CHANGED", message: "The model price changed. Confirm the current price." },
      { code: "GETLINK_DAILY_LIMIT", message: "You have reached today's download limit." },
      { code: "GETLINK_REDOWNLOAD_LIMIT", message: "Đã hết lượt tải lại miễn phí." },
      { code: "GETLINK_JOB_ACTIVE", message: "A getlink request is already processing." },
    ]) assert.deepEqual(publicGetlinkError(error, language), error);
  });

  test(`job sanitization preserves metadata, formats, price and retry flags in ${language}`, () => {
    const original = { preparationStatus: "ready", job: { id: "fixture", status: "failed", title: "Model", imageUrl: "/image",
      creditCost: 28, formatOptions: [{ key: "1|2014|4" }], selectedFormat: { key: "1|2014|4" },
      error: { code: "THREED66_PROFILE_LOCKED", message: "Private Playwright profile", retryable: true, status: 503 } } };
    const safe = publicGetlinkJobData(original, language);
    assert.deepEqual(safe, { ...original, job: { ...original.job,
      error: { code: "GETLINK_UNAVAILABLE", message: neutral[language], retryable: true, status: 503 } } });
    assert.equal(original.job.error.code, "THREED66_PROFILE_LOCKED", "Do not mutate cached responses or drafts");
    assert.deepEqual(publicGetlinkJobData({ job: { error: "CAPTCHA required" } }, language).job.error,
      { code: "GETLINK_UNAVAILABLE", message: neutral[language] });
  });

  test(`Getlink requests send the selected ${language} locale, but unrelated/admin requests do not`, async (t) => {
    const requests = [];
    const { api, apiBinary } = await fixture(t, language, async (url, options) => {
      requests.push({ path: new URL(url).pathname, headers: new Headers(options.headers) });
      return Response.json(url.endsWith("/api/auth/csrf") ? { csrfToken: "fixture-token" } : {});
    });
    for (const path of ["/api/getlink", "/api/getlink/jobs/latest?fresh=1", "/api/plugin/getlink", "/api/plugin/getlink/preview"]) {
      await api(path, { method: "POST", body: "{}", headers: { "accept-language": "fr", "x-fixture": "kept" } });
      assert.equal(requests.at(-1).headers.get("accept-language"), language);
      assert.equal(requests.at(-1).headers.get("x-fixture"), "kept");
      assert.equal(requests.at(-1).headers.get("x-csrf-token"), "fixture-token");
    }
    await apiBinary("/api/plugin/getlink", new Blob(["fixture"]));
    assert.equal(requests.at(-1).headers.get("accept-language"), language);
    for (const path of ["/api/admin/getlinks", "/api/admin/getlink", "/api/getlink-admin", "/api/plugin/getlink-config", "/api/settings"]) {
      await api(path);
      assert.equal(requests.at(-1).headers.has("accept-language"), false);
    }
    assert.equal(requests.find((request) => request.path === "/api/auth/csrf").headers.has("accept-language"), false);
  });

  test(`HTTP Getlink failures and failed job responses are safe in ${language}, without changing admin diagnostics`, async (t) => {
    const privateError = { code: "THREED66_BROWSER_FAILED", message: "CAPTCHA cookie profile &st=2" };
    const { api, apiBinary } = await fixture(t, language, async (url) => {
      if (url.endsWith("/api/auth/csrf")) return Response.json({ csrfToken: "fixture-token" });
      if (url.endsWith("/jobs/latest")) return Response.json({ job: { id: "failed", status: "failed", error: privateError } });
      if (url.endsWith("/credit")) return Response.json({ code: "INSUFFICIENT_CREDIT", message: "Need 28 credits", creditRequired: 28 }, { status: 402 });
      if (url.endsWith("/price")) return Response.json({ code: "GETLINK_PRICE_CHANGED", message: "Confirm the updated price", creditRequired: 42 }, { status: 409 });
      if (url.endsWith("/limit")) return Response.json({ code: "GETLINK_DAILY_LIMIT", message: "Today's download limit has been reached" }, { status: 429 });
      return Response.json({ ...privateError, job: { id: "failed", error: privateError } }, { status: 403 });
    });
    for (const request of [() => api("/api/getlink/preview"), () => apiBinary("/api/plugin/getlink", new Blob(["fixture"]))]) {
      await assert.rejects(request(), (error) => {
        assert.equal(error.code, "GETLINK_UNAVAILABLE");
        assert.equal(error.message, neutral[language]);
        assert.equal(error.status, 403);
        assert.equal(error.data.message, neutral[language]);
        assert.equal(error.data.job.error.message, neutral[language]);
        return true;
      });
    }
    const latest = await api("/api/getlink/jobs/latest");
    assert.equal(latest.job.error.message, neutral[language]);
    await assert.rejects(api("/api/getlink/credit"), (error) => {
      assert.equal(error.message, "Need 28 credits");
      assert.equal(error.code, "INSUFFICIENT_CREDIT");
      assert.equal(error.data.creditRequired, 28);
      return true;
    });
    for (const [path, code, message] of [["price", "GETLINK_PRICE_CHANGED", "Confirm the updated price"],
      ["limit", "GETLINK_DAILY_LIMIT", "Today's download limit has been reached"]]) {
      await assert.rejects(api(`/api/getlink/${path}`), (error) => {
        assert.equal(error.code, code);
        assert.equal(error.message, message);
        return true;
      });
    }
    await assert.rejects(api("/api/admin/getlinks"), (error) => {
      assert.equal(error.message, privateError.message);
      assert.equal(error.code, privateError.code);
      assert.equal(error.data.job.error.message, privateError.message);
      return true;
    });
  });

  test(`transport failures are neutral in ${language}, while aborts remain aborts`, async (t) => {
    const { api, apiBinary } = await fixture(t, language, async (_url, options) => {
      if (options.signal?.aborted) options.signal.throwIfAborted();
      throw new TypeError("Browser transport failed in private profile");
    });
    await assert.rejects(api("/api/getlink/preview"), { code: "GETLINK_UNAVAILABLE", message: neutral[language] });
    await assert.rejects(api("/api/getlink/preview", { method: "POST", body: "{}" }),
      { code: "GETLINK_UNAVAILABLE", message: neutral[language] });
    await assert.rejects(apiBinary("/api/plugin/getlink", new Blob(["fixture"])),
      { code: "GETLINK_UNAVAILABLE", message: neutral[language] });
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(api("/api/getlink/preview", { signal: controller.signal }), { name: "AbortError" });
    await assert.rejects(api("/api/admin/getlinks"), /Browser transport failed in private profile/);
  });

  test(`an HTML gateway fallback displays neutral ${language} feedback`, async (t) => {
    const { api } = await fixture(t, language,
      async () => new Response("<html>Private cookie/profile gateway diagnostic</html>", { status: 502 }));
    await assert.rejects(api("/api/getlink/preview"), { code: "GETLINK_UNAVAILABLE", message: neutral[language], status: 502 });
  });
}

test("Getlink locale defaults safely when browser storage is unavailable", async (t) => {
  await fixture(t, "en", async () => assert.fail("No network access is allowed"));
  globalThis.window.localStorage.getItem = () => { throw new Error("Storage disabled"); };
  assert.equal(getlinkLanguage(), "vi");
  assert.equal(publicGetlinkError({ code: "GETLINK_UNAVAILABLE" }).message, neutral.vi);
  delete globalThis.window;
  assert.equal(getlinkLanguage(), "vi");
});

test("Getlink scope matching excludes similar paths and admin routes", () => {
  assert.equal(isPublicGetlinkPath("/api/getlink?fresh=1"), true);
  assert.equal(isPublicGetlinkPath("/api/plugin/getlink/history"), true);
  for (const path of ["/api/getlinks", "/api/getlink-admin", "/api/admin/getlink", "/api/getlink/inspect", "/api/getlink/inspect?check=1", "/api/plugin/getlink-config", "/api/auth/csrf"]) {
    assert.equal(isPublicGetlinkPath(path), false);
  }
});

test("unexpected prototype property names never resolve as public message codes", () => {
  for (const code of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.deepEqual(publicGetlinkError({ code, message: "Please retry this model." }, "en"),
      { code, message: "Please retry this model." });
    assert.deepEqual(publicGetlinkError({ code }, "vi"), { code: "GETLINK_UNAVAILABLE", message: neutral.vi });
  }
});
