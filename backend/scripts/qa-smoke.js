import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const backendPort = Number(process.env.QA_BACKEND_PORT || 5511);
const frontendPort = Number(process.env.QA_FRONTEND_PORT || 5512);
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const buildRoot = path.resolve(process.argv[2] || "../qa-report/test-results/release-dist");
const screenshotRoot = path.resolve(process.argv[3] || "../qa-report/screenshots");
const resultPath = path.resolve(process.argv[4] || "../qa-report/performance-results/smoke.json");
const routeSet = ["/", "/models", "/scenes", "/plugin", "/guide", "/privacy", "/terms"];
const systemBrowsers = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function browserLaunchOptions() {
  const bundled = chromium.executablePath();
  if (bundled && fs.existsSync(bundled)) return { headless: true };
  const executablePath = systemBrowsers.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error("No Playwright Chromium or supported system browser is installed.");
  }
  return { headless: true, executablePath };
}

function isExpectedClientAbort(request) {
  const errorText = String(request.failure()?.errorText || "");
  return !request.isNavigationRequest()
    && errorText.includes("net::ERR_ABORTED");
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  }[extension] || "application/octet-stream";
}

function proxyApi(req, res) {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: backendPort,
    method: req.method,
    path: req.url,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${backendPort}`,
      "x-forwarded-host": `127.0.0.1:${frontendPort}`,
      "x-forwarded-proto": "http",
    },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", (error) => {
    if (res.destroyed) return;
    if (res.headersSent || res.writableEnded) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: error.message }));
  });
  res.once("close", () => upstream.destroy());
  req.pipe(upstream);
}

function staticServer() {
  return http.createServer((req, res) => {
    if (String(req.url || "").startsWith("/api/")) {
      proxyApi(req, res);
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url || "/", frontendOrigin).pathname);
    const requested = path.resolve(buildRoot, `.${pathname}`);
    const insideBuild = requested === buildRoot || requested.startsWith(`${buildRoot}${path.sep}`);
    let file = insideBuild && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(buildRoot, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end("Missing frontend build");
      return;
    }
    res.writeHead(200, {
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
      "content-type": contentType(file),
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function verifyLiveAccountBalance(page, context) {
  const before = await (await context.request.get(`${frontendOrigin}/api/auth/user`)).json();
  const fixture = { id: "qa-completed-job", status: "completed", title: "QA completed job", result: { credit: 1 } };
  await page.route("**/api/getlink/jobs/latest", (route) => route.fulfill({ json: { job: fixture } }));
  const stream = page.waitForResponse((response) => response.url().endsWith("/api/account/events") && response.status() === 200);
  await page.goto(`${frontendOrigin}/getlink`, { waitUntil: "domcontentloaded" });
  await stream;
  const balanceIs = (expected) => Number(globalThis.document.querySelector(".accountCreditPill .coinAmount")?.textContent?.trim()) === expected;
  await page.waitForFunction(balanceIs, Number(before.user.credit), { timeout: 5_000 });

  // Use a separate HTTP client: no component callback can fake the SSE update.
  const csrf = await (await context.request.get(`${frontendOrigin}/api/auth/csrf`)).json();
  const response = await context.request.post(`${frontendOrigin}/api/admin/add-credit`, {
    headers: { "x-csrf-token": csrf.csrfToken, origin: frontendOrigin },
    data: { userId: before.user._id, credit: 37 },
  });
  if (!response.ok()) throw new Error(`QA credit grant failed: ${response.status()} ${await response.text()}`);
  const expected = Number(before.user.credit) + 37;
  await page.waitForFunction(balanceIs, expected, { timeout: 4_000 });
  // A persisted completed job must not replay its historical balance on remount.
  await page.goto(`${frontendOrigin}/getlink`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(balanceIs, expected, { timeout: 5_000 });
  await page.waitForTimeout(300);
  if (!await page.evaluate(balanceIs, expected)) throw new Error("Completed Getlink job overwrote the live balance");
  await page.unroute("**/api/getlink/jobs/latest");
}

async function waitForBackend(timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendOrigin}/ready`);
      if (response.ok) return response.json();
    } catch {
      // Startup has not completed yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Backend readiness timeout");
}

async function backendMemory(child, collectGarbage = true) {
  const requestId = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error("Backend memory diagnostic timed out"));
    }, 5_000);
    function onMessage(message) {
      if (message?.type !== "qa:memory" || message.requestId !== requestId) return;
      clearTimeout(timeout);
      child.off("message", onMessage);
      resolve(message.memory);
    }
    child.on("message", onMessage);
    child.send({ type: "qa:memory", requestId, collectGarbage });
  });
}

async function catalogLoad({ total = 300, concurrency = 20 } = {}) {
  const durations = [];
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= total) return;
      const startedAt = performance.now();
      const response = await fetch(
        `${backendOrigin}/api/marketplace/models?page=1&limit=60&sort=newest`,
      );
      if (!response.ok) {
        throw new Error(`Catalog load request returned HTTP ${response.status}`);
      }
      await response.arrayBuffer();
      durations.push(performance.now() - startedAt);
    }
  });
  await Promise.all(workers);
  durations.sort((left, right) => left - right);
  const percentile = (value) => durations[Math.min(
    durations.length - 1,
    Math.floor(durations.length * value),
  )];
  return {
    total,
    concurrency,
    medianMs: Math.round(percentile(0.5) * 100) / 100,
    p95Ms: Math.round(percentile(0.95) * 100) / 100,
    maximumMs: Math.round(durations.at(-1) * 100) / 100,
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function verifyLanguageFlags(page, viewport, accountType) {
  const button = page.locator(".languageToggleSingle button");
  const openMenu = async () => {
    if (!await button.isVisible()) await page.locator(".mobileMenuButton").click();
  };
  const initialLanguage = await page.locator("html").getAttribute("lang");
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  const checkFlag = (language) => page.waitForFunction((expected) => {
    const toggle = globalThis.document.querySelector(".languageToggleSingle button");
    const flag = toggle?.querySelector("img");
    if (!flag?.complete || flag.naturalWidth === 0) return false;
    const icon = flag.getBoundingClientRect();
    const control = toggle.getBoundingClientRect();
    const account = toggle.closest(".account");
    return globalThis.document.documentElement.lang === expected
      && flag.getAttribute("src") === (expected === "vi" ? "/icons/flags/vn.svg" : "/icons/flags/gb.svg?v=2")
      && toggle.textContent.trim() === ""
      && Boolean(toggle.getAttribute("aria-label"))
      && Boolean(toggle.getAttribute("title"))
      && account.scrollWidth <= account.clientWidth + 1
      && icon.width === 24 && icon.height === 16
      && Math.abs(flag.naturalWidth / flag.naturalHeight - 1.5) < 0.01
      && icon.left >= control.left && icon.right <= control.right
      && icon.top >= control.top && icon.bottom <= control.bottom;
  }, language);

  await openMenu();
  for (const theme of ["light", "dark"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) {
      await page.locator(".themeToggle").click();
    }
    for (const language of ["vi", "en"]) {
      if (await page.locator("html").getAttribute("lang") !== language) await button.click();
      await checkFlag(language);
      await page.locator(viewport === "mobile" ? ".account" : ".topbar").screenshot({
        path: path.join(screenshotRoot, `${viewport}-${accountType}-${theme}-${language}-flag.png`),
      });
    }
  }
  if (accountType === "guest") {
    const account = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/user");
    await page.reload({ waitUntil: "domcontentloaded" });
    await account;
    await openMenu();
  }
  await checkFlag("en");
  await button.focus();
  await button.press("Enter");
  await checkFlag("vi");
  if (initialLanguage === "en") await button.click();
  if (await page.locator("html").getAttribute("data-theme") !== initialTheme) {
    await page.locator(".themeToggle").click();
  }
}

async function verifyAdminPackageDeletion(page, context, viewport) {
  const pattern = /\/api\/admin\/(topup-packages|membership-plans)(?:\/[^/?]+)?$/;
  let packages = [], plans = [], deletes = 0, failDelete = false, failToggle = false, releaseDelete;
  const catalog = { version: 1, mode: "unified", prepared: true, checkoutEnabled: true };
  const handler = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const credit = pathname.includes("topup-packages");
    if (request.method() === "GET") {
      return route.fulfill({ json: credit ? { packages } : { plans, catalog } });
    }
    if (!credit && request.method() === "PUT") {
      if (failToggle) return route.fulfill({ status: 409, json: { message: "QA toggle refused; retry is safe." } });
      const id = pathname.split("/").at(-1);
      plans = plans.map((plan) => plan._id === id ? { ...plan, isActive: request.postDataJSON().isActive } : plan);
      return route.fulfill({ json: { plan: plans.find((plan) => plan._id === id) } });
    }
    if (request.method() !== "DELETE") return route.fallback();
    deletes++;
    await new Promise((resolve) => { releaseDelete = resolve; });
    if (failDelete) return route.fulfill({ status: 409, json: { message: "QA deletion refused; retry is safe." } });
    const id = pathname.split("/").at(-1);
    if (credit) packages = packages.filter((item) => item._id !== id);
    else plans = plans.filter((item) => item._id !== id);
    return route.fulfill({ json: { ok: true, archived: true, catalog } });
  };
  const initialLanguage = await page.locator("html").getAttribute("lang");
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  await context.route(pattern, handler);
  // Repeated catalog reloads do not need SSE; live account events are tested separately.
  const eventsPattern = "**/api/account/events";
  const stopEvents = (route) => route.fulfill({ status: 204, body: "" });
  await context.route(eventsPattern, stopEvents);
  const panel = page.locator(".panel").filter({ has: page.getByRole("heading", { name: /Quản lý gói nạp|Manage top-up packages/ }) });
  const finishDelete = async () => {
    const deadline = Date.now() + 5000;
    while (!releaseDelete) {
      if (Date.now() > deadline) throw new Error("Package DELETE request was not sent");
      await new Promise((resolve) => setImmediate(resolve));
    }
    releaseDelete();
  };
  const openCatalog = async () => {
    const responses = ["topup-packages", "membership-plans"].map((endpoint) => page.waitForResponse(
      (response) => new URL(response.url()).pathname === `/api/admin/${endpoint}`,
    ));
    await page.goto(`${frontendOrigin}/admin`, { waitUntil: "domcontentloaded" });
    await Promise.all(responses);
    await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: "Website", exact: true }).click();
    await panel.waitFor();
  };
  try {
    for (const theme of ["light", "dark"]) {
      for (const language of ["vi", "en"]) {
        packages = [1, 2].map((id) => ({ _id: String(id).padStart(24, "a"), name: `QA Credit ${id}`, price: 10000, credit: 28, badge: "QA", features: ["QA benefit"] }));
        plans = [3, 4].map((id) => ({ _id: String(id).padStart(24, "b"), code: `QA_PLAN_${id}`, name: `QA Subscription ${id}`, price: 10000, isActive: false, catalogVersion: id === 3 ? 1 : 2, billingPeriod: "month", durationDays: 30, dailyDownloadLimit: 50 }));
        await openCatalog();
        if (!await page.locator(".languageToggleSingle button").isVisible()) await page.locator(".mobileMenuButton").click();
        if (await page.locator("html").getAttribute("lang") !== language) await page.locator(".languageToggleSingle button").click();
        if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator(".themeToggle").click();
        if (await page.locator(".mobileMenuButton").getAttribute("aria-expanded") === "true") await page.locator(".mobileMenuButton").click();
        for (const kind of ["credit", "pro"]) {
          await panel.locator(".adminSubTabs").first().getByRole("button", { name: kind === "credit" ? "Credit" : "Subscription", exact: true }).click();
          const cards = panel.locator(".packageGrid .package");
          await cards.first().waitFor();
          if (await cards.count() !== 2) throw new Error("Admin package fixtures did not load");
          if (kind === "pro") {
            if (await panel.getByRole("button", { name: /Áp dụng bộ|Apply Subscription catalog/ }).count()) throw new Error("Admin still gates plan availability behind catalog activation");
            for (let index = 0; index < 2; index++) {
              const card = cards.nth(index);
              const toggle = card.getByRole("checkbox", { name: /Bật bán|Enable sales for/ });
              await toggle.click();
              await panel.getByRole("status").waitFor();
              if (!await toggle.isChecked()) throw new Error("Plan did not enable");
              await card.screenshot({ path: path.join(screenshotRoot, `${viewport}-admin-plan-enabled-${index}-${theme}-${language}.png`) });
              failToggle = true;
              await toggle.click();
              await panel.getByRole("alert").waitFor();
              if (!await toggle.isChecked()) throw new Error("Rejected toggle changed plan availability");
              failToggle = false;
              await toggle.click();
              await panel.getByRole("status").waitFor();
              if (await toggle.isChecked()) throw new Error("Plan did not disable on retry");
            }
          }
          const remove = () => cards.first().getByRole("button", { name: /^(Xóa|Delete)/ });
          if (await remove().count() !== 1) throw new Error("Admin package has duplicate delete controls");
          if (!await cards.first().evaluate((card) => {
            const toolbar = card.querySelector(".packageActions");
            const content = toolbar.nextElementSibling;
            return toolbar.getBoundingClientRect().bottom <= content.getBoundingClientRect().top;
          })) throw new Error("Package controls overlap its content");
          const before = deletes;
          page.once("dialog", (dialog) => dialog.dismiss());
          await remove().click();
          if (deletes !== before || await cards.count() !== 2) throw new Error("Cancelled package deletion changed the catalog");
          page.once("dialog", (dialog) => dialog.accept());
          failDelete = false;
          releaseDelete = null;
          await remove().click();
          await page.waitForFunction(() => globalThis.document.querySelector(".packageActions .spin"));
          if (await remove().isEnabled()) throw new Error("Delete button stays enabled during deletion");
          await finishDelete();
          await panel.getByRole("status").waitFor();
          if (await cards.count() !== 1 || deletes !== before + 1) throw new Error("Deletion did not immediately remove exactly one package");
          page.once("dialog", (dialog) => dialog.accept());
          failDelete = true;
          releaseDelete = null;
          await remove().click();
          await finishDelete();
          await panel.getByRole("alert").waitFor();
          if (await cards.count() !== 1 || !await remove().isEnabled()) throw new Error("Failed deletion removed the package or blocked retry");
          await cards.first().screenshot({ path: path.join(screenshotRoot, `${viewport}-admin-delete-${kind}-${theme}-${language}.png`) });
          page.once("dialog", (dialog) => dialog.accept());
          failDelete = false;
          releaseDelete = null;
          await remove().click();
          await finishDelete();
          await panel.getByRole("status").waitFor();
          if (await cards.count() !== 0) throw new Error("Retry did not delete the package");
        }
        await openCatalog();
        if (await panel.locator(".packageGrid .package").count()) throw new Error("Deleted packages returned after reload");
      }
    }
  } finally {
    if (releaseDelete) releaseDelete();
    await context.unroute(pattern, handler);
    await context.unroute(eventsPattern, stopEvents);
    if (!await page.locator(".languageToggleSingle button").isVisible()) await page.locator(".mobileMenuButton").click();
    if (await page.locator("html").getAttribute("lang") !== initialLanguage) await page.locator(".languageToggleSingle button").click();
    if (await page.locator("html").getAttribute("data-theme") !== initialTheme) await page.locator(".themeToggle").click();
  }
}

async function verifyAdminVoucherPlanScopes(page, context, viewport) {
  const initialLanguage = await page.locator("html").getAttribute("lang");
  const initialTheme = await page.locator("html").getAttribute("data-theme");
  const csrf = await context.request.get(`${frontendOrigin}/api/auth/csrf`).then((response) => response.json());
  const plans = [];
  for (const billingPeriod of ["day", "month"]) {
    const response = await context.request.post(`${frontendOrigin}/api/admin/membership-plans`, {
      headers: { "x-csrf-token": csrf.csrfToken, origin: frontendOrigin },
      data: { code: `QA_SCOPE_${viewport}_${billingPeriod}`.toUpperCase(), name: `QA ${billingPeriod} ${viewport}`,
        billingPeriod, price: 10000, durationDays: billingPeriod === "day" ? 1 : 30,
        dailyDownloadLimit: billingPeriod === "day" ? 100 : 50, isActive: false },
    });
    if (!response.ok()) throw new Error(`Voucher plan fixture failed: ${await response.text()}`);
    plans.push((await response.json()).plan);
  }
  const eventsPattern = "**/api/account/events";
  const stopEvents = (route) => route.fulfill({ status: 204, body: "" });
  await context.route(eventsPattern, stopEvents);
  const setPresentation = async (language, theme) => {
    if (!await page.locator(".languageToggleSingle button").isVisible()) await page.locator(".mobileMenuButton").click();
    if (await page.locator("html").getAttribute("lang") !== language) await page.locator(".languageToggleSingle button").click();
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator(".themeToggle").click();
    if (await page.locator(".mobileMenuButton").getAttribute("aria-expanded") === "true") await page.locator(".mobileMenuButton").click();
  };
  try {
    for (const language of ["vi", "en"]) {
      for (const theme of ["light", "dark"]) {
        await page.goto(`${frontendOrigin}/admin`, { waitUntil: "domcontentloaded" });
        await page.getByRole("navigation", { name: "Admin sections", exact: true }).getByRole("button", { name: "Website", exact: true }).click();
        await setPresentation(language, theme);
        await page.getByRole("navigation", { name: "Admin subsections", exact: true }).getByRole("button", { name: /^Vouchers?\b/ }).click();
        const panel = page.locator(".adminVoucherPanel");
        await panel.getByRole("tablist").getByRole("button", { name: /^Pro\b/ }).click();
        const form = panel.locator(".voucherEditor");
        const picker = form.locator(".voucherPackagePicker");
        const first = picker.getByRole("checkbox", { name: plans[0].name, exact: true });
        const second = picker.getByRole("checkbox", { name: plans[1].name, exact: true });
        await first.waitFor();
        if (!await picker.innerText().then((text) => text.includes(language === "vi" ? "Tất cả Subscription" : "All Subscription plans"))) throw new Error("Empty voucher scope does not mean all plans");
        await first.check();
        const code = `SCOPE_${viewport}_${theme}_${language}`.toUpperCase();
        await form.getByLabel(/Mã voucher|Voucher code/).fill(code);
        await form.getByLabel(/Giảm giá|Discount/).fill("10");
        await form.getByLabel(/Tổng lượt dùng|Total uses/).fill("10");
        await form.getByLabel(/Hết hạn|Expires at/).fill("2035-01-01T23:59");
        if (await form.evaluate((element) => element.scrollWidth > element.clientWidth + 2)) throw new Error("Voucher plan picker overflows");
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-voucher-plan-picker-${theme}-${language}.png`), fullPage: true });
        const created = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/voucher" && response.request().method() === "POST");
        await form.getByRole("button", { name: /^(Tạo voucher|Create voucher)$/ }).click();
        const response = await created;
        if (!response.ok()) throw new Error(`Voucher creation failed: ${await response.text()}`);
        const voucher = (await response.json()).voucher;
        if (String(voucher.applicablePlanIds[0]?._id || voucher.applicablePlanIds[0]) !== String(plans[0]._id) || voucher.applicablePlanIds.length !== 1) throw new Error("Selected voucher plan was not saved");
        const card = panel.locator(".voucherCard").filter({ hasText: code });
        await card.locator(".voucherApplies strong").filter({ hasText: plans[0].name }).waitFor();
        await card.getByRole("button", { name: /^(Sửa voucher|Edit voucher)$/ }).click();
        if (!await first.isChecked() || await second.isChecked()) throw new Error("Editing voucher lost its selected plans");
        await first.uncheck();
        await second.check();
        const updated = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === `/api/admin/vouchers/${voucher._id}` && candidate.request().method() === "PUT");
        await form.getByRole("button", { name: /^(Lưu chỉnh sửa|Save changes)$/ }).click();
        const edited = await updated;
        if (!edited.ok()) throw new Error(`Voucher editing failed: ${await edited.text()}`);
        await card.locator(".voucherApplies strong").filter({ hasText: plans[1].name }).waitFor();
        await card.getByRole("button", { name: /^(Sửa voucher|Edit voucher)$/ }).click();
        if (await first.isChecked() || !await second.isChecked()) throw new Error("Updated voucher selection was not restored");
      }
    }
  } finally {
    await context.unroute(eventsPattern, stopEvents);
    await setPresentation(initialLanguage, initialTheme);
  }
}

async function verifyConfiguredCreditCopy(page, context, viewport) {
  let scenePrice = 20;
  const pattern = "**/api/settings";
  const handler = async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: {
      ...body,
      settings: { ...body.settings, marketplaceModelCreditPrice: 7, marketplaceSceneCreditPrice: scenePrice },
    } });
  };
  await context.route(pattern, handler);
  const detailPattern = "**/api/marketplace/scenes/qa-price-scene?*";
  const detailHandler = (route) => route.fulfill({ json: {
    scene: {
      _id: "000000000000000000000123", slug: "qa-price-scene", title: "QA Scene",
      assetType: "scene", accessType: "member", fileStatus: "ready", isPublished: true,
      previewImages: [], coverImage: {}, styles: [], renderers: [], platforms: [],
    },
  } });
  await context.route(detailPattern, detailHandler);
  try {
    await page.goto(`${frontendOrigin}/topup?mode=credit`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.document.body.innerText.includes("Scene 20 Credit"));
    await page.waitForFunction(() => globalThis.document.body.innerText.includes("Model 7 Credit"));
    scenePrice = 18;
    await page.evaluate(() => globalThis.dispatchEvent(new globalThis.Event("focus")));
    await page.waitForFunction(() => globalThis.document.body.innerText.includes("Scene 18 Credit"));
    await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-credit-prices.png`), fullPage: true });
    await page.goto(`${frontendOrigin}/scenes/qa-price-scene`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const text = globalThis.document.body.innerText;
      return text.includes("5 lượt hằng ngày hoặc 18 Credit") || text.includes("5 daily downloads or 18 Credits");
    });
    await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-scene-price.png`), fullPage: true });
  } finally {
    await context.unroute(pattern, handler);
    await context.unroute(detailPattern, detailHandler);
  }
}

async function verifySubscriptionCatalog(page, context, viewport) {
  const plans = ["day", "month", "year"].flatMap((billingPeriod, index) => [20, 50, 100].map((quota, quotaIndex) => ({
    _id: String(index * 3 + quotaIndex + 1).padStart(24, "0"), code: `QA_${billingPeriod}_${quota}`,
    name: `${billingPeriod} ${quota}`, billingPeriod, dailyDownloadLimit: quota,
    durationDays: { day: 1, month: 30, year: 365 }[billingPeriod], catalogVersion: quota === 20 ? 1 : 2,
    price: 10000 * quota, paypalPriceCents: quota * 10, isActive: true, features: [],
  })));
  plans[5].paypalPriceCents = null;
  plans[0].price = 0;
  const now = Date.now();
  const current = { id: "qa-current", planName: "Month 20", billingPeriod: "month", dailyDownloadLimit: 20,
    startsAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 86400000).toISOString() };
  const upcoming = { id: "qa-next", planName: "Year 100", billingPeriod: "year", dailyDownloadLimit: 100,
    startsAt: current.endsAt, endsAt: new Date(now + 366 * 86400000).toISOString() };
  let checkoutEnabled = true;
  const plansPattern = "**/api/membership/plans";
  const plansHandler = async (route) => {
    // Keep catalog initialization asynchronous even on fast local machines.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({ json: { plans, checkoutEnabled, payments: { paypal: { enabled: true } } } });
  };
  const mePattern = "**/api/membership/me";
  const meHandler = (route) => route.fulfill({ json: { membership: { active: true, tier: "pro", dailyDownloadLimit: 20,
    proUntil: upcoming.endsAt, currentPeriod: current, upcomingPeriods: [upcoming] } } });
  const packagesPattern = "**/api/topup/packages";
  const packages = [100, 300, 600, 1200, 2500].map((credit, index) => ({
    _id: String(index + 21).padStart(24, "0"), name: `Credit ${credit}`, credit,
    price: credit * 1000, paypalPriceCents: credit, features: ["QA Credit benefit"],
  }));
  const packagesHandler = (route) => route.fulfill({ json: { packages, payments: { paypal: { enabled: true } } } });
  const voucherPattern = "**/api/voucher/apply";
  const voucherHandler = (route) => {
    const body = route.request().postDataJSON();
    const membership = body.target === "membership";
    if (membership && body.planId !== plans[3]._id) throw new Error("Voucher preview did not send the selected Subscription plan");
    return route.fulfill({ json: { voucher: {
      code: "QA10", targetKind: membership ? "pro" : "credit", discountPercent: 10, creditBonus: membership ? 0 : 30,
      appliesToMembership: membership, applicablePackageIds: [], applicablePlanIds: membership ? [plans[3]._id] : [],
    } } });
  };
  const checkoutRequests = [];
  const checkoutHandler = (route) => {
    checkoutRequests.push({ path: new URL(route.request().url()).pathname, ...route.request().postDataJSON() });
    return route.fulfill({ status: 400, json: { message: "QA checkout stopped before payment" } });
  };
  await context.route(voucherPattern, voucherHandler);
  await context.route("**/api/membership/checkout", checkoutHandler);
  await context.route("**/api/topup", checkoutHandler);
  await context.route(plansPattern, plansHandler);
  await context.route(mePattern, meHandler);
  await context.route(packagesPattern, packagesHandler);
  const eventsPattern = "**/api/account/events";
  const eventsHandler = (route) => route.fulfill({ contentType: "text/event-stream", body: ": Subscription UI fixture\n\n" });
  await context.route(eventsPattern, eventsHandler);
  const setPresentation = async (language, theme) => {
    const button = page.locator(".languageToggleSingle button");
    await button.waitFor({ state: "attached" });
    const needsChange = await page.locator("html").getAttribute("lang") !== language
      || await page.locator("html").getAttribute("data-theme") !== theme;
    if (!needsChange) return;
    if (viewport === "mobile" && !await button.isVisible()) await page.locator(".mobileMenuButton").click();
    await button.waitFor({ state: "visible" });
    if (await page.locator("html").getAttribute("lang") !== language) await button.click();
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.locator(".themeToggle").click();
    if (viewport === "mobile") await page.locator(".mobileMenuButton").click();
  };
  const assertCatalog = async (period, language) => {
    const tabs = page.locator(".subscriptionPeriodTabs");
    await tabs.waitFor();
    const expected = { vi: { day: "Ngày", month: "Tháng", year: "Năm" }, en: { day: "Day", month: "Month", year: "Year" } }[language][period];
    // The initial Month tab mounts before the catalog resolves a planId link.
    await page.waitForFunction(({ label, period }) => {
      const catalog = globalThis.document.querySelector(".subscriptionCatalog");
      const selected = catalog?.querySelector('.subscriptionPeriodTabs [aria-selected="true"]');
      const cards = [...(catalog?.querySelectorAll(".subscriptionPlanCard") || [])];
      return selected?.textContent.trim() === label && cards.length === 3
        && cards.every((card) => card.querySelector(".subscriptionPlanHeading h3")?.textContent.startsWith(period));
    }, { label: expected, period }, { timeout: 15_000 });
    if (await tabs.locator('[aria-selected="true"]').innerText() !== expected) throw new Error(`Wrong selected period: ${period}`);
    const titles = await page.locator(".subscriptionPlanHeading h3").allTextContents();
    if (!titles.every((title) => title.startsWith(period))) throw new Error(`Catalog mixed periods: ${titles}`);
    const overflow = await page.locator(".subscriptionCatalog").evaluate((root) =>
      root.scrollWidth > root.clientWidth + 1 || [...root.querySelectorAll(".subscriptionPlanCard, button, a")].some((element) => element.scrollWidth > element.clientWidth + 2));
    if (overflow) throw new Error(`${viewport} Subscription controls overflow`);
    const benefitsHidden = await page.locator(".subscriptionCatalog").evaluate((root) =>
      [...root.querySelectorAll(".subscriptionPlanCard")].some((card) => {
        const benefits = card.querySelector(".subscriptionPlanBenefits");
        return Boolean(card.querySelector("details")) || !benefits?.children.length
          || [...benefits.children].some((item) => item.getClientRects().length === 0);
      }));
    if (benefitsHidden) throw new Error("Subscription benefits must be visible without expanding a section");
  };
  const assertTopupLayout = async () => {
    const problem = await page.locator(".topupPage").evaluate((root) => {
      if (globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1) return "Page overflow";
      const catalog = root.querySelector(".topupCatalogColumn").getBoundingClientRect();
      const order = root.querySelector(".topupOrderColumn").getBoundingClientRect();
      if (globalThis.innerWidth > 820 ? order.left < catalog.right : order.top < catalog.bottom) return "Order overlaps catalog";
      const controls = [...root.querySelectorAll("button, input, .subscriptionPlanCard, .topupCreditPlan, .topupOrderSummary")];
      const overflowing = controls.find((control) => control.clientWidth > 0 && control.scrollWidth > control.clientWidth + 2);
      if (overflowing) return `Control overflow: ${overflowing.className} (${overflowing.scrollWidth}/${overflowing.clientWidth})`;
      return "";
    });
    if (problem) throw new Error(`${viewport} Topup: ${problem}`);
    if (await page.locator(".topupPayButton").count() !== 1 || await page.locator("#topup-voucher").count() !== 1) throw new Error("Duplicate checkout or voucher controls");
  };
  try {
    for (const language of ["vi", "en"]) {
      for (const theme of ["light", "dark"]) {
        await page.goto(`${frontendOrigin}/membership`, { waitUntil: "domcontentloaded" });
        await setPresentation(language, theme);
        await assertCatalog("month", language);
        await page.locator(".subscriptionSchedule .isUpcoming").waitFor();
        const schedule = await page.locator(".subscriptionSchedule").innerText();
        if (!schedule.includes(language === "vi" ? "Đã thanh toán, chờ bắt đầu" : "Paid, waiting to start")) throw new Error("Missing paid queued period");
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-subscription-${theme}-${language}.png`), fullPage: true });
        await page.locator(".subscriptionPeriodTabs button").first().click();
        await assertCatalog("day", language);
        await page.locator(".subscriptionPeriodTabs button").first().press("End");
        await assertCatalog("year", language);
        await page.goto(`${frontendOrigin}/topup`, { waitUntil: "domcontentloaded" });
        await assertCatalog("month", language);
        if (!await page.locator('#topup-tab-pro').getAttribute("aria-selected").then((value) => value === "true")) throw new Error("Topup default is not Subscription");
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-topup-subscription-${theme}-${language}.png`), fullPage: true });
        await assertTopupLayout();
        await page.locator("#topup-tab-pro").focus();
        await page.locator("#topup-tab-pro").press("End");
        await page.locator(".topupCreditPlan").first().getByRole("button").click();
        await page.waitForFunction(() => globalThis.document.querySelector(".topupSelectedItem > strong")?.textContent === "Credit 100");
        if (!await page.locator(".topupCreditPlan .subscriptionPlanBenefits").first().isVisible()
          || await page.locator(".topupCreditPlan details").count()) throw new Error("Credit benefits must be visible without expanding a section");
        await assertTopupLayout();
        const creditPrice = await page.locator(".topupOrderTotal dd").innerText();
        if (!creditPrice.includes(language === "vi" ? "100.000" : "US$1.00")) throw new Error(`Wrong Credit total: ${creditPrice}`);
        await page.locator("#topup-voucher").fill("QA10");
        await page.locator(".topupVoucherForm").getByRole("button").click();
        await page.locator(".topupAppliedVoucher").waitFor();
        await page.waitForFunction((expected) => globalThis.document.querySelector(".topupOrderTotal dd")?.textContent.includes(expected), language === "vi" ? "90.000" : "US$0.90");
        if (!await page.locator(".topupSelectedItem").innerText().then((text) => text.includes("130 Credit"))) throw new Error("Missing voucher Credit bonus");
        await assertTopupLayout();
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-topup-credit-${theme}-${language}.png`), fullPage: true });
        const beforeCheckout = checkoutRequests.length;
        await page.locator(".topupPayButton").click();
        await page.locator(".topupOrderSummary .error").waitFor();
        const checkout = checkoutRequests[beforeCheckout];
        if (checkoutRequests.length !== beforeCheckout + 1 || checkout.path !== "/api/topup" || checkout.packageId !== packages[0]._id || checkout.paymentProvider !== (language === "vi" ? "sepay" : "paypal") || checkout.voucherCode !== "QA10") throw new Error("Credit checkout contract changed");
        await page.locator(".topupAppliedVoucher button").click();
        if (await page.locator(".topupAppliedVoucher").count()) throw new Error("Voucher was not removed");
        if (await page.locator(".topupOrderTotal dd").innerText() !== creditPrice) throw new Error("Removing voucher did not restore price");
        await page.locator("#topup-tab-credit").press("Home");
        await assertCatalog("month", language);
        const beforeSubscription = checkoutRequests.length;
        await page.locator(".topupPayButton").click();
        await page.locator(".topupOrderSummary .error").waitFor();
        const subscription = checkoutRequests[beforeSubscription];
        if (checkoutRequests.length !== beforeSubscription + 1 || subscription.path !== "/api/membership/checkout" || subscription.planId !== plans[3]._id || subscription.paymentProvider !== (language === "vi" ? "sepay" : "paypal") || subscription.voucherCode) throw new Error("Subscription checkout contract changed");
        await page.locator("#topup-voucher").fill("QA10");
        await page.locator(".topupVoucherForm").getByRole("button").click();
        await page.waitForFunction((expected) => globalThis.document.querySelector(".topupOrderTotal dd")?.textContent.includes(expected), language === "vi" ? "180.000" : "US$1.80");
        const otherPlan = page.locator(".subscriptionPlanCard").filter({ hasText: "month 50" });
        if (!await otherPlan.locator(".subscriptionPlanPrice").innerText().then((text) => text.includes(language === "vi" ? "500.000" : "US$5.00"))) throw new Error("Voucher discounted an unselected Subscription plan");
        await page.evaluate(() => globalThis.scrollTo(0, 0));
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-topup-scoped-voucher-${theme}-${language}.png`), fullPage: true });
        await otherPlan.getByRole("button").click();
        if (!await page.locator(".topupOrderTotal dd").innerText().then((text) => text.includes(language === "vi" ? "500.000" : "US$5.00"))) throw new Error("Changing plan retained an inapplicable discount");
        if (!await page.locator(".topupAppliedVoucher").innerText().then((text) => text.includes(language === "vi" ? "không áp dụng gói này" : "does not apply to this package"))) throw new Error("Inapplicable voucher state is missing");
        for (const plan of [plans[4], plans[3]]) {
          await page.locator(".subscriptionPlanCard").filter({ hasText: plan.name }).getByRole("button").click();
          const before = checkoutRequests.length;
          const submitted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/membership/checkout" && response.request().method() === "POST");
          await page.locator(".topupPayButton").click();
          await submitted;
          const request = checkoutRequests[before];
          if (checkoutRequests.length !== before + 1 || request.planId !== plan._id || request.voucherCode !== (plan === plans[3] ? "QA10" : undefined)) throw new Error("Checkout sent a voucher for the wrong Subscription plan");
        }
        await page.locator("#topup-tab-credit").click();
        if (await page.locator(".topupOrderTotal dd").innerText() !== creditPrice) throw new Error("Subscription voucher discounted a Credit package");
        const creditSubmitted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/topup" && response.request().method() === "POST");
        const beforeCredit = checkoutRequests.length;
        await page.locator(".topupPayButton").click();
        await creditSubmitted;
        if (checkoutRequests.length !== beforeCredit + 1 || checkoutRequests[beforeCredit].voucherCode) throw new Error("Credit checkout sent a Subscription voucher");
        await page.locator("#topup-tab-pro").click();
        await page.locator(".topupAppliedVoucher button").click();
        await page.locator(".subscriptionPeriodTabs button").first().click();
        await assertCatalog("day", language);
        const freeButton = page.locator(".topupPayButton");
        if (await freeButton.isDisabled() || !await freeButton.innerText().then((text) => text.includes(language === "vi" ? "Nhận gói miễn phí" : "Get free plan"))) throw new Error("Free plan checkout is unavailable");
      }
      await page.goto(`${frontendOrigin}/topup?mode=pro&planId=${plans[8]._id}`, { waitUntil: "domcontentloaded" });
      await assertCatalog("year", language);
      await page.locator("#topup-tab-credit").click();
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => globalThis.document.querySelector("#topup-tab-credit")?.getAttribute("aria-selected") === "true");
      await page.goto(`${frontendOrigin}/topup?packageId=${packages[1]._id}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => globalThis.document.querySelector(".topupSelectedItem > strong")?.textContent === "Credit 300");
      if (await page.locator("#topup-tab-credit").getAttribute("aria-selected") !== "true") throw new Error("Credit package link opened Subscription");
      await page.goto(`${frontendOrigin}/topup?mode=pro`, { waitUntil: "domcontentloaded" });
      await assertCatalog("month", language);
      if (language === "en") {
        const unavailable = page.locator(".subscriptionPlanCard").filter({ hasText: "month 100" });
        if (!await unavailable.innerText().then((value) => value.includes("Price unavailable"))) throw new Error("Missing USD price became free");
        await unavailable.getByRole("button").click();
        if (!await page.locator(".topupCheckoutBox .primaryButton").isDisabled()) throw new Error("Missing USD price can be purchased");
      }
      const homepageCatalogRequests = [];
      const collectHomeRequest = (request) => {
        const pathname = new URL(request.url()).pathname;
        if (["/api/topup/packages", "/api/membership/plans"].includes(pathname)) homepageCatalogRequests.push(pathname);
      };
      page.on("request", collectHomeRequest);
      await page.goto(`${frontendOrigin}/`, { waitUntil: "domcontentloaded" });
      await page.locator("#home-guide").waitFor();
      await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
      page.off("request", collectHomeRequest);
      if (homepageCatalogRequests.length) throw new Error(`Homepage still fetches package catalogs: ${homepageCatalogRequests}`);
      if (await page.locator("#pricing, .homeTopupChooser, .subscriptionCatalog, .pricingGrid").count()) throw new Error("Homepage still contains top-up packages");
      if (await page.locator('a[href="#pricing"]').count()) throw new Error("Homepage contains a broken pricing anchor");
      await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-home-without-pricing-${language}.png`), fullPage: true });
    }
    checkoutEnabled = false;
    await page.goto(`${frontendOrigin}/membership`, { waitUntil: "domcontentloaded" });
    await assertCatalog("month", "en");
    if (!await page.locator(".topupCheckoutBox .primaryButton").isDisabled()) throw new Error("Paused Subscription checkout remained enabled");
  } finally {
    await context.unroute(plansPattern, plansHandler);
    await context.unroute(mePattern, meHandler);
    await context.unroute(packagesPattern, packagesHandler);
    await context.unroute(eventsPattern, eventsHandler);
    await context.unroute(voucherPattern, voucherHandler);
    await context.unroute("**/api/membership/checkout", checkoutHandler);
    await context.unroute("**/api/topup", checkoutHandler);
  }
}

async function main() {
  if (!fs.existsSync(path.join(buildRoot, "index.html"))) {
    throw new Error(`Build is missing: ${buildRoot}`);
  }
  fs.mkdirSync(screenshotRoot, { recursive: true });

  const backend = spawn(process.execPath, ["--expose-gc", "server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(backendPort),
      CLIENT_URL: frontendOrigin,
      PUBLIC_BASE_URL: backendOrigin,
      CORS_ORIGINS: frontendOrigin,
      MONGO_URI: "",
      MONGO_CORE_URI: "",
      MONGO_MARKETPLACE_URI: "",
      MARKETPLACE_DB_TARGET: "core",
      MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED: "false",
      ALLOW_MEMORY_DB: "true",
      ALLOW_DEV_LOGIN: "true",
      ALLOW_DEV_ADMIN_LOGIN: "true",
      ADMIN_EMAILS: "dev@local.test",
      ADMIN_2FA_REQUIRED: "false",
      DEV_LOGIN_ROLE: "user",
      DEV_LOGIN_PRO: "false",
      THREED66_MOCK: "true",
      SEPAY_ENABLED: "false",
      PAYPAL_ENABLED: "false",
      SUBSCRIPTION_SCHEDULE_JOB_ENABLED: "false",
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_WEBHOOK_ID: "",
      PAYPAL_MERCHANT_ID: "",
      TURNSTILE_ENABLED: "false",
      GETLINK_JOB_ENABLED: "false",
      HISTORY_RETENTION_JOB_ENABLED: "false",
      MARKETPLACE_QUOTA_GRANT_JOB_ENABLED: "false",
      MARKETPLACE_DRIVE_CHANGES_ENABLED: "false",
      MARKETPLACE_DRIVE_WRITE_ENABLED: "false",
      MARKETPLACE_DRIVE_RECONCILE_WORKER_ENABLED: "false",
      MARKETPLACE_POPULARITY_WORKER_ENABLED: "false",
      MARKETPLACE_RECOMMENDATION_WORKER_ENABLED: "false",
      STORAGE_HEALTH_JOB_ENABLED: "false",
      TELEGRAM_BOT_TOKEN: "",
      MARKETPLACE_SEARCH_ENGINE: "mongo",
      MARKETPLACE_DISCOVERY_URL: "",
      MARKETPLACE_COVER_CACHE_ENABLED: "false",
      MARKETPLACE_BILINGUAL_SEARCH_ENABLED: "false",
      PLUGIN_API_ENABLED: "true",
      PLUGIN_RELEASE_SOURCE: "env",
      PLUGIN_RELEASE_ENABLED: "false",
      PLUGIN_JWT_SECRET: "qa-only-plugin-secret-with-more-than-32-characters",
      QA_DIAGNOSTICS_ENABLED: "true",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const backendLogs = [];
  backend.stdout.on("data", (chunk) => backendLogs.push(chunk.toString()));
  backend.stderr.on("data", (chunk) => backendLogs.push(chunk.toString()));

  const frontend = staticServer();
  await new Promise((resolve, reject) => {
    frontend.once("error", reject);
    frontend.listen(frontendPort, "127.0.0.1", resolve);
  });

  let browser;
  try {
    const readiness = await waitForBackend();
    if (!readiness.ready) throw new Error("Backend reported not ready");

    for (const endpoint of ["/health", "/ready", "/api/marketplace/categories", "/api/marketplace/filters"]) {
      const response = await fetch(`${backendOrigin}${endpoint}`);
      if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
    }
    const headerResponse = await fetch(`${backendOrigin}/health`, {
      headers: { origin: frontendOrigin },
    });
    if (headerResponse.headers.get("x-powered-by")) {
      throw new Error("Backend leaked the Express x-powered-by header");
    }
    if (headerResponse.headers.get("x-content-type-options") !== "nosniff") {
      throw new Error("Backend is missing X-Content-Type-Options");
    }
    if (!headerResponse.headers.get("permissions-policy")?.includes("camera=()")) {
      throw new Error("Backend is missing the restrictive Permissions-Policy");
    }
    if (headerResponse.headers.get("access-control-allow-origin") !== frontendOrigin) {
      throw new Error("Backend did not allow the configured frontend origin");
    }
    const deniedOrigin = await fetch(`${backendOrigin}/health`, {
      headers: { origin: "https://untrusted.example.test" },
    });
    if (deniedOrigin.status !== 403) {
      throw new Error(`Untrusted CORS origin returned HTTP ${deniedOrigin.status}`);
    }
    const missingCsrf = await fetch(`${backendOrigin}/api/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (missingCsrf.status !== 403) {
      throw new Error(`Mutation without CSRF returned HTTP ${missingCsrf.status}`);
    }
    const unsafePayload = await fetch(`${backendOrigin}/api/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ $where: "return true" }),
    });
    if (unsafePayload.status !== 400) {
      throw new Error(`Unsafe Mongo-style payload returned HTTP ${unsafePayload.status}`);
    }
    const pluginStart = await fetch(`${backendOrigin}/api/plugin/auth/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceName: "QA-WORKSTATION",
        pluginVersion: "0.1.0",
        maxVersion: "2026",
      }),
    });
    if (pluginStart.status !== 201) {
      throw new Error(`Plugin device start returned HTTP ${pluginStart.status}`);
    }

    const memoryBefore = await backendMemory(backend);
    const load = await catalogLoad();
    const memoryAfter = await backendMemory(backend);
    const heapDeltaBytes = Number(memoryAfter.heapUsed || 0) - Number(memoryBefore.heapUsed || 0);
    if (load.p95Ms > 500) {
      throw new Error(`Catalog load p95 exceeded 500ms: ${load.p95Ms}ms`);
    }
    if (heapDeltaBytes > 20 * 1024 * 1024) {
      throw new Error(`Backend heap grew more than 20 MiB after load: ${heapDeltaBytes}`);
    }

    browser = await chromium.launch(browserLaunchOptions());
    const errors = [];
    const externalFailures = [];
    const slowest = [];

    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      await context.route("**/api/auth/google/one-tap/config",
        (route) => route.fulfill({ json: { enabled: false } }));
      await context.route(/^https:\/\/(?:pagead2\.googlesyndication\.com|googleads\.g\.doubleclick\.net)\//,
        (route) => route.fulfill({ status: 204, body: "" }));
      const page = await context.newPage();
      page.on("console", (message) => {
        if (
          message.type() === "error"
          && !message.text().includes("Failed to load resource")
        ) {
          errors.push(`${viewport.name}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => errors.push(`${viewport.name}: ${error.message}`));
      page.on("requestfailed", (request) => {
        if (isExpectedClientAbort(request)) return;
        const url = request.url();
        const item = `${viewport.name}: ${request.failure()?.errorText || "request failed"} ${url}`;
        if (url.startsWith(frontendOrigin) || url.startsWith(backendOrigin)) {
          errors.push(item);
        } else {
          externalFailures.push(item);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 500) errors.push(`${viewport.name}: HTTP ${response.status()} ${response.url()}`);
      });

      for (const route of routeSet) {
        const startedAt = Date.now();
        const catalogResponse = route === "/models"
          ? page.waitForResponse((candidate) => {
              const url = new URL(candidate.url());
              return url.pathname === "/api/marketplace/models"
                && url.searchParams.get("sort") === "newest";
            }, { timeout: 15_000 })
          : Promise.resolve(null);
        const [response, modelResponse] = await Promise.all([
          page.goto(`${frontendOrigin}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: 15_000,
          }),
          catalogResponse,
        ]);
        if (!response?.ok()) throw new Error(`${viewport.name} ${route} returned HTTP ${response?.status()}`);
        if (modelResponse && !modelResponse.ok()) {
          throw new Error(`${viewport.name} Model catalog returned HTTP ${modelResponse.status()}`);
        }
        await page.waitForSelector("#root", { state: "visible" });
        if (route === "/models") {
          await page.waitForFunction(() => globalThis.document.querySelector(".marketSortControl select")?.value === "newest");
        }
        const text = (await page.locator("#root").innerText()).trim();
        if (!text) throw new Error(`${viewport.name} ${route} rendered an empty root`);
        slowest.push({ viewport: viewport.name, route, durationMs: Date.now() - startedAt });
      }

      await page.goto(`${frontendOrigin}/models`, { waitUntil: "domcontentloaded" });
      await page.screenshot({
        path: path.join(screenshotRoot, `${viewport.name}-models.png`),
        fullPage: true,
      });
      await verifyLanguageFlags(page, viewport.name, "guest");

      const adminDataPaths = [
        "/api/admin/overview",
        "/api/admin/dashboard",
        "/api/admin/storage-health",
        "/api/admin/topup-packages",
        "/api/admin/membership-plans",
        "/api/admin/vouchers",
        "/api/admin/cookies",
        "/api/admin/cookies/status",
        "/api/admin/system-logs",
        "/api/admin/articles",
        "/api/admin/notifications",
        "/api/admin/referrals",
        "/api/admin/users",
        "/api/admin/getlinks",
        "/api/admin/transactions",
        "/api/admin/audit-logs",
      ];
      const adminResponses = adminDataPaths.map((endpoint) => page.waitForResponse(
        (response) => new URL(response.url()).pathname === endpoint,
        { timeout: 15_000 },
      ));
      await page.goto(
        `${frontendOrigin}/api/auth/dev-login?role=admin&pro=true&returnTo=%2Fadmin`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForURL(`${frontendOrigin}/admin`);
      await page.waitForSelector(".adminPage", { state: "visible" });
      for (const response of await Promise.all(adminResponses)) {
        if (!response.ok()) throw new Error(`${viewport.name} admin data returned HTTP ${response.status()}: ${response.url()}`);
      }
      const adminText = (await page.locator("#root").innerText()).trim();
      if (!adminText) throw new Error(`${viewport.name} admin rendered an empty root after dev login`);
      await page.screenshot({
        path: path.join(screenshotRoot, `${viewport.name}-admin.png`),
        fullPage: true,
      });
      await verifyLanguageFlags(page, viewport.name, "admin");
      await verifyAdminPackageDeletion(page, context, viewport.name);
      await verifyAdminVoucherPlanScopes(page, context, viewport.name);
      await verifyConfiguredCreditCopy(page, context, viewport.name);
      await verifyLiveAccountBalance(page, context);
      await verifySubscriptionCatalog(page, context, viewport.name);
      await context.close();
    }

    if (errors.length) {
      throw new Error(`Browser smoke errors:\n${errors.slice(0, 20).join("\n")}`);
    }
    slowest.sort((left, right) => right.durationMs - left.durationMs);
    const summary = {
      ok: true,
      routes: routeSet.length,
      viewports: 2,
      liveAccountBalance: true,
      configuredCreditCopy: true,
      languageFlags: true,
      adminPackageDeletion: true,
      unifiedSubscriptionToggles: true,
      adminVoucherPlanScopes: true,
      voucherPlanScopes: true,
      subscriptionCatalog: true,
      topupLayout: true,
      homepagePricingRemoved: true,
      completedGetlinkBalanceReplay: false,
      externalFailures: externalFailures.length,
      externalFailureSamples: externalFailures.slice(0, 10),
      load,
      memory: {
        beforeHeapBytes: memoryBefore.heapUsed,
        afterHeapBytes: memoryAfter.heapUsed,
        heapDeltaBytes,
        beforeRssBytes: memoryBefore.rss,
        afterRssBytes: memoryAfter.rss,
      },
      slowest: slowest.slice(0, 5),
    };
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
  } catch (error) {
    console.error(backendLogs.join("").slice(-4_000));
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    await new Promise((resolve) => {
      frontend.close(resolve);
      frontend.closeAllConnections();
    });
    await stopChild(backend);
    if (backend.exitCode && backend.exitCode !== 0) {
      console.error(backendLogs.join("").slice(-4_000));
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
