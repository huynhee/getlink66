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
      formatOptions: mode === "inline" ? formatOptions : [],
      selectedFormat: mode === "inline" ? formatOptions[0] : null,
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
}
