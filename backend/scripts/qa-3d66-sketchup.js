import assert from "node:assert/strict";
import { build3D66FootprintSeed, resolveRewrittenFootprintPage } from "../src/utils/3d66RewrittenFootprintResolver.js";
import { open3D66RewrittenFootprintCard } from "../src/utils/3d66BrowserService.js";

export async function verify3D66SketchUp(browser) {
  const history = "https://user.3d66.com/newUser/index/index/footprint";
  for (const sketchup of [false, true]) {
    for (const unsigned of [false, true]) {
      const origin = sketchup ? "https://su.3d66.com" : "https://3d.3d66.com";
      const resource = sketchup ? "sketchup" : "model";
      const base = `${origin}/reshtmla/${resource}/items/fixture/browser-model.html`;
      const seed = build3D66FootprintSeed(`${base}?sof=JJI139810814629725&sign=sender-fixture`);
      const canonical = `${origin}/reshtmla/${resource}/items/fixture/canonical.html`;
      const signed = `${canonical}?sof=${seed.productId}&st=2&sign=source-fixture`;
      const wrongOrigin = sketchup ? "https://3d.3d66.com" : "https://su.3d66.com";
      const wrongResource = sketchup ? "model" : "sketchup";
      const wrong = `${wrongOrigin}/reshtmla/${wrongResource}/items/fixture/browser-model.html?sof=${seed.productId}&sign=other-resource`;
      const visits = [];
      const forbidden = [];
      const context = await browser.newContext({ viewport: { width: unsigned ? 390 : 1440, height: 900 },
        serviceWorkers: "block", proxy: { server: "http://127.0.0.1:9" } });
      // All network traffic is fulfilled or rejected locally, including source-looking URLs.
      await context.route("**/*", async route => {
        const url = new URL(route.request().url());
        if (/\/api\/.*(?:download|order|pay)/.test(url.pathname) || url.href === wrong) {
          forbidden.push(url.pathname);
          return route.abort();
        }
        if (route.request().isNavigationRequest()) visits.push(url.href);
        if (url.href === seed.url) return route.fulfill({ contentType: "text/html",
          body: `<!doctype html><script>location.href = ${JSON.stringify(origin + "/")}</script>` });
        if (url.href === history) {
          const target = unsigned ? signed.replace("&sign=source-fixture", "") : signed;
          const pointer = unsigned ? `onpointerdown="this.href='${signed}'"` : "";
          return route.fulfill({ contentType: "text/html", body: `<!doctype html><title>Fixture history</title>
            <a href="${wrong}">Other resource with the same ID</a>
            <a href="${target}" target="_blank" ${pointer}>Requested resource</a>` });
        }
        if (url.href === signed || (url.origin === origin && url.pathname === "/")) {
          return route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fixture model</title><h1 class='model-name'>Fixture</h1>" });
        }
        if (url.pathname === "/favicon.ico") return route.fulfill({ status: 204, body: "" });
        forbidden.push(url.pathname);
        return route.abort();
      });
      try {
        const page = await context.newPage();
        const result = await resolveRewrittenFootprintPage({ page, seed, settleMs: 500, refreshAttempts: 1,
          navigate: (target, url) => target.goto(url),
          openHistoryLink: (target, card, bound) => open3D66RewrittenFootprintCard(target, card, bound, context) });
        assert.equal(result.url, signed);
        assert.equal(result.canonicalModelPage, canonical);
        assert.equal(result.productId, seed.productId);
        assert.equal(visits.filter(url => url === seed.url).length, 1);
        assert.ok(visits.includes(history));
        assert.equal(visits.some(url => url.includes("sender-fixture")), false);
        assert.deepEqual(forbidden, []);
        assert.equal(context.pages().length, unsigned ? 2 : 1);
      } finally {
        await context.close();
      }
    }
  }
}
