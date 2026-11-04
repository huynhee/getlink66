import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluateFormatOptions, read3D66InlineFormats, select3D66InlineFormat } from "../src/utils/3d66BrowserService.js";
import { parseFormatOptionsFromHtml } from "../src/utils/3d66Service.js";

const html = fs.readFileSync(new URL("../test/fixtures/3d66-inline-formats.html", import.meta.url), "utf8");
const formatOptions = parseFormatOptionsFromHtml(html);

export async function verifyGetlinkFormats(page, context, { origin, screenshotRoot, viewport }) {
  const fixturePage = await context.newPage();
  try {
    await fixturePage.setContent("<title>Delayed model fixture</title><h1>Model ready before formats</h1>");
    await fixturePage.evaluate((markup) => {
      globalThis.setTimeout(() => { globalThis.document.body.insertAdjacentHTML("beforeend", markup); }, 1750);
    }, html);
    assert.equal(await fixturePage.locator(".tp-multi-format-card").count(), 0);
    const parsed = await read3D66InlineFormats(fixturePage);
    assert.deepEqual(parsed.map((option) => option.key), formatOptions.map((option) => option.key));
    await fixturePage.evaluate(() => {
      const cards = [...globalThis.document.querySelectorAll(".tp-multi-format-card")];
      for (const card of cards) card.addEventListener("click", () => {
        for (const item of cards) item.classList.toggle("active", item === card);
      });
    });
    await select3D66InlineFormat(fixturePage, formatOptions[1]);
    assert.equal((await fixturePage.evaluate(evaluateFormatOptions, true)).find((option) => option.isDefault).key, formatOptions[1].key);
  } finally { await fixturePage.close(); }

  const patterns = ["**/api/account/events", "**/api/settings", "**/api/system/3d66-status", "**/api/getlink/**"];
  const submissions = [];
  let mode = "inline";
  let resumedKey = "";
  let releasePreview;
  let delayedPreviewArrived;
  let delayedPreview;
  let latestJob = null;
  let releaseAcknowledgement;
  let acknowledgement;
  const handler = async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/account/events") return route.fulfill({ status: 204, body: "" });
    if (url.pathname === "/api/settings") return route.fulfill({ json: { settings: { threed66ModelResolveMode: "direct" } } });
    if (url.pathname === "/api/system/3d66-status") return route.fulfill({ json: { online: true } });
    if (url.pathname === "/api/getlink/preview" && mode === "delayed") {
      const stale = request.postDataJSON().modelId.includes("slow-model");
      if (stale) {
        delayedPreviewArrived();
        await delayedPreview;
      }
      return route.fulfill({ json: { productId: stale ? "stale-model" : "current-model",
        title: stale ? "Stale delayed preview" : "Current model preview", creditCost: 28,
        formatOptions, selectedFormat: formatOptions[0] } });
    }
    if (url.pathname === "/api/getlink/preview") return route.fulfill({ json: {
      productId: "ACI896357714629725", title: "Format preview fixture", creditCost: 28,
      formatOptions: mode === "legacy" ? [] : formatOptions,
      selectedFormat: mode === "legacy" ? null : formatOptions[0],
    } });
    if (url.pathname === "/api/getlink/jobs/latest") return route.fulfill({ json: { job: latestJob } });
    if (url.pathname === "/api/getlink/history") return route.fulfill({ json: { history: [] } });
    if (url.pathname.endsWith("/acknowledge")) {
      await acknowledgement;
      latestJob = null;
      return route.fulfill({ json: { job: null } });
    }
    if (url.pathname.endsWith("/format")) {
      resumedKey = request.postDataJSON().formatKey;
      return route.fulfill({ json: { job: { id: "format-fixture", status: "queued", progress: 0 } } });
    }
    if (url.pathname === "/api/getlink/jobs" && request.method() === "POST") {
      submissions.push(request.postDataJSON());
      if (mode === "insufficient-credit") {
        latestJob = { id: "insufficient-credit-fixture", status: "failed", error: { message: "Insufficient credit: 28 required" } };
        return route.fulfill({ json: { job: latestJob } });
      }
      const job = { id: "format-fixture", status: mode === "legacy" ? "awaiting_format" : "queued",
        title: "Format preview fixture", creditCost: 28, progress: 0,
        ...(mode === "legacy" ? { formatOptions, selectedFormat: formatOptions[0] } : {}),
      };
      if (mode === "legacy") latestJob = job;
      return route.fulfill({ json: { job } });
    }
    throw new Error(`Unexpected Getlink QA request: ${url.pathname}`);
  };
  for (const pattern of patterns) await context.route(pattern, handler);
  const source = "https://3d.3d66.com/reshtmla/model/items/fixture/formats.html?sof=ACI896357714629725&sign=fixture";
  try {
    for (const language of ["vi", "en"]) {
      for (const theme of ["light", "dark"]) {
        await page.evaluate(({ language, theme }) => {
          globalThis.localStorage.setItem("language", language);
          globalThis.localStorage.setItem("3dipl-theme", theme);
          for (const key of Object.keys(globalThis.localStorage)) {
            if (key.startsWith("3dipl-getlink-draft:")) globalThis.localStorage.removeItem(key);
          }
        }, { language, theme });
        await page.goto(`${origin}/getlink`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => globalThis.document.querySelector("#modelUrl")?.placeholder.includes("3D66"));
        await page.locator("#modelUrl").fill(source);
        await page.locator(".getlinkForm button[type=submit]").click();
        const selector = page.locator(".formatSelector");
        await selector.waitFor();
        assert.equal(await selector.locator(".formatOption").count(), 2);
        assert.equal(await selector.getByRole("button", { pressed: true }).innerText().then((text) => text.includes("VR max 2014")), true);
        assert.equal(submissions.length, language === "vi" ? (theme === "light" ? 0 : 1) : (theme === "light" ? 2 : 3));
        await selector.getByRole("button", { name: /CR max 2016/ }).click();
        await page.reload({ waitUntil: "domcontentloaded" });
        await selector.getByRole("button", { name: /CR max 2016/, pressed: true }).waitFor();
        assert.equal(await selector.evaluate((node) => node.scrollWidth > node.clientWidth + 2), false);
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-formats-${language}-${theme}.png`), fullPage: true, animations: "disabled" });
        const posted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/getlink/jobs"
          && response.request().method() === "POST");
        await page.locator(".result").getByRole("button", { name: /Xác nhận tải|Confirm download/ }).click();
        await posted;
        assert.equal(submissions.at(-1).downloadFormat.key, "1|max2016|3");
        assert.equal(submissions.at(-1).downloadFormat.formatVersion, "max2016");
        assert.equal(submissions.at(-1).downloadFormat.rendererType, "3");
      }
    }
    mode = "insufficient-credit";
    await page.locator("#modelUrl").fill(source.replace("formats.html", "insufficient-credit.html"));
    await page.locator(".getlinkForm button[type=submit]").click();
    await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).click();
    await page.locator(".result").getByRole("button", { name: /Xác nhận tải|Confirm download/ }).click();
    await page.getByText("Insufficient credit: 28 required", { exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText("Insufficient credit: 28 required", { exact: true }).waitFor();
    await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/, pressed: true }).waitFor();
    latestJob = null;

    mode = "delayed";
    delayedPreview = new Promise((resolve) => { releasePreview = resolve; });
    const arrived = new Promise((resolve) => { delayedPreviewArrived = resolve; });
    await page.goto(`${origin}/getlink`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.document.querySelector("#modelUrl")?.placeholder.includes("3D66"));
    await page.locator("#modelUrl").fill(source.replace("formats.html", "slow-model.html"));
    await page.locator(".getlinkForm button[type=submit]").click();
    await arrived;
    const currentSource = source.replace("formats.html", "current-model.html");
    await page.locator("#modelUrl").fill(currentSource);
    await page.locator(".getlinkForm button[type=submit]").click();
    await page.getByText("Current model preview", { exact: true }).waitFor();
    releasePreview();
    await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-current-preview.png`), fullPage: true });
    assert.equal(await page.getByText("Stale delayed preview", { exact: true }).count(), 0);
    await page.evaluate(() => {
      for (const key of Object.keys(globalThis.localStorage)) {
        if (!key.startsWith("3dipl-getlink-draft:") || key.endsWith(":request-id")) continue;
        const draft = JSON.parse(globalThis.localStorage.getItem(key));
        draft.previewCheckedAt = Date.now() - 31_000;
        globalThis.localStorage.setItem(key, JSON.stringify(draft));
      }
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction((input) => globalThis.document.querySelector("#modelUrl")?.value === input, currentSource);
    assert.equal(await page.locator(".result").count(), 0, "Expired previews must be checked again before checkout");

    latestJob = { id: "old-completed-job", status: "completed", title: "Old completed model", result: {} };
    acknowledgement = new Promise((resolve) => { releaseAcknowledgement = resolve; });
    await page.goto(`${origin}/getlink`, { waitUntil: "domcontentloaded" });
    await page.getByText("Old completed model", { exact: true }).waitFor();
    await page.locator("#modelUrl").fill(currentSource);
    await page.locator(".getlinkForm button[type=submit]").click();
    await page.getByText("Current model preview", { exact: true }).waitFor();
    if (!await page.locator(".languageToggleSingle button").isVisible()) await page.locator(".mobileMenuButton").click();
    await page.locator(".languageToggleSingle button").click();
    if (await page.locator(".mobileMenuButton").getAttribute("aria-expanded") === "true") await page.locator(".mobileMenuButton").click();
    assert.equal(await page.getByText("Old completed model", { exact: true }).count(), 0, "Dismissed jobs must not overwrite the new preview");
    await page.getByText("Current model preview", { exact: true }).waitFor();
    const acknowledged = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/acknowledge"));
    releaseAcknowledgement();
    await acknowledged;

    mode = "legacy";
    await page.goto(`${origin}/getlink`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => globalThis.document.querySelector("#modelUrl")?.placeholder.includes("3D66"));
    await page.locator("#modelUrl").fill(source);
    await page.locator(".getlinkForm button[type=submit]").click();
    await page.locator(".result").waitFor();
    assert.equal(await page.locator(".formatSelector").count(), 0);
    await page.locator(".result").getByRole("button", { name: /Xác nhận tải|Confirm download/ }).click();
    const dialog = page.locator(".redownloadFormatOverlay");
    await dialog.waitFor();
    await dialog.getByRole("button", { name: /CR max 2016/ }).click();
    await page.waitForResponse((response) => new URL(response.url()).pathname === "/api/getlink/jobs/latest");
    await dialog.screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-preserved-format.png`) });
    assert.equal(await dialog.getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true",
      "Polling must not reset the selected file format");
    const resumed = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/format"));
    await dialog.getByRole("button", { name: /Xác nhận tải|Confirm download/ }).click();
    await resumed;
    assert.equal(resumedKey, "1|max2016|3");
    assert.equal(submissions.at(-1).downloadFormat, undefined);
  } catch (error) {
    await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-formats-failure.png`), fullPage: true, animations: "disabled" });
    error.message += `\nGetlink fixture page: ${await page.locator(".getlinkForm").innerText()}`;
    throw error;
  } finally {
    releasePreview?.();
    releaseAcknowledgement?.();
    for (const pattern of patterns) await context.unroute(pattern, handler);
  }
  await verifyHybridGetlinkPreview(page, context, { origin, screenshotRoot, viewport });
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

export async function verifyHybridGetlinkPreview(page, context, { origin, screenshotRoot, viewport }) {
  let resolverMode = "hybrid";
  let scenario = "progressive";
  let gate = deferred();
  let arrived = deferred();
  let delivered = deferred();
  let latestJob = null;
  let resumedKey = "";
  const neutral = {
    vi: "Tạm thời chưa thể xử lý model này. Vui lòng thử lại sau hoặc liên hệ hỗ trợ.",
    en: "This model is temporarily unavailable. Please try again later or contact support.",
  };
  const privateError = { code: "THREED66_MANUAL_VERIFICATION_REQUIRED",
    message: "CAPTCHA in Playwright browser; ask admin to replace cookie/profile and retry &st=2" };
  const requestLocales = [];
  let account = { _id: "hybrid-qa-user", name: "Hybrid QA", email: "hybrid@local.test", credit: 100, role: "user" };
  const previewRequests = [];
  const prepareRequests = [];
  const submissions = [];
  const obj = { key: "3|obj|0", fileFormat: "3", label: "OBJ (.obj)", size: "24 MB" };
  const completeOptions = [formatOptions[1], formatOptions[0], obj];
  const source = "https://3d.3d66.com/reshtmla/model/items/fixture/hybrid.html?sof=ACI896357714629725&sign=fixture";
  const metadata = { productId: "ACI896357714629725", title: "Hybrid early model", creditCost: 28,
    imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=" };
  const handler = async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/getlink/")) requestLocales.push(request.headers()["accept-language"]);
    if (pathname === "/api/auth/user") return route.fulfill({ json: { user: account } });
    if (pathname === "/api/settings") return route.fulfill({ json: { settings: { threed66ModelResolveMode: resolverMode } } });
    if (pathname === "/api/system/3d66-status") return route.fulfill({ json: { online: true } });
    if (pathname === "/api/account/events") return route.fulfill({ status: 204, body: "" });
    if (pathname === "/api/getlink/jobs/latest") return route.fulfill({ json: { job: latestJob } });
    if (pathname === "/api/getlink/history") return route.fulfill({ json: { history: [] } });
    if (pathname === "/api/getlink/preview") {
      previewRequests.push(request.postDataJSON());
      return route.fulfill({ json: { ...metadata,
        ...(scenario === "incomplete" ? { title: "", imageUrl: "", creditCost: null, metadataIncomplete: true } : {}),
        formatsChecked: ["no-choice", "awaiting-format"].includes(scenario),
        formatOptions: ["metadata-only", "incomplete", "no-choice", "prepared-no-choice", "awaiting-format"].includes(scenario) ? [] : formatOptions,
        selectedFormat: ["no-choice", "awaiting-format"].includes(scenario) ? null : formatOptions[0],
        preparationStatus: ["ready", "metadata-only", "no-choice", "awaiting-format"].includes(scenario) ? "ready" : "pending" } });
    }
    if (pathname === "/api/getlink/preview/prepare") {
      prepareRequests.push(request.postDataJSON());
      const currentScenario = scenario;
      const responseDelivered = delivered;
      arrived.resolve();
      await gate.promise;
      if (currentScenario === "failure") {
        await route.fulfill({ status: 403, json: privateError });
      } else {
        await route.fulfill({ json: { ...metadata,
          title: currentScenario === "stale" ? "Stale hybrid preparation" : "Hybrid prepared model",
          preparationStatus: "ready", metadataIncomplete: false, creditCost: currentScenario === "changed" ? 42 : 28,
          formatsChecked: true,
          formatOptions: currentScenario === "changed" ? [obj] : currentScenario === "prepared-no-choice" ? []
            : currentScenario === "details-changed" ? [formatOptions[0], { ...formatOptions[1], size: "800 MB" }] : completeOptions,
          selectedFormat: formatOptions[0] } });
      }
      responseDelivered.resolve();
      return;
    }
    if (pathname === "/api/getlink/jobs" && request.method() === "POST") {
      submissions.push(request.postDataJSON());
      if (scenario === "public-error") return route.fulfill({ status: 400,
        json: { code: "GETLINK_UNAVAILABLE", message: neutral.en } });
      if (scenario === "legacy-job-error") {
        latestJob = { id: "legacy-private-error", status: "failed", error: privateError };
        return route.fulfill({ json: { job: latestJob } });
      }
      if (scenario === "awaiting-format") {
        latestJob = { id: "hybrid-awaiting-format", status: "awaiting_format", ...metadata, formatOptions,
          selectedFormat: formatOptions[0] };
        return route.fulfill({ json: { job: latestJob } });
      }
      return route.fulfill({ status: 402, json: { message: "Insufficient credit fixture" } });
    }
    if (pathname.endsWith("/format")) {
      resumedKey = request.postDataJSON().formatKey;
      latestJob = null;
      return route.fulfill({ json: { job: null } });
    }
    if (pathname.endsWith("/acknowledge")) {
      latestJob = null;
      return route.fulfill({ json: { job: null } });
    }
    throw new Error(`Unexpected hybrid QA request: ${pathname}`);
  };
  const patterns = ["**/api/auth/user", "**/api/settings", "**/api/system/3d66-status", "**/api/account/events", "**/api/getlink/**"];
  for (const pattern of patterns) await context.route(pattern, handler);
  const confirm = () => page.locator(".result").getByRole("button", { name: /Xác nhận tải|Confirm download/ });
  const status = (value) => page.locator(`[data-preparation-status="${value}"]`).waitFor();
  const resetGate = (nextScenario) => {
    scenario = nextScenario;
    gate = deferred(); arrived = deferred(); delivered = deferred();
  };
  const check = async (url = source) => {
    await page.locator("#modelUrl").fill(url);
    await page.locator(".getlinkForm button[type=submit]").click();
  };
  try {
    for (const language of ["vi", "en"]) {
      resetGate("progressive");
      await page.evaluate((lang) => {
        globalThis.localStorage.setItem("language", lang);
        for (const key of Object.keys(globalThis.localStorage)) {
          if (key.startsWith("3dipl-getlink-draft:")) globalThis.localStorage.removeItem(key);
        }
      }, language);
      await page.goto(`${origin}/getlink`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => globalThis.document.querySelector("#modelUrl")?.placeholder.includes("3D66"));
      for (const clipboardMode of ["unsupported", "denied"]) {
        await page.evaluate((mode) => {
          globalThis.__qaClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
          Object.defineProperty(navigator, "clipboard", { configurable: true, value: mode === "unsupported" ? undefined
            : { readText: async () => { throw new Error("Clipboard permission denied"); } } });
        }, clipboardMode);
        try {
          await page.getByRole("button", { name: /^(Dán|Paste)$/ }).click();
          const expected = clipboardMode === "unsupported"
            ? (language === "vi" ? "Trình duyệt chưa hỗ trợ đọc clipboard." : "This browser does not support clipboard reading.")
            : (language === "vi" ? "Không đọc được clipboard. Hãy cho phép trình duyệt truy cập clipboard." : "Cannot read clipboard. Please allow clipboard access.");
          await page.locator(".error").getByText(expected, { exact: true }).waitFor();
        } finally {
          await page.evaluate(() => {
            if (globalThis.__qaClipboardDescriptor) Object.defineProperty(navigator, "clipboard", globalThis.__qaClipboardDescriptor);
            else delete navigator.clipboard;
            delete globalThis.__qaClipboardDescriptor;
          });
        }
      }
      const beforeInvalid = previewRequests.length;
      await check("ACI896357714629725");
      await page.locator(".error").waitFor();
      assert.equal(previewRequests.length, beforeInvalid, "Hybrid requires a full URL");
      await check();
      await arrived.promise;
      await status("pending");
      await page.getByText("Hybrid early model", { exact: true }).waitFor();
      assert.equal(await page.locator(".formatSelector .formatOption").count(), 2);
      assert.equal(await confirm().isDisabled(), true, "Early metadata must never authorize payment");
      assert.deepEqual(previewRequests.at(-1), { modelId: source, progressive: true });
      assert.deepEqual(prepareRequests.at(-1), { modelId: source });
      assert.equal(requestLocales.at(-1), language, "Getlink API requests must follow the selected UI language");
      await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).click();
      await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-hybrid-early-${language}.png`), fullPage: true });
      gate.resolve();
      await status("ready");
      assert.equal(await page.locator(".formatSelector .formatOption").count(), 3, "Prepared options replace the early list");
      assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true");
      assert.equal(await confirm().isDisabled(), true, "Changed actual options require review even when the selected key survives");
      await page.getByRole("checkbox", { name: /Tôi xác nhận|I confirm/ }).check();
      assert.equal(await confirm().isEnabled(), true);
      await confirm().click();
      await page.getByText("Insufficient credit fixture", { exact: true }).waitFor();
      assert.equal(submissions.at(-1).downloadFormat.key, formatOptions[1].key);
      await page.getByText("Hybrid prepared model", { exact: true }).waitFor();
      assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true");
      for (const errorScenario of ["public-error", "legacy-job-error"]) {
        scenario = errorScenario;
        await confirm().click();
        await page.locator(".error").getByText(neutral[language], { exact: true }).waitFor();
        assert.doesNotMatch(await page.locator(".error").innerText(), /CAPTCHA|browser|admin|cookie|profile|Playwright|st=2|THREED66_/i);
        await page.getByText("Hybrid prepared model", { exact: true }).waitFor();
        assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true",
          "Public and legacy job errors must preserve the preview and selected format");
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await status("stale");
      await page.locator(".error").getByText(neutral[language], { exact: true }).waitFor();
      assert.equal(await confirm().count(), 0, "A failed job must not expose a new checkout action");
      assert.equal(await page.getByRole("button", { name: /^(Thử lại|Retry)$/ }).isDisabled(), true,
        "Even a fresh ready hybrid draft cannot authorize a retry payment");
      assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true");

      resetGate("failure");
      await page.getByRole("button", { name: /Thử chuẩn bị lại|Retry preparation/ }).click();
      await arrived.promise;
      gate.resolve();
      await status("error");
      await page.locator(".error").getByText(neutral[language], { exact: true }).waitFor();
      assert.doesNotMatch(await page.locator(".error").innerText(), /CAPTCHA|browser|admin|cookie|profile|Playwright|st=2|THREED66_/i);
      await page.getByText("Hybrid early model", { exact: true }).waitFor();
      assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true");
      assert.equal(await confirm().isDisabled(), true);
      await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-hybrid-failure-${language}.png`), fullPage: true });
      await page.reload({ waitUntil: "domcontentloaded" });
      await status("stale");
      await page.getByText("Hybrid early model", { exact: true }).waitFor();
      assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true");
      assert.equal(await confirm().isDisabled(), true, "A failed pending draft remains display-only on reload");

      resetGate("changed");
      await page.getByRole("button", { name: /Thử chuẩn bị lại|Retry preparation/ }).click();
      await arrived.promise;
      gate.resolve();
      await status("ready");
      assert.equal(await page.locator(".formatSelector .formatOption[aria-pressed=true]").count(), 0,
        "A removed selection must not silently become the default format");
      assert.equal(await confirm().isDisabled(), true);
      await page.locator(".formatSelector").getByRole("button", { name: /OBJ/ }).click();
      assert.equal(await confirm().isDisabled(), true, "A changed price also needs deliberate review");
      await page.getByRole("checkbox", { name: /Tôi xác nhận|I confirm/ }).check();
      assert.equal(await confirm().isEnabled(), true);
      assert.match(await confirm().innerText(), /42/);
      assert.equal(await page.locator(".formatSelector").evaluate((node) => node.scrollWidth > node.clientWidth + 2), false);
      await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-hybrid-prepared-${language}.png`), fullPage: true });
    }

    resetGate("stale");
    await check(source.replace("hybrid.html", "slow.html"));
    await arrived.promise;
    const staleDelivered = delivered.promise;
    const releaseStale = gate.resolve;
    scenario = "ready";
    await check(source.replace("hybrid.html", "current.html"));
    await status("ready");
    releaseStale();
    await staleDelivered;
    assert.equal(await page.getByText("Stale hybrid preparation", { exact: true }).count(), 0);
    await page.getByText("Hybrid early model", { exact: true }).waitFor();
    const preparesBeforeReady = prepareRequests.length;
    await check(source.replace("hybrid.html", "ready.html"));
    await status("ready");
    assert.equal(prepareRequests.length, preparesBeforeReady, "Ready previews do not need a prepare request");

    scenario = "metadata-only";
    await check(source.replace("hybrid.html", "metadata-only.html"));
    await status("error");
    assert.equal(await confirm().isDisabled(), true, "A metadata-only ready response still cannot authorize payment");
    assert.equal(await page.locator(".formatSelector").count(), 0, "No formats may be invented");

    resetGate("incomplete");
    await check(source.replace("hybrid.html", "incomplete.html"));
    await arrived.promise;
    await status("pending");
    assert.equal(await confirm().isDisabled(), true, "Empty early metadata must still prepare without authorizing payment");
    assert.equal(await page.locator(".formatSelector").count(), 0);
    assert.equal(await page.locator(".result .coinAmount").count(), 0, "Unknown prices must not render as one credit");
    gate.resolve();
    await status("ready");
    await page.getByText("Hybrid prepared model", { exact: true }).waitFor();
    assert.equal(await page.locator(".formatSelector .formatOption").count(), 3);

    resetGate("details-changed");
    await check(source.replace("hybrid.html", "details-changed.html"));
    await arrived.promise;
    await status("pending");
    await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).click();
    gate.resolve();
    await status("ready");
    assert.equal(await page.locator(".formatSelector").getByRole("button", { name: /CR max 2016/ }).getAttribute("aria-pressed"), "true");
    assert.equal(await confirm().isDisabled(), true, "Changed format details alone require review");
    await page.getByRole("checkbox", { name: /Tôi xác nhận|I confirm/ }).check();
    assert.equal(await confirm().isEnabled(), true);

    resetGate("prepared-no-choice");
    await check(source.replace("hybrid.html", "prepared-no-choice.html"));
    await arrived.promise;
    gate.resolve();
    await status("ready");
    assert.equal(await page.locator(".formatSelector").count(), 0);
    assert.equal(await confirm().isEnabled(), true, "Prepared, checked empty lists are valid without invented choices");

    scenario = "no-choice";
    await check(source.replace("hybrid.html", "no-choice.html"));
    await status("ready");
    assert.equal(await page.locator(".formatSelector").count(), 0);
    assert.equal(await confirm().isEnabled(), true, "A complete, checked model without format choices is valid");
    await confirm().click();
    await page.getByText("Insufficient credit fixture", { exact: true }).waitFor();
    assert.equal(submissions.at(-1).downloadFormat, undefined, "No-choice checkout must not invent a format");

    scenario = "awaiting-format";
    await check(source.replace("hybrid.html", "awaiting-format.html"));
    await status("ready");
    await confirm().click();
    const dialog = page.locator(".redownloadFormatOverlay");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /28/);
    await dialog.getByRole("button", { name: /CR max 2016/ }).click();
    const submittedBeforeChoice = submissions.length;
    await dialog.getByRole("button", { name: /Xác nhận tải|Confirm download/ }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(resumedKey, formatOptions[1].key);
    assert.equal(submissions.length, submittedBeforeChoice, "Late choices must resume the job, not create another payment");

    resetGate("stale");
    await check(source.replace("hybrid.html", "old-user.html"));
    await arrived.promise;
    const oldAccountDelivery = delivered.promise;
    account = { ...account, _id: "hybrid-qa-next-user" };
    await page.evaluate(() => globalThis.dispatchEvent(new globalThis.StorageEvent("storage", {
      key: "3dipl-user-sync-event", newValue: JSON.stringify({ type: "refresh-user", source: "qa", at: Date.now() }),
    })));
    await page.waitForFunction(() => globalThis.document.querySelector("#modelUrl")?.value === "");
    gate.resolve();
    await oldAccountDelivery;
    assert.equal(await page.locator(".result").count(), 0, "Old-account preparation must not restore a payable preview");

    resetGate("stale");
    await check(source.replace("hybrid.html", "old-mode.html"));
    await arrived.promise;
    const oldModeDelivery = delivered.promise;
    resolverMode = "search";
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !globalThis.document.querySelector("#modelUrl")?.placeholder.includes("3D66"));
    gate.resolve();
    await oldModeDelivery;
    assert.equal(await page.locator(".result").count(), 0, "A mode change must invalidate the old hybrid draft and response");
    console.log(`Hybrid Getlink QA passed: ${viewport} (vi/en, progressive, selection, price review, failure, draft, stale URL/user/mode)`);
  } finally {
    gate.resolve();
    for (const pattern of patterns) await context.unroute(pattern, handler);
  }
}

// Run the browser fixtures without a backend, credentials, or outbound requests.
if (process.argv.includes("--local")) {
  const { chromium } = await import("playwright");
  const { createServer } = await import("../../frontend/node_modules/vite/dist/node/index.js");
  const server = await createServer({
    root: path.resolve(import.meta.dirname, "../../frontend"),
    define: { "import.meta.env.VITE_API_URL": "window.location.origin" },
    server: { host: "127.0.0.1", port: 0, open: false },
  });
  const screenshotRoot = path.resolve(import.meta.dirname, "../../.cache/hybrid-getlink-qa");
  fs.mkdirSync(screenshotRoot, { recursive: true });
  let browser;
  try {
    await server.listen();
    const origin = server.resolvedUrls.local[0].replace(/\/$/, "");
    const executablePath = [chromium.executablePath(),
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((file) => fs.existsSync(file));
    browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    for (const viewport of [{ name: "desktop", width: 1365, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      try {
        await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
        await context.route("**/api/**", (route) => {
          const pathname = new URL(route.request().url()).pathname;
          if (pathname === "/api/auth/user") return route.fulfill({ json: { user: {
            _id: "local-getlink-qa", name: "Local QA", email: "local@local.test", role: "user", credit: 100,
          } } });
          if (pathname === "/api/auth/csrf") return route.fulfill({ json: { csrfToken: "local-qa-token" } });
          return route.fulfill({ json: { events: [], history: [], settings: {} } });
        });
        const page = await context.newPage();
        await page.goto(origin, { waitUntil: "domcontentloaded" });
        await verifyGetlinkFormats(page, context, { origin, screenshotRoot, viewport: viewport.name });
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
}
