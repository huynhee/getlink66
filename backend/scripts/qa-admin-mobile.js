import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const root = path.resolve(process.argv[2] || "../frontend/dist");
const output = path.resolve(process.argv[3] || "../.cache/admin-mobile");
const audit = process.argv.includes("--audit");
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const stamp = "2026-11-13T03:00:00.000Z";
const identity = { _id: "000000000000000000000001", role: "admin", email: "fixture@example.test", name: "QA Admin", isTwoFactorEnabled: true };
const customer = { _id: "000000000000000000000002", name: "QA Mobile User", email: `${"long-address-".repeat(4)}@example.test`, credit: 1234567, role: "user", createdAt: stamp };
const long = "QA-" + "long-model-title-".repeat(6);
const packageFixture = { _id: "000000000000000000000003", name: long, price: 200000, credit: 1000, paypalPriceCents: 950, badge: "POPULAR", isActive: true, features: ["Download models and scenes", "Priority support"] };
const plan = { ...packageFixture, code: "qa-month-100", dailyDownloadLimit: 100, billingPeriod: "month", durationDays: 30, sortOrder: 0 };
const asset = { _id: "000000000000000000000004", title: long, slug: long.toLowerCase(), assetType: "model", metadataStatus: "complete", fileStatus: "ready", accessType: "member", isPublished: true, fileSize: 123456789, archiveExt: "zip", previewImages: [], metadataMissingFields: [], driveFolderName: long, createdAt: stamp };
const pagination = { page: 1, totalPages: 10, total: 100, pageSize: 10 };
const routes = {
  "/api/auth/user": { user: identity }, "/api/auth/csrf": { csrfToken: "qa-csrf" },
  "/api/settings": { settings: {} }, "/api/notifications": { notifications: [] },
  "/api/admin/users": { users: [customer], pagination },
  "/api/admin/topup-packages": { packages: [packageFixture] },
  "/api/admin/membership-plans": { plans: [plan], catalog: { prepared: true, version: 2, checkoutEnabled: true } },
  "/api/admin/vouchers": { vouchers: [{ _id: "qa-voucher", code: "MOBILE10", targetKind: "pro", description: long, discountPercent: 10, isActive: true, applicablePlanIds: [plan._id] }] },
  "/api/admin/notifications": { notifications: [{ _id: "qa-notice", title: long, body: long, displayType: "fullscreen", displayPageScope: "all", displayPages: [], createdAt: stamp }] },
  "/api/admin/articles": { articles: [{ _id: "qa-article", slug: long, title: long, language: "vi", content: long, isPublished: true, createdAt: stamp }] },
  "/api/admin/cookies": { cookies: [{ _id: "qa-cookie", label: long, status: "active", masked: "fixture-only", accountUserId: "00000000", lastTestAt: stamp, lastTestOk: true }] },
  "/api/admin/system-logs": { logs: [{ _id: "qa-log", type: "UPSTREAM_UNAVAILABLE", message: long, productId: "QA-123456789", user: customer, createdAt: stamp }] },
  "/api/admin/audit-logs": { logs: [{ _id: "qa-audit", action: "ADMIN_MARKETPLACE_METADATA_UPDATE", actor: identity, target: long, statusCode: 200, createdAt: stamp }], pagination },
  "/api/admin/getlinks": { getlinks: [{ _id: "qa-getlink", user: customer, title: long, productId: "QA123456789", priceKnown: true, modelPrice: 28, creditDeducted: 28, createdAt: stamp, sourceUrl: "https://example.test/model", resolvedSourceUrl: "https://example.test/clean-model" }], pagination },
  "/api/admin/transactions": { transactions: [{ id: "qa-transaction", rawId: "qa-transaction", kind: "credit", gatewayProvider: "timo", paymentCode: "NAP12345678901234567890", user: customer, packageName: long, amount: 200000, currency: "VND", credit: 1000, status: "approved", createdAt: stamp }], pagination },
  "/api/admin/referrals": { referrals: [{ _id: "qa-referral", referrer: customer, referredUser: customer, createdAt: stamp }] },
  "/api/admin/payments/provider": { source: "database", provider: "timo", envProvider: "sepay", timo: { configured: true } },
  "/api/admin/payments/timo": { provider: "timo", workerEnabled: true, state: { lastError: "" }, mailbox: customer.email, accountName: "QA ACCOUNT", accountNo: "0000000000000", events: [{ _id: "qa-timo-event", paymentCode: "NAP12345678901234567890", amount: 200000, state: "review", reason: "QA_REVIEW_REQUIRED", receivedAt: stamp }] },
  "/api/admin/archive-comments": { enabled: false, text: "3dipl.org", keyConfigured: true, textFileEnabled: false, textFileName: "3dipl.txt", textFileText: "3dipl.org" },
  "/api/admin/plugin/releases": { source: "database", enabled: true, publicChannel: "live-test", releases: [{ _id: "qa-release", version: "1.0.1", channel: "live-test", status: "draft", uploadExpiresAt: "2099-01-01T00:00:00Z", files: [{ name: long + ".zip", role: "desktop", bytes: 123456789, sha256: "ab".repeat(32) }], manifest: {} }], channels: [{ _id: "live-test", revision: 1 }] },
  "/api/admin/marketplace/taxonomy": { categories: [{ _id: "qa-category", key: "furniture", sourceCategoryId: "furniture", title: "Furniture", titleEn: "Furniture", isActive: true, position: 0 }], filterOptions: [{ _id: "qa-render", facet: "render", value: "corona", labelVi: "Corona", labelEn: "Corona", isActive: true, position: 0, iconKey: "corona" }], allowedFacets: ["render", "platform"], iconKeysByFacet: { render: ["corona", "vray"] } },
};
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
const results = [];
let browser;
try {
  const options = { headless: true };
  try { await fs.access(chromium.executablePath()); } catch { options.channel = "chrome"; }
  browser = await chromium.launch(options);
  for (const [width, language, theme] of [[320, "vi", "light"], [390, "en", "dark"], [768, "vi", "dark"], [1440, "en", "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 850 }, isMobile: width < 768, hasTouch: width < 768 });
    const errors = [];
    await context.addInitScript(({ language, theme }) => {
      localStorage.setItem("language", language); localStorage.setItem("3dipl-theme", theme);
      globalThis.EventSource = class { addEventListener() {} removeEventListener() {} close() {} };
    }, { language, theme });
    await context.route("**/api/**", (route) => {
      const request = route.request();
      assert.equal(request.method(), "GET", "Mobile layout tests must not mutate data");
      const pathname = new URL(request.url()).pathname;
      let data = routes[pathname] || {};
      if (/\/api\/admin\/marketplace\/(models|scenes)$/.test(pathname)) data = { models: [asset], scenes: [{ ...asset, assetType: "scene" }], assets: [asset], pagination, stats: {} };
      return route.fulfill({ json: data });
    });
    await context.route("https://**", (route) => route.abort());
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base + "/admin", { waitUntil: "networkidle" });
    const primary = page.getByRole("navigation", { name: "Admin sections", exact: true });
    const secondary = page.getByRole("navigation", { name: "Admin subsections", exact: true });
    async function capture(name) {
      await page.waitForTimeout(250);
      const dimensions = await page.evaluate(() => {
        const { document } = globalThis;
        const viewport = document.documentElement.clientWidth;
        const outside = [...document.querySelectorAll(".adminPage *")].filter((element) => {
          if (!element.checkVisibility() || element.tagName === "OPTION") return false;
          const box = element.getBoundingClientRect();
          if (box.width < 1 || (box.left >= -1 && box.right <= viewport + 1)) return false;
          for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
            if (["auto", "scroll"].includes(globalThis.getComputedStyle(parent).overflowX) && parent.getBoundingClientRect().width <= viewport) return false;
          }
          return true;
        }).slice(0, 12).map((element) => ({ tag: element.tagName, className: String(element.className), text: element.textContent.slice(0, 75), width: Math.round(element.getBoundingClientRect().width) }));
        const clipped = viewport <= 760 ? [...document.querySelectorAll(".getlinkAuditTable, .getlinkAuditUser strong, .getlinkAuditModel > span, .logUserIdentity strong")]
          .filter((element) => element.checkVisibility() && element.scrollWidth > element.clientWidth + 1)
          .map((element) => ({ text: element.textContent.slice(0, 75), style: globalThis.getComputedStyle(element).whiteSpace })) : [];
        return { viewport, page: document.documentElement.scrollWidth, outside, clipped };
      });
      results.push({ width, language, theme, name, ...dimensions });
      await page.screenshot({ path: path.join(output, `${width}-${name}.png`), fullPage: true });
      if (dimensions.page > width + 1 || dimensions.outside.length || dimensions.clipped.length) console.log(JSON.stringify(results.at(-1)));
    }
    await capture("overview");
    for (const [section, subsections] of [
      [/^(Chung|General)$/, [/^(Người dùng|Users)/, /^(Lịch sử tải|Download history)/, /^(Lịch sử nạp|Top-up history)/, /^(Giới thiệu|Referrals)/, /^(Log lỗi|Error logs)/, /^Audit/, /^(Bảo mật|Security)/]],
      [/^Website$/, [/^(Gói nạp|Top-up packages)/, /^(Voucher)/, /^(Thông báo|Notifications)/, /^(Text trang chủ|Homepage text)/, /^(Bài viết|Articles)/, /^(Bản phát hành plugin|Plugin releases)/]],
    ]) {
      await primary.getByRole("button", { name: section }).click();
      for (const sub of subsections) {
        const button = secondary.getByRole("button", { name: sub });
        if (!await button.count()) throw new Error(`Missing section: ${sub}`);
        await button.click();
        await capture((await button.innerText()).replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40));
        const label = await button.innerText();
        if (/Người dùng|Users/i.test(label)) {
          await page.locator(".adminUserTable .coinAmount").first().click();
          await page.locator('.adminUserTable input[type="number"]').fill("123");
          await capture("user-credit-editor");
        }
        if (/Lịch sử tải|Download history/i.test(label)) {
          if (width <= 760) assert.equal(await page.locator(".getlinkAuditUser strong").evaluate((element) => globalThis.getComputedStyle(element).whiteSpace), "normal");
          const links = page.locator(".getlinkAuditLinks a");
          assert.equal(await links.count(), 2);
          assert.equal(await links.nth(0).getAttribute("href"), "https://example.test/model");
          assert.equal(await links.nth(1).getAttribute("href"), "https://example.test/clean-model");
          for (const link of await links.all()) {
            await link.scrollIntoViewIfNeeded();
            const box = await link.boundingBox();
            assert.ok(await link.isVisible() && box.x >= 0 && box.x + box.width <= width + 1, "Both Getlink source links must remain visible and reachable");
          }
          await page.locator(".adminArchiveComments summary").click();
          await capture("archive-settings");
          await page.locator(".adminDownloadHistory").getByRole("button", { name: "Model & Scene", exact: true }).click();
          await page.locator(".adminDownloadHistory select").first().selectOption("scene");
          await capture("asset-downloads");
        }
        if (/Lịch sử nạp|Top-up history/i.test(label)) {
          await page.locator(".adminTimoPayments summary").click();
          await capture("timo-open");
        }
        if (/Voucher/i.test(label)) {
          await page.locator(".adminVoucherPanel .adminSubTabs").getByRole("button", { name: /^Pro/ }).click();
          await page.locator(".voucherCard").waitFor();
          await capture("voucher-pro");
        }
        if (/Gói nạp|Top-up packages/i.test(label)) {
          await page.getByRole("tablist").getByRole("button", { name: /Subscription/ }).click();
          await capture("subscription");
          await page.getByTitle(/^(Sửa Subscription|Edit Subscription plan)$/).click();
          await capture("subscription-edit");
        }
        if (/Bản phát hành plugin|Plugin releases/i.test(label)) {
          const details = page.getByRole("button", { name: /^(Chi tiết|Details) v1\.0\.1/ });
          await details.click();
          await capture("plugin-detail");
          await page.getByRole("button", { name: /^(Xóa bản nháp|Delete draft)$/ }).click();
          const dialog = await page.getByRole("dialog").boundingBox();
          assert.ok(Math.abs(dialog.x - (width - dialog.width) / 2) <= 1, "Native plugin confirmation must be centered");
          await capture("plugin-dialog");
          await page.getByRole("dialog").getByRole("button", { name: /^(Hủy|Cancel)$/ }).click();
        }
      }
    }
    await primary.getByRole("button", { name: /^Getlink$/ }).click();
    const getlinkTabs = page.locator(".threed66SettingsTabs button");
    if (!await getlinkTabs.count()) console.log("Getlink tab selector unavailable");
    for (const button of await getlinkTabs.all()) { await button.click(); await capture(`getlink-${await button.innerText()}`); }
    for (const type of ["Model", "Scene"]) {
      await primary.getByRole("button", { name: type, exact: true }).click();
      const tabs = page.locator(".marketAdminTabs button");
      for (let index = 0; index < await tabs.count(); index += 1) {
        await tabs.nth(index).click(); await capture(`${type}-${index}`);
        if (index === 1) {
          await page.locator(".marketAdminList").getByRole("button", { name: /^(Chỉnh sửa model|Chỉnh sửa scene|Edit model|Edit scene)$/ }).first().click();
          await capture(`${type}-edit`);
        }
        if (index === 4) {
          const taxonomy = page.locator(".marketTaxonomyAdmin");
          await taxonomy.getByRole("button", { name: /^(Thêm danh mục|Add category)$/ }).click();
          await capture(`${type}-taxonomy-modal`);
          await page.getByRole("dialog").getByRole("button", { name: /^(Đóng|Close)$/ }).click();
          await taxonomy.getByRole("tab", { name: "Render", exact: true }).click();
          await taxonomy.getByLabel(language === "vi" ? "Nhãn tiếng Việt" : "Vietnamese label", { exact: true }).fill("QA Renderer");
          assert.equal(await taxonomy.getByLabel(language === "vi" ? "Nhãn tiếng Việt" : "Vietnamese label", { exact: true }).inputValue(), "QA Renderer");
          await capture(`${type}-taxonomy-render`);
        }
      }
    }
    assert.deepEqual(errors, []);
    await context.close();
  }
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  const failed = results.filter((result) => result.page > result.width + 1 || result.outside.length || result.clipped.length);
  if (!audit) assert.equal(failed.length, 0, `${failed.length} Admin views overflow; see results.json`);
  console.log(`${results.length} Admin views checked; ${failed.length} overflow cases.`);
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
