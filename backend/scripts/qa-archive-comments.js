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
        let settings = { enabled: false, text: "3dipl.org", keyConfigured: true,
          textFileEnabled: false, textFileName: "3dipl.txt", textFileText: "3dipl.org" };
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
          const toggle = panel.locator('input[name="archiveCommentEnabled"]');
          const extraToggle = panel.locator('input[name="archiveTextFileEnabled"]');
          const filename = panel.getByLabel(language === "vi" ? "Tên file TXT" : "TXT filename", { exact: true });
          const textFile = panel.getByLabel(language === "vi" ? "Nội dung TXT" : "TXT content", { exact: true });
          const comment = panel.getByLabel(language === "vi" ? "Nội dung comment" : "Comment text", { exact: true });
          const save = panel.getByRole("button", { name: language === "vi" ? "Lưu cài đặt" : "Save settings", exact: true });
          assert.equal(await extraToggle.isChecked(), false);
          assert.equal(await filename.inputValue(), "3dipl.txt");
          assert.equal(await textFile.inputValue(), "3dipl.org");
          assert.equal(await panel.locator(".adminArchiveExtraPreview").count(), 0);
          await toggle.check();
          await extraToggle.check();
          await textFile.fill("\u{1f642}".repeat(1025));
          assert.equal(await save.isDisabled(), true, "TXT limit must count UTF-8 bytes, not characters");
          await textFile.fill("3dipl.org\nLicensed asset / Tài nguyên được cấp phép");
          await comment.fill("\u{1f642}".repeat(1025));
          assert.equal(await save.isDisabled(), true, "Comment limit must still count UTF-8 bytes");
          await comment.fill("3dipl.org\nWeb Model/Scene");
          await filename.fill("3dipl-notice.txt");
          const preview = panel.locator(".adminArchiveExtraPreview");
          assert.match(await preview.innerText(), /3dipl-notice-\[random\]\.txt/);
          assert.match(await preview.innerText(), /3dipl-notice-\[random\]\.url/);
          assert.equal(await preview.locator('[data-preview="txt"]').innerText(), `${await textFile.inputValue()}\n\nipl1.[${language === "vi" ? "mã truy vết mã hóa" : "encrypted session trace"}]`);
          assert.equal(await preview.locator('[data-preview="url"]').innerText(), "[InternetShortcut]\nURL=https://3dipl.org/");
          await save.click();
          await panel.locator(".success").waitFor();
          assert.equal(saves, 1);
          assert.equal(settings.enabled, true);
          assert.equal(settings.textFileEnabled, true);
          assert.equal(settings.textFileName, "3dipl-notice.txt");
          assert.equal(settings.textFileText, "3dipl.org\nLicensed asset / Tài nguyên được cấp phép");
          await page.reload({ waitUntil: "networkidle" });
          await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: /^(Chung|General)$/ }).click();
          await page.getByRole("navigation", { name: "Admin subsections", exact: true }).getByRole("button", { name: /^(Lịch sử tải|Download history|Tải file|Downloads)\b/ }).click();
          await panel.locator("summary").press("Enter");
          assert.equal(await toggle.isChecked(), true);
          assert.equal(await extraToggle.isChecked(), true);
          assert.equal(await filename.inputValue(), settings.textFileName);
          assert.equal(await textFile.inputValue(), settings.textFileText);
          assert.equal(await comment.inputValue(), settings.text);
          const input = panel.getByLabel(language === "vi" ? "Mã Ref hoặc toàn bộ comment" : "Reference code or complete comment", { exact: true });
          await input.fill("ipl1.fixture-reference");
          await panel.getByRole("button", { name: language === "vi" ? "Tra cứu" : "Look up", exact: true }).click();
          await panel.getByText("archive-fixture@example.test", { exact: false }).waitFor();
          await panel.scrollIntoViewIfNeeded();
          assert.equal(await panel.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
          assert.equal(await page.locator("html").evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
          await page.locator("html").evaluate((element) => { element.scrollTop = 0; });
          await page.screenshot({ path: path.join(output, `${width}-${language}-${theme}.png`), fullPage: true });
          await panel.screenshot({ path: path.join(output, `${width}-${language}-${theme}-panel.png`), style: ".topbar { visibility: hidden; }" });
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
          await toggle.uncheck();
          await save.click();
          await panel.locator(".success").waitFor();
          assert.equal(settings.enabled, false, "An admin must be able to disable tracing after a missing key");
          assert.equal(settings.textFileEnabled, true, "Disabling marking must retain the TXT/URL preference");
          assert.equal(settings.textFileName, "3dipl-notice.txt");
          assert.equal(settings.textFileText, "3dipl.org\nLicensed asset / Tài nguyên được cấp phép");
          assert.equal(await toggle.isDisabled(), true);
          assert.deepEqual(errors, []);
          console.log(`${width}-${language}-${theme}: TXT/URL roundtrip, previews, byte limits, lookup, key loss and layout passed`);
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
