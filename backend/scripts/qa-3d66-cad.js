import assert from "node:assert/strict";
import { build3D66FootprintSeed, resolveRewrittenFootprintPage } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { open3D66RewrittenFootprintCard } from "../src/utils/3d66BrowserService.js";
import { assert3D66CleanModelUrl } from "../src/utils/3d66CleanLink.js";
import { read3D66CadVerification } from "../src/utils/3d66CadProof.js";

export async function verify3D66UnsignedCad(browser) {
  const previous = process.env.THREED66_REQUIRED_ACCOUNT_MARKER;
  process.env.THREED66_REQUIRED_ACCOUNT_MARKER = "89635771";
  try {
    for (const scenario of [{ width: 1440 }, { width: 390, noOrigin: true }, { width: 390, sameTab: true },
      { width: 1440, wrongAccount: true }, { width: 390, wrongAsset: true }]) {
      const source = "https://cad.3d66.com/reshtmla/cad/items/fixture/source.html?sof=JJI139810814629725&sign=sender-fixture";
      const seed = build3D66FootprintSeed(source);
      const history = "https://user.3d66.com/newUser/index/index/footprint";
      const model = `https://cad.3d66.com/reshtmla/cad/items/fixture/canonical.html?sof=${seed.productId}&st=2`;
      const context = await browser.newContext({ viewport: { width: scenario.width, height: 900 }, serviceWorkers: "block",
        proxy: { server: "http://127.0.0.1:9" } });
      const calls = [], visits = [], forbidden = [];
      const response = data => ({ ok: () => true, status: () => 200,
        async body() { return Buffer.from(JSON.stringify(data)); }, async dispose() {} });
      await context.addCookies([{ name: "PHPSESSID", value: "fixture", url: "https://cad.3d66.com" },
        { name: "login_sign", value: "fixture-login", url: "https://cad.3d66.com" }]);
      context.request.get = async (url, options) => {
        assert.equal(url, "https://user.3d66.com/new-user-api/api/v1/user/info");
        assert.equal(options.maxRedirects, 0); calls.push("account");
        return response({ code: 200, data: { basic: { user_id: scenario.wrongAccount ? 999999999 : 177536980 } } });
      };
      context.request.post = async (url, options) => {
        assert.equal(url, "https://user.3d66.com/api/v1/download/pop");
        assert.deepEqual(options.form, { sof: seed.productId, res_type: "8" }); calls.push("metadata");
        return response({ status: 200, data: { token: "fixture-only", resInfo: {
          sof: seed.productId, res_type: 8, is_delete: 0, res_price: 28,
        } } });
      };
      await context.route("**/*", async route => {
        const url = route.request().url();
        if (route.request().isNavigationRequest()) visits.push(url);
        if (url === seed.url) return route.fulfill({ contentType: "text/html", body: "<title>Source fixture</title>" });
        if (url === history) return route.fulfill({ contentType: "text/html", body: `<title>History fixture</title><a href="${model}" target="${scenario.sameTab ? "_self" : "_blank"}">CAD</a>` });
        if (url === model) {
          const detail = { code: 200, data: { sof_user_id: 177536980, res: {
            ll_id: scenario.wrongAsset ? "AJI89635771994629725" : seed.productId, ll_id_out: 21681188, res_type: 8,
            is_delete: 0, ...(scenario.noOrigin ? {} : { origin_ll_url: model }), res_price: 28, file_format: 8, cad_version: "2014", res_suffix: "DWG",
          } } };
          const escaped = JSON.stringify(detail).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
          return route.fulfill({ contentType: "text/html", body: `<title>CAD fixture</title><h1 class="model-name">CAD fixture</h1>
            <input id="detail_data" value="${escaped}"><button class="j_download" onclick="window.__downloadClicked=true">Download</button>` });
        }
        if (new URL(url).pathname === "/favicon.ico") return route.fulfill({ status: 204, body: "" });
        forbidden.push(new URL(url).pathname); return route.abort();
      });
      try {
        const page = await context.newPage();
        const task = () => resolveRewrittenFootprintPage({ page, seed, settleMs: 500, refreshAttempts: 1,
          navigate: (target, url) => target.goto(url),
          openHistoryLink: (target, card, bound) => open3D66RewrittenFootprintCard(target, card, bound, context) });
        if (scenario.wrongAccount || scenario.wrongAsset) {
          await assert.rejects(task(), error => error.code === "THREED66_CLEAN_LINK_REQUIRED");
        } else {
          const result = await task();
          assert.equal(assert3D66CleanModelUrl(result.url), seed.productId);
          assert.ok(read3D66CadVerification(result.url));
          assert.equal(new URL(result.url).searchParams.has("sign"), false);
          assert.deepEqual(calls, ["account", "metadata"]);
        }
        for (const target of context.pages()) assert.notEqual(await target.evaluate(() => globalThis.__downloadClicked), true);
        assert.deepEqual(forbidden, []);
        assert.deepEqual(visits, [seed.url, history, model]);
      } finally { await context.close(); }
    }
  } finally {
    if (previous === undefined) delete process.env.THREED66_REQUIRED_ACCOUNT_MARKER;
    else process.env.THREED66_REQUIRED_ACCOUNT_MARKER = previous;
  }
}
