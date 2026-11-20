import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const buildRoot = path.resolve(process.argv[2] || "frontend/dist");
const screenshotRoot = path.resolve(process.argv[3] || ".cache/home-image-search-qa");
const enabled = process.argv[4] !== "disabled";
const html = fs.readFileSync(path.join(buildRoot, "index.html"), "utf8");
assert.match(html, /rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
assert.match(html, /name="apple-mobile-web-app-title" content="3DIPL"/);
const icon = fs.readFileSync(path.join(buildRoot, "apple-touch-icon.png"));
const metadata = await sharp(icon).metadata();
assert.equal(metadata.width, 180);
assert.equal(metadata.height, 180);
assert.equal(metadata.hasAlpha, false);
fs.mkdirSync(screenshotRoot, { recursive: true });

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const file = path.resolve(buildRoot, `.${pathname}`);
  if (!file.startsWith(`${buildRoot}${path.sep}`) && file !== buildRoot) {
    res.writeHead(400).end();
    return;
  }
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(buildRoot, "index.html");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
  res.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream" });
  fs.createReadStream(target).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const executablePath = fs.existsSync(chromium.executablePath()) ? undefined : [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].find((file) => fs.existsSync(file));
let browser;
let searches = 0;
try {
  browser = await chromium.launch({ headless: true, executablePath });
  for (const width of [320, 390, 1440]) for (const language of ["vi", "en"]) for (const theme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    let signedIn = true;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.addInitScript(({ language, theme }) => {
      localStorage.setItem("language", language);
      localStorage.setItem("3dipl-theme", theme);
    }, { language, theme });
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      let data = {};
      if (url.pathname === "/api/auth/user") data = { user: signedIn ? { _id: "507f1f77bcf86cd799439011", name: "QA", credit: 100 } : null };
      else if (url.pathname === "/api/auth/csrf") data = { csrfToken: "qa-only" };
      else if (url.pathname.includes("/categories")) data = { categories: [] };
      else if (url.pathname.includes("/filters")) data = { filters: {} };
      else if (url.pathname.endsWith("image-search")) {
        assert.equal(route.request().method(), "POST");
        assert.match(route.request().postDataJSON().imageData, /^data:image\/jpeg;base64,/);
        searches += 1;
        data = { assets: [], imageSearch: { engine: "fixture" } };
      } else if (/\/marketplace\/(models|scenes)$/.test(url.pathname)) data = { assets: [], pagination: { page: 1, totalPages: 1, total: 0 } };
      return route.fulfill({ json: data });
    });
    try {
      await page.goto(origin);
      const search = page.locator(".homeCatalogSearch");
      await search.waitFor();
      const imageLink = search.locator(".homeCatalogSearchImage");
      assert.equal(await imageLink.count(), enabled ? 1 : 0);
      assert.equal(await search.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
      const iconResponse = await context.request.get(`${origin}/apple-touch-icon.png`);
      assert.equal(iconResponse.headers()["content-type"], "image/png");
      if (enabled) for (const kind of ["models", "scenes"]) {
        await page.goto(origin);
        const form = page.locator(".homeCatalogSearch");
        await form.getByRole("tab", { name: kind === "models" ? "3D Models" : "3D Scenes" }).click();
        const link = form.locator(".homeCatalogSearchImage");
        assert.equal(await link.getAttribute("href"), `/${kind}?imageSearch=1`);
        assert.equal(await link.getAttribute("title"), language === "vi" ? "Tìm bằng hình ảnh" : "Search by image");
        await page.screenshot({ path: path.join(screenshotRoot, `${width}-${language}-${theme}-${kind}-home.png`) });
        await link.click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        assert.match(await dialog.locator("h2").innerText(), kind === "models" ? /model/i : /scene/i);
        assert.equal(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
        await dialog.locator('input[type="file"]').setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: icon });
        const response = page.waitForResponse((r) => new URL(r.url()).pathname === (kind === "models" ? "/api/marketplace/image-search" : "/api/marketplace/scenes/image-search"));
        await dialog.locator(".primaryButton").click();
        assert.equal((await response).ok(), true);
        await dialog.waitFor({ state: "hidden" });
        await page.locator(".marketImageSearchMeta").waitFor();
        await page.reload();
        await page.getByRole("dialog").waitFor();
      }
      if (enabled) {
        signedIn = false;
        await page.goto(`${origin}/?ref=qa-home`);
        for (const kind of ["models", "scenes"]) {
          await page.getByRole("tab", { name: kind === "models" ? "3D Models" : "3D Scenes" }).click();
          const href = new URL(await page.locator(".homeCatalogSearchImage").getAttribute("href"), origin);
          assert.equal(href.pathname, "/api/auth/google");
          assert.equal(href.searchParams.get("returnTo"), `/${kind}?imageSearch=1`);
          assert.equal(href.searchParams.get("ref"), "qa-home");
        }
      }
      assert.deepEqual(errors, []);
    } finally {
      await context.close();
    }
  }
  console.log(JSON.stringify({ enabled, viewports: [320, 390, 1440], languages: ["vi", "en"], themes: ["light", "dark"], searches, appleTouchIcon: "180x180 opaque PNG", screenshots: screenshotRoot }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
