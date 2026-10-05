import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const buildRoot = path.resolve(process.argv[2] || "qa-report/paypal-dist");
const evidenceRoot = path.resolve(process.argv[3] || "qa-report/paypal-ui");
const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  let file = path.resolve(buildRoot, "." + pathname);
  if (!file.startsWith(buildRoot + path.sep)) file = path.join(buildRoot, "index.html");
  let data;
  try { data = await fs.readFile(file); } catch { file = path.join(buildRoot, "index.html"); data = await fs.readFile(file); }
  res.setHeader("content-type", ({ ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif" })[path.extname(file)] || "application/octet-stream");
  res.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(evidenceRoot, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" } : {}) });
const results = [];
try {
  for (const [language, theme, width] of [["en", "light", 1440], ["vi", "dark", 1440], ["vi", "light", 390], ["en", "dark", 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: "block" });
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ contentType: "text/javascript", body: "" }));
    await context.addInitScript(({ language, theme }) => {
      localStorage.setItem("language", language);
      localStorage.setItem("3dipl-theme", theme);
      sessionStorage.clear();
    }, { language, theme });
    const packages = [
      { _id: "000000000000000000000002", name: "Credit Starter", price: 100000, salePrice: 50000, salePercent: 50, paypalPriceCents: 1234, credit: 100, features: ["100 Credit"] },
      { _id: "000000000000000000000003", name: "Credit Pending", price: 200000, credit: 200, features: ["200 Credit"] },
    ];
    const plans = [
      { _id: "000000000000000000000004", code: "TRIAL", name: "Trial", price: 0, durationDays: 7, dailyDownloadLimit: 100, features: [] },
      { _id: "000000000000000000000005", code: "SILVER", name: "Silver", price: 199000, paypalPriceCents: 599, durationDays: 30, dailyDownloadLimit: 100, features: [] },
    ];
    const state = { admin: false, paid: false, enabled: true, credit: 50 };
    const submissions = [];
    await context.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      let json = {};
      if (pathname === "/api/auth/user") json = { user: { _id: "000000000000000000000001", name: "QA Account", email: "qa@example.test", role: state.admin ? "admin" : "user", credit: state.credit, isTwoFactorEnabled: true } };
      else if (pathname === "/api/auth/csrf") json = { csrfToken: "isolated-paypal-fixture" };
      else if (pathname === "/api/account/events") return route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" });
      else if (pathname === "/api/topup/packages" || pathname === "/api/admin/topup-packages") {
        if (request.method() === "POST") submissions.push(request.postDataJSON());
        json = { packages, payments: { paypal: { enabled: state.enabled } } };
      } else if (pathname === "/api/membership/plans" || pathname === "/api/admin/membership-plans") {
        if (request.method() === "POST") submissions.push(request.postDataJSON());
        json = { plans, payments: { paypal: { enabled: state.enabled } } };
      } else if (pathname === "/api/membership/me") json = { membership: { active: false } };
      else if (pathname === "/api/settings") json = { settings: { marketplaceModelCreditPrice: 5, marketplaceSceneCreditPrice: 20 } };
      else if (pathname === "/api/topup") {
        const body = request.postDataJSON();
        submissions.push(body);
        assert.equal(body.paymentProvider, language === "en" ? "paypal" : "sepay");
        json = { status: "pending", topup: { _id: "000000000000000000000009", credit: 100, amount: language === "en" ? 12.34 : 50000, currency: language === "en" ? "USD" : "VND", status: "pending", gatewayProvider: body.paymentProvider } };
      } else if (pathname === "/api/membership/checkout") {
        const body = request.postDataJSON();
        submissions.push(body);
        assert.equal(body.paymentProvider, language === "en" ? "paypal" : "sepay");
        json = { status: "approved", order: { _id: "000000000000000000000008", status: "approved", gatewayProvider: "internal_free" }, membership: { active: true, proUntil: new Date(Date.now() + 7 * 86400000).toISOString(), dailyDownloadLimit: 100 } };
      } else if (pathname.startsWith("/api/payments/paypal/orders/")) {
        state.paid = true;
        state.credit = 150;
        json = { status: "approved", topup: { _id: "000000000000000000000009", status: "approved", credit: 100, amount: 12.34, currency: "USD", paypalOrderId: "ORDER1" }, userCredit: state.credit };
      } else if (pathname === "/api/admin/overview") json = { overview: { revenueChart: [], usdRevenueChart: [], recentTopups: [] } };
      else if (pathname === "/api/admin/dashboard") json = { dashboard: { kpis: { revenueByCurrency: { USD: { grossMinor: 1234, creditRevenueMinor: 1234, proRevenueMinor: 0, feesMinor: 50, refundedMinor: 200, netMinor: 984 } } } } };
      else if (pathname === "/api/admin/transactions") json = {
        transactions: [
          { id: "credit:000000000000000000000009", rawId: "000000000000000000000009", kind: "credit", title: "PayPal fixture", amount: 12.34, currency: "USD", credit: 100, status: "approved", gatewayProvider: "paypal", paypalCaptureId: "QA000000000000001", paypalRefundMinor: 200, paypalDisputeStatus: "WAITING_FOR_SELLER_RESPONSE", paymentReconciliationStatus: "settled", paidAt: new Date().toISOString(), user: { email: "qa@example.test" } },
          { id: "credit:000000000000000000000010", rawId: "000000000000000000000010", kind: "credit", title: "Legacy VND fixture", amount: 50000, credit: 100, status: "approved", gatewayProvider: "sepay", paidAt: new Date().toISOString(), user: { email: "qa@example.test" } },
        ],
        pagination: { page: 1, pageSize: 10, total: 2, totalPages: 1 },
      };
      await route.fulfill({ json });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const l = (vi, en) => language === "vi" ? vi : en;
    const checkLayout = async (label) => {
      assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth + 1), `${label}: horizontal overflow`);
      await page.screenshot({ path: path.join(evidenceRoot, `${language}-${theme}-${width}-${label}.png`), fullPage: true });
    };
    await page.goto(origin + "/topup?mode=credit&packageId=" + packages[0]._id);
    await page.locator(".topupPackageFinalPrice").first().waitFor();
    assert.match(await page.locator(".topupPackageFinalPrice").first().innerText(), language === "en" ? /US\$12\.34/ : /50[.,]000/);
    await checkLayout("credit");
    await page.getByRole("button", { name: l("Nạp Credit", "Pay with PayPal"), exact: true }).click();
    await page.waitForFunction(() => globalThis.document.querySelector(".result"));
    assert.equal(submissions.at(-1).paymentProvider, language === "en" ? "paypal" : "sepay");
    if (language === "en") {
      await page.goto(origin + "/topup?mode=credit&packageId=" + packages[1]._id);
      await page.getByText("USD price is not available for this package yet.").waitFor();
      assert.equal(await page.getByRole("button", { name: "Pay with PayPal", exact: true }).isDisabled(), true);
    }
    await page.goto(origin + "/topup?mode=pro&planId=" + plans[1]._id);
    await page.locator(".topupMembershipPlans").waitFor();
    await checkLayout("pro");
    state.enabled = false;
    await page.goto(origin + "/topup?mode=pro&planId=" + plans[0]._id);
    await page.getByRole("button", { name: l("Mua Pro", "Buy Pro"), exact: true }).click();
    await page.getByText(l("Đã kích hoạt gói Pro miễn phí.", "Free Pro plan activated."), { exact: true }).waitFor();
    state.enabled = true;
    await page.goto(origin + "/topup?mode=credit&payment=paypal_return&orderKind=topup&orderId=000000000000000000000009");
    await page.getByText(l("Thanh toán thành công. Tài khoản đã được cập nhật.", "Payment successful. Your account has been updated."), { exact: true }).waitFor();
    assert.equal(state.paid, true);
    assert.equal(new URL(page.url()).searchParams.has("payment"), false);
    await checkLayout("confirmed");
    await page.goto(origin + "/");
    await page.locator(".homeProPricingGrid").waitFor();
    await checkLayout("home");
    state.admin = true;
    await page.goto(origin + "/admin");
    await page.getByRole("button", { name: "Website", exact: true }).click();
    await page.getByRole("button", { name: l("Gói nạp", "Top-up packages"), exact: false }).last().click();
    await page.getByLabel(l("Giá PayPal (USD)", "PayPal price (USD)")).waitFor();
    await page.getByLabel(l("Giá PayPal (USD)", "PayPal price (USD)")).fill("15.25");
    const form = page.locator("form").filter({ has: page.getByLabel(l("Giá PayPal (USD)", "PayPal price (USD)")) });
    await form.locator("input").nth(0).fill("QA USD package");
    await form.locator("input").nth(1).fill("100000");
    await form.locator("input").nth(2).fill("100");
    await checkLayout("admin");
    await form.getByRole("button", { name: l("Thêm gói", "Add package"), exact: true }).click();
    await page.waitForFunction(() => globalThis.document.querySelector('input[placeholder="Credit"]')?.value === "");
    assert.equal(submissions.at(-1).paypalPriceCents, 1525);
    assert.equal(Object.hasOwn(submissions.at(-1), "paypalPriceUsd"), false);
    await page.getByRole("button", { name: "Pro", exact: true }).click();
    const proForm = page.locator("form").filter({ has: page.getByLabel(l("Giá PayPal (USD)", "PayPal price (USD)")) });
    await proForm.locator("input").nth(0).fill("QA_WEEK");
    await proForm.locator("input").nth(1).fill("QA Pro");
    await proForm.locator("input").nth(2).fill("49000");
    await proForm.getByLabel(l("Giá PayPal (USD)", "PayPal price (USD)")).fill("2.50");
    await proForm.getByPlaceholder(l("Số ngày hiệu lực", "Duration days"), { exact: true }).fill("7");
    await proForm.getByRole("button", { name: l("Thêm gói Pro", "Add Pro plan"), exact: true }).click();
    await page.getByLabel(l("Giá PayPal (USD)", "PayPal price (USD)")).filter({ visible: true }).waitFor();
    await page.waitForFunction(() => globalThis.document.querySelector('input[placeholder="Duration days"], input[placeholder="Số ngày hiệu lực"]')?.value === "");
    assert.equal(submissions.at(-1).paypalPriceCents, 250);
    await page.getByRole("button", { name: l("Chung", "General"), exact: true }).click();
    await page.getByRole("button", { name: l("Lịch sử nạp", "Top-up history"), exact: false }).click();
    await page.locator(".topupAuditAmount").first().waitFor();
    assert.match(await page.locator(".topupAuditAmount").first().innerText(), /US\$12[.,]34/);
    assert.match(await page.locator(".topupAuditAmount").nth(1).innerText(), /50\.000đ/);
    assert.ok(await page.locator(".topupAuditPaypalDetails").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), "PayPal reconciliation details must not be clipped");
    await checkLayout("transactions");
    assert.deepEqual(errors, [], "Uncaught browser exceptions");
    results.push({ language, theme, width, passed: true, submissions: submissions.length });
    await context.close();
  }
  await fs.writeFile(path.join(evidenceRoot, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
