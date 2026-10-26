import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.argv[2] || "../frontend/dist");
const output = path.resolve(process.argv[3] || ".cache/archive-comment-ui");
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, "http://localhost").pathname;
    let file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`) || !(await fs.stat(file).catch(() => null))?.isFile()) file = path.join(root, "index.html");
    res.setHeader("content-type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await fs.mkdir(output, { recursive: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  const options = { headless: true };
  try { await fs.access(chromium.executablePath()); } catch { options.channel = "chrome"; }
  browser = await chromium.launch(options);
  for (const width of [1440, 390]) {
    for (const language of ["vi", "en"]) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width, height: 1000 } });
        const errors = [];
        let settings = { enabled: false, text: "3dipl.org", keyConfigured: true };
        let lookupError = false;
        let saves = 0;
        await context.addInitScript(({ language, theme }) => {
          localStorage.setItem("language", language); localStorage.setItem("3dipl-theme", theme);
          globalThis.EventSource = class { addEventListener() {} removeEventListener() {} close() {} };
        }, { language, theme });
        await context.route("**/api/**", async (route) => {
          const request = route.request();
          const url = new URL(request.url());
          let data = {};
          if (url.pathname === "/api/auth/user") data = { user: { _id: "000000000000000000000001", role: "admin", email: "fixture@example.test", isTwoFactorEnabled: true } };
          if (url.pathname === "/api/auth/csrf") data = { csrfToken: "fixture-csrf" };
          if (url.pathname === "/api/settings") data = { settings: {} };
          if (url.pathname === "/api/notifications") data = { notifications: [] };
          if (url.pathname === "/api/admin/archive-comments") {
            if (request.method() === "PUT") { settings = { ...settings, ...request.postDataJSON() }; saves += 1; }
            data = settings;
          }
          if (url.pathname === "/api/admin/archive-comments/lookup") {
            if (lookupError) return route.fulfill({ status: 400, json: { message: "Invalid archive reference or authentication tag." } });
            data = { trace: { userId: "000000000000000000000002", modelId: "000000000000000000000003", sessionId: "000000000000000000000004", assetType: "scene", issuedAt: "2026-10-26T02:00:00.000Z" },
              user: { email: "archive-fixture@example.test", name: "QA Account" }, asset: { title: "QA Scene" }, download: { status: "downloaded" } };
          }
          return route.fulfill({ json: data });
        });
        await context.route("https://**", (route) => route.abort());
        const page = await context.newPage();
        page.on("pageerror", (err) => errors.push(err.message));
        try {
          await page.goto(`${base}/admin`, { waitUntil: "networkidle" });
          await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: /^(Chung|General)$/ }).click();
          await page.getByRole("navigation", { name: "Admin subsections", exact: true }).getByRole("button", { name: /^(Lịch sử tải|Download history|Tải file|Downloads)\b/ }).click();
          const panel = page.locator(".adminArchiveComments");
          await panel.waitFor();
          assert.equal(await panel.evaluate((element) => element.open), false);
          await panel.locator("summary").press("Enter");
          const toggle = panel.getByRole("checkbox");
          await toggle.check();
          await panel.getByLabel(language === "vi" ? "Nội dung comment" : "Comment text", { exact: true }).fill("3dipl.org\nLicensed asset / Tài nguyên được cấp phép");
          await panel.getByRole("button", { name: language === "vi" ? "Lưu comment" : "Save comment", exact: true }).click();
          await panel.locator(".success").waitFor();
          assert.equal(saves, 1);
          assert.equal(settings.enabled, true);
          const input = panel.getByLabel(language === "vi" ? "Mã Ref hoặc toàn bộ comment" : "Reference code or complete comment", { exact: true });
          await input.fill("ipl1.fixture-reference");
          await panel.getByRole("button", { name: language === "vi" ? "Tra cứu" : "Look up", exact: true }).click();
          await panel.getByText("archive-fixture@example.test", { exact: false }).waitFor();
          await panel.scrollIntoViewIfNeeded();
          assert.equal(await panel.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
          await page.screenshot({ path: path.join(output, `${width}-${language}-${theme}.png`), fullPage: true });
          lookupError = true;
          await input.fill("ipl1.invalid-reference");
          await panel.getByRole("button", { name: language === "vi" ? "Tra cứu" : "Look up", exact: true }).click();
          await panel.getByRole("alert").waitFor();
          assert.equal(await panel.locator(".adminArchiveTraceResult").count(), 0);
          settings = { ...settings, keyConfigured: false };
          await page.reload({ waitUntil: "networkidle" });
          await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: /^(Chung|General)$/ }).click();
          await page.getByRole("navigation", { name: "Admin subsections", exact: true }).getByRole("button", { name: /^(Lịch sử tải|Download history|Tải file|Downloads)\b/ }).click();
          await panel.locator("summary").click();
          await panel.getByRole("checkbox").uncheck();
          await panel.getByRole("button", { name: language === "vi" ? "Lưu comment" : "Save comment", exact: true }).click();
          await panel.locator(".success").waitFor();
          assert.equal(settings.enabled, false, "An admin must be able to disable tracing after a missing key");
          assert.deepEqual(errors, []);
          console.log(`${width}-${language}-${theme}: settings, lookup, errors, key loss and layout passed`);
        } catch (error) {
          await page.screenshot({ path: path.join(output, `${width}-${language}-${theme}-failed.png`), fullPage: true }).catch(() => {});
          console.error(await page.locator(".adminArchiveComments").innerText().catch(() => "Panel not available"));
          throw error;
        } finally { await context.close(); }
      }
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
