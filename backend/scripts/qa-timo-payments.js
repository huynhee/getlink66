import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";
import QRCode from "qrcode";

// All payment/auth responses and the QR image are fixtures; no bank/Gmail APIs run.
const root = path.resolve(process.argv[2] || ".cache/timo-dist");
const output = path.resolve(process.argv[3] || ".cache/timo-ui");
const mime = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png" };
const server = http.createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = path.resolve(root, `.${name}`);
    if (!file.startsWith(`${root}${path.sep}`)) file = path.join(root, "index.html");
    const stat = await fs.stat(file).catch(() => null);
    if (!stat?.isFile()) file = path.join(root, "index.html");
    res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
    res.end(await fs.readFile(file));
  } catch { res.statusCode = 404; res.end(); }
});
await fs.mkdir(output, { recursive: true });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
const qr = await QRCode.toBuffer("3DIPL-QA-NOT-A-PAYMENT", { width: 280, margin: 2 });
const id = "000000000000000000000111";
const packageId = "000000000000000000000222";
const planId = "000000000000000000000333";
const code = "NAPFIXTURE1234567890";
try {
  const options = { headless: true };
  try { await fs.access(chromium.executablePath()); }
  catch { options.channel = "chrome"; }
  browser = await chromium.launch(options);
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    for (const theme of ["light", "dark"]) {
      for (const language of ["vi", "en"]) {
        const context = await browser.newContext({ viewport });
        let settled = false;
        let submitted = "";
        const errors = [];
        const user = () => ({ _id: "000000000000000000000444", name: "QA", email: "fixture@example.test", credit: settled ? 50 : 0, role: "user" });
        const order = () => ({ _id: id, gatewayProvider: "timo", status: settled ? "approved" : "pending", currency: "VND", amount: 10000,
          paymentCode: code, credit: 50, expiresAt: new Date(Date.now() + 1800_000).toISOString() });
        const payment = { provider: "timo", bankName: "Timo by BVBank", accountNo: "1000000000000", accountName: "TEST MERCHANT",
          amount: 10000, paymentCode: code, qrUrl: `${base}/fixture-qr.png`, expiresAt: new Date(Date.now() + 1800_000).toISOString() };
        await context.addInitScript(({ language, theme }) => {
          localStorage.setItem("language", language);
          localStorage.setItem("3dipl-theme", theme);
          globalThis.EventSource = class { addEventListener() {} removeEventListener() {} close() {} };
        }, { language, theme });
        await context.route("**/api/**", async (route) => {
          const request = route.request();
          if (request.method() === "OPTIONS") return route.fulfill({ status: 204 });
          const url = new URL(request.url());
          let data = {};
          if (url.pathname === "/api/auth/user") data = { user: user() };
          if (url.pathname === "/api/auth/csrf") data = { csrfToken: "fixture-csrf" };
          if (url.pathname === "/api/auth/google/one-tap/config") data = { enabled: false };
          if (url.pathname === "/api/settings") data = { settings: {} };
          if (url.pathname === "/api/notifications") data = { notifications: [], unreadCount: 0 };
          if (url.pathname === "/api/membership/me") data = { membership: { active: false } };
          if (url.pathname === "/api/topup/packages") data = { packages: [{ _id: packageId, name: "Credit fixture", price: 10000, credit: 50, paypalPriceCents: 100, isActive: true }], payments: { paypal: { enabled: true }, vnd: { provider: "timo", enabled: true } } };
          if (url.pathname === "/api/membership/plans") data = { plans: [{ _id: planId, code: "MONTH50", name: "Month 50", price: 10000, dailyDownloadLimit: 50, durationDays: 30, billingPeriod: "month", paypalPriceCents: 100 }], checkoutEnabled: true, payments: { paypal: { enabled: true }, vnd: { provider: "timo", enabled: true } } };
          if (url.pathname === "/api/topup" && request.method() === "POST") {
            submitted = request.postDataJSON().paymentProvider;
            data = { topup: order(), payment, status: "pending" };
          }
          if (url.pathname === `/api/payments/bank/topup/${id}`) data = { kind: "topup", order: order(), payment: settled ? null : payment };
          if (url.pathname === `/api/topup/${id}/status`) data = { topup: order(), status: order().status, userCredit: user().credit };
          return route.fulfill({ json: data });
        });
        await context.route(`${base}/fixture-qr.png`, (route) => route.fulfill({ contentType: "image/png", body: qr }));
        await context.route("https://**", (route) => route.abort());
        const page = await context.newPage();
        page.on("pageerror", (error) => errors.push(error.message));
        try {
          await page.goto(`${base}/topup?mode=credit&packageId=${packageId}`, { waitUntil: "networkidle" });
          if (language === "vi") {
            const submittedResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/topup" && response.request().method() === "POST");
            await page.getByRole("button", { name: "Nạp Credit", exact: true }).click();
            await submittedResponse;
            assert.equal(submitted, "timo");
          } else {
            await page.getByRole("button", { name: "Pay with PayPal", exact: true }).waitFor();
            assert.match(await page.locator(".topupPaymentProvider").innerText(), /PayPal/);
            await page.goto(`${base}/topup?mode=credit&packageId=${packageId}&bankKind=topup&bankOrder=${id}`, { waitUntil: "networkidle" });
          }
          await page.getByRole("dialog").waitFor();
          await page.getByRole("dialog").getByRole("heading", { name: language === "vi" ? "Thanh toán" : "Payment", exact: true }).waitFor();
          await page.getByRole("dialog").getByText(code, { exact: true }).waitFor();
          await page.waitForFunction(() => [...globalThis.document.querySelectorAll(".bankTransferQr img")].every((img) => img.complete && img.naturalWidth > 0));
          const dimensions = await page.getByRole("dialog").boundingBox();
          assert.ok(dimensions.x >= 0 && dimensions.x + dimensions.width <= viewport.width + 1);
          assert.ok(dimensions.y >= 0 && dimensions.y + dimensions.height <= viewport.height + 1);
          assert.equal(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
          const name = `${viewport.width}-${theme}-${language}`;
          await page.screenshot({ path: path.join(output, `${name}.png`) });
          await page.reload({ waitUntil: "networkidle" });
          await page.getByRole("dialog").waitFor();
          await page.getByRole("dialog").getByText(code, { exact: true }).waitFor();
          // Manual refresh must not mark an unpaid fixture as paid.
          const unpaidCheck = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/payments/bank/topup/${id}`);
          await page.getByRole("button", { name: language === "vi" ? "Kiểm tra" : "Check", exact: true }).click();
          await unpaidCheck;
          await page.waitForFunction(() => !globalThis.document.querySelector(".bankTransferDialog footer button")?.disabled);
          await page.getByRole("dialog").getByText(code, { exact: true }).waitFor();
          settled = true;
          if (language === "en") await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
          await page.getByText(language === "vi" ? "Thanh toán thành công." : "Payment confirmed.", { exact: true }).waitFor({ timeout: language === "en" ? 2000 : 6000 });
          await page.waitForFunction(() => globalThis.document.querySelector(".topupAccountStrip")?.textContent.includes("50"));
          await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          assert.equal(errors.length, 0, errors.join("\n"));
          console.log(`${name}: checkout, QR, recovery, automatic ${language === "en" ? "focus" : "poll"} confirmation and balance passed`);
        } finally { await context.close(); }
      }
    }
  }
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
