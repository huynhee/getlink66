import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const buildRoot = path.resolve(process.argv[2] || "../qa-report/plugin-release-dist-v3-final");
const evidenceRoot = path.resolve(process.argv[3] || "../qa-report/plugin-update-v3");
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  let file = path.resolve(buildRoot, "." + pathname);
  if (!file.startsWith(buildRoot + path.sep)) file = path.join(buildRoot, "index.html");
  let data;
  try { data = await fs.readFile(file); } catch { file = path.join(buildRoot, "index.html"); data = await fs.readFile(file); }
  const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".gif": "image/gif" };
  res.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
  res.end(data);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(evidenceRoot, { recursive: true });
const executablePath = process.platform === "win32" ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const cases = [];
try {
  for (const [language, theme, width] of [["en", "light", 1440], ["vi", "dark", 1440], ["vi", "light", 390], ["en", "dark", 390]]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, serviceWorkers: "block" });
    await context.addInitScript(({ language, theme }) => { localStorage.setItem("language", language); localStorage.setItem("3dipl-theme", theme); }, { language, theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
    });
    const l = (vi, en) => language === "vi" ? vi : en;
    const state = { releases: [], channels: [{ _id: "live-test", revision: 0, activeReleaseId: null }], source: "database", enabled: true, publicChannel: "live-test" };
    const chunks = new Map();
    const requests = [];
    const releaseRequests = [];
    let nextReleaseId = 0;
    let expireUpload = false;
    let expireVerification = false;
    let downloadsGate;
    let downloadsError = false;
    let pausedOnce = false;
    let pauseObserved;
    const pauseRequest = new Promise((resolve) => { pauseObserved = resolve; });
    await context.route("**/api/**", async (route) => {
      const req = route.request();
      const pathname = new URL(req.url()).pathname;
      const body = req.postDataJSON.bind(req);
      let json = {};
      let status = 200;
      if (pathname === "/api/auth/user") json = { user: { _id: "000000000000000000000001", name: "QA Admin", email: "qa@example.test", role: "admin", credit: 50, isTwoFactorEnabled: true } };
      else if (pathname === "/api/auth/csrf") json = { csrfToken: "isolated-browser-fixture" };
      else if (pathname === "/api/account/events") return route.fulfill({ contentType: "text/event-stream", body: "event: ready\ndata: {}\n\n" });
      else if (pathname === "/api/plugin/downloads") {
        if (downloadsGate) {
          const gate = downloadsGate;
          downloadsGate = null;
          gate.started();
          await gate.pending;
        }
        const active = state.releases.find((r) => r._id === state.channels[0].activeReleaseId);
        if (downloadsError) {
          status = 503;
          json = { message: "Downloads fixture unavailable" };
        } else json = { available: Boolean(active), releases: active ? active.manifest.bridgeArtifacts.map((a) => ({ ...a, version: active.version })) : [] };
      } else if (pathname.startsWith("/api/admin/plugin/releases")) {
        releaseRequests.push({ pathname, method: req.method() });
        const pieces = pathname.slice("/api/admin/plugin/releases".length).split("/").filter(Boolean);
        if (!pieces.length && req.method() === "GET") json = structuredClone(state);
        else if (!pieces.length) {
          const input = body();
          const release = { _id: String(++nextReleaseId).padStart(24, "0"), version: input.manifest.version, channel: input.manifest.channel, manifest: input.manifest, createdAt: new Date().toISOString(),
            status: "draft", files: input.files.map((f) => ({ ...f, role: f.name.endsWith(".zip") ? "desktop" : "bridge", sha256: "a".repeat(64), complete: false })) };
          state.releases.unshift(release);
          json = { release };
        } else {
          const release = state.releases.find((r) => r._id === pieces[0]);
          if ((pieces[1] === "files" && req.method() === "PUT" && expireUpload) || (pieces[1] === "verify" && expireVerification)) {
            expireUpload = false;
            expireVerification = false;
            status = 410;
            json = { code: "PLUGIN_RELEASE_UPLOAD_EXPIRED", message: "PLUGIN_RELEASE_UPLOAD_EXPIRED" };
          } else if (pieces[1] === "files") {
            const key = `${release._id}:${pieces[2]}`;
            const received = chunks.get(key) || new Set();
            chunks.set(key, received);
            if (req.method() === "PUT") {
              requests.push(`${key}:${pieces[4]}`);
              if (pieces[4] === "1" && !pausedOnce) {
                pausedOnce = true;
                pauseObserved();
                await new Promise((resolve) => setTimeout(resolve, 500));
              }
              received.add(Number(pieces[4]));
            }
            json = { receivedChunks: [...received], chunkBytes: 8 * 1024 * 1024, totalChunks: Math.ceil(release.files.find((f) => f.name === pieces[2]).bytes / (8 * 1024 * 1024)) };
          } else if (pieces[1] === "verify") {
            release.status = "verified";
            release.verifiedAt = new Date().toISOString();
            release.files.forEach((f) => { f.complete = true; });
            json = { release };
          } else if (pieces[1] === "publish" || pieces[1] === "withdraw") {
            assert.equal(body().expectedRevision, state.channels[0].revision);
            state.channels[0].revision++;
            state.channels[0].activeReleaseId = pieces[1] === "publish" ? release._id : null;
            release.status = pieces[1] === "publish" ? "published" : "withdrawn";
            release.publishedAt = new Date().toISOString();
            json = { release, channel: state.channels[0] };
          } else if (req.method() === "DELETE") {
            state.releases = state.releases.filter((r) => r !== release);
            for (const key of chunks.keys()) if (key.startsWith(`${release._id}:`)) chunks.delete(key);
            json = { deleted: true };
          }
        }
      }
      await route.fulfill({ status, json }).catch((error) => { if (!/disposed|closed|canceled|aborted/i.test(error.message)) throw error; });
    });
    await page.goto(origin + "/admin");
    await page.getByRole("button", { name: "Website", exact: true }).click();
    await page.getByRole("button", { name: l("Bản phát hành plugin", "Plugin releases"), exact: true }).click();
    const panel = page.locator(".adminPluginReleases");
    await panel.getByRole("button", { name: l("Tạo bản nháp", "New draft"), exact: true }).click();
    const years = Array.from({ length: 8 }, (_, i) => String(i + 2020));
    const artifact = (component, family, maxVersions, name) => ({ component, maxFamily: family, maxVersions, downloadUrl: `https://3dipl.org/plugin-releases/live-test/1.0.2/${name}`, sha256: "a".repeat(64) });
    const manifest = { manifestVersion: 3, version: "1.0.2", channel: "live-test", signature: "fixture-signature",
      desktopArtifact: artifact("desktop", "", years, "desktop.zip"), bridgeArtifacts: [artifact("maxBridgeLegacy", "2020-2025", years.slice(0, 6), "legacy.mzp"), artifact("maxBridgeModern", "2026-2027", years.slice(6), "modern.mzp")] };
    await panel.locator(".pluginAdminDraft input[accept*='.json']").setInputFiles({ name: "release.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(manifest)) });
    const files = [{ name: "desktop.zip", mimeType: "application/zip", buffer: Buffer.alloc(8 * 1024 * 1024 + 19, 7) },
      { name: "legacy.mzp", mimeType: "application/zip", buffer: Buffer.alloc(10, 2) }, { name: "modern.mzp", mimeType: "application/zip", buffer: Buffer.alloc(12, 3) }];
    await panel.locator(".pluginAdminDraft input[multiple]").setInputFiles(files);
    await panel.locator(".pluginAdminDraft").getByRole("button", { name: l("Tạo bản nháp", "Create draft"), exact: true }).click();
    await panel.getByRole("button", { name: l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry") }).click();
    await pauseRequest;
    await panel.getByRole("button", { name: l("Tạm dừng tải lên", "Pause upload") }).click();
    await page.getByText(l("Đã tạm dừng. Các phần đã nhận được giữ lại.", "Paused. Received chunks have been retained."), { exact: true }).waitFor();
    await panel.getByRole("button", { name: l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry") }).click();
    const verify = panel.getByRole("button", { name: l("Xác minh bản phát hành", "Verify release") });
    await page.waitForFunction(() => !globalThis.document.querySelector('.pluginAdminDetail button[aria-label="Verify release"], .pluginAdminDetail button[aria-label="Xác minh bản phát hành"]')?.disabled);
    assert.equal(requests.filter((req) => req.endsWith("desktop.zip:0")).length, 1, "Resume uploaded chunk zero twice");

    const recovery = panel.getByRole("button", { name: l("Xóa và tạo lại bản nháp", "Delete and recreate draft"), exact: true });
    const recoverExpiredDraft = async (cancelFirst = false) => {
      await panel.getByText(l("Phiên tải lên đã hết hạn. Cần xóa và tạo lại bản nháp.", "Upload expired. Delete and recreate the draft to upload again."), { exact: true }).waitFor();
      assert.equal(await panel.getByRole("button", { name: l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry") }).count(), 0);
      assert.equal(await verify.count(), 0);
      assert.equal(await panel.locator(".pluginAdminAttach input").count(), 0);
      assert.deepEqual(await panel.locator("progress").evaluateAll((elements) => elements.map((element) => element.value)), [0, 0, 0]);
      assert.equal(await panel.getByText(l("Đã tải lên tất cả file. Sẵn sàng xác minh.", "All files uploaded. Ready to verify."), { exact: true }).count(), 0);
      if (cancelFirst) {
        const deletes = releaseRequests.filter((request) => request.method === "DELETE").length;
        await recovery.click();
        await page.locator("dialog").getByRole("button", { name: l("Hủy", "Cancel"), exact: true }).click();
        assert.equal(releaseRequests.filter((request) => request.method === "DELETE").length, deletes);
        assert.equal(await recovery.count(), 1);
      }
      const previousId = state.releases[0]._id;
      await recovery.click();
      await page.locator("dialog button[type=submit]").click();
      const draft = panel.locator(".pluginAdminDraft");
      await draft.waitFor();
      assert.equal(await draft.locator(".pluginAdminLocalFiles li").count(), 3);
      assert.deepEqual(JSON.parse(await draft.locator(".pluginAdminManifest pre").textContent()), manifest);
      await draft.getByRole("button", { name: l("Tạo bản nháp", "Create draft"), exact: true }).click();
      await panel.getByText(l("Đã tạo bản nháp.", "Draft created."), { exact: true }).waitFor();
      assert.notEqual(state.releases[0]._id, previousId);
      assert.equal(state.releases[0].version, manifest.version);
      assert.equal(await verify.isDisabled(), true);
      assert.deepEqual(await panel.locator("progress").evaluateAll((elements) => elements.map((element) => element.value)), [0, 0, 0]);
    };

    state.releases[0].uploadExpiredAt = new Date().toISOString();
    state.releases[0].error = "PLUGIN_RELEASE_UPLOAD_EXPIRED";
    chunks.clear();
    await panel.getByRole("button", { name: l("Làm mới danh sách", "Refresh releases") }).click();
    await recoverExpiredDraft(true);

    // A 410 must stay terminal even when the next list response has no expiry marker yet.
    expireUpload = true;
    await panel.getByRole("button", { name: l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry") }).click();
    await recoverExpiredDraft();
    await panel.getByRole("button", { name: l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry") }).click();
    await panel.getByText(l("Đã tải lên tất cả file. Sẵn sàng xác minh.", "All files uploaded. Ready to verify."), { exact: true }).waitFor();
    expireVerification = true;
    await verify.click();
    await recoverExpiredDraft();
    await panel.getByRole("button", { name: l("Tải lên / tiếp tục / thử lại", "Upload / resume / retry") }).click();
    await panel.getByText(l("Đã tải lên tất cả file. Sẵn sàng xác minh.", "All files uploaded. Ready to verify."), { exact: true }).waitFor();
    await verify.click();
    const publish = panel.getByRole("button", { name: l("Phát hành", "Publish release"), exact: true });
    await publish.click();
    await page.locator("dialog button[type=submit]").click();
    await panel.getByText(l("Đã phát hành.", "Release published."), { exact: true }).waitFor();
    await panel.getByRole("button", { name: l("Thu hồi bản phát hành", "Withdraw release") }).click();
    await page.locator("dialog button[type=submit]").click();
    await panel.getByText(l("Đã thu hồi.", "Release withdrawn."), { exact: true }).waitFor();
    await publish.click();
    await page.locator("dialog button[type=submit]").click();
    await panel.getByText(l("Đã phát hành.", "Release published."), { exact: true }).waitFor();
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidenceRoot, `admin-${language}-${theme}-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1), false, "Page overflow");
    await page.goto(origin + "/plugin#plugin-download");
    await page.getByRole("tab", { name: "3ds Max 2026-2027" }).click();
    assert.equal(await page.locator("#plugin-release-details a").getAttribute("href"), manifest.bridgeArtifacts[1].downloadUrl);

    const activeId = state.channels[0].activeReleaseId;
    const refreshDownloads = page.getByRole("button", { name: l("Làm mới bản tải", "Refresh downloads") });
    const heroCta = page.locator(".pluginHeroActions .pluginCta");
    const finalCta = page.locator(".pluginEndActions .pluginCta");
    let downloadsStarted;
    let finishDownloads;
    const startedDownloads = new Promise((resolve) => { downloadsStarted = resolve; });
    downloadsGate = { started: downloadsStarted, pending: new Promise((resolve) => { finishDownloads = resolve; }) };
    state.channels[0].activeReleaseId = null;
    await refreshDownloads.click();
    await startedDownloads;
    await page.locator(".pluginHeroActions .pluginCta[aria-disabled=true]").waitFor();
    await page.locator(".pluginEndActions .pluginCta[aria-disabled=true]").waitFor();
    assert.equal(await heroCta.getAttribute("aria-disabled"), "true");
    assert.equal((await heroCta.textContent()).trim(), l("Đang kiểm tra bản tải", "Checking downloads"));
    assert.equal(await finalCta.getAttribute("aria-disabled"), "true");
    finishDownloads();
    await page.locator("#plugin-download").getByText(l("Bản cài chưa sẵn sàng. Vui lòng quay lại sau.", "The installer is not available yet. Please check back later."), { exact: true }).waitFor();
    assert.equal((await heroCta.textContent()).trim(), l("Bản tải chưa sẵn sàng", "Download not available yet"));
    assert.equal(await heroCta.getAttribute("aria-disabled"), "true");

    state.channels[0].activeReleaseId = activeId;
    await refreshDownloads.click();
    await page.locator("#plugin-release-details").waitFor();
    assert.equal(await heroCta.getAttribute("href"), "/plugin#plugin-download");
    assert.equal(await finalCta.getAttribute("href"), "/plugin#plugin-download");
    assert.equal(await page.locator(".pluginReleaseNote").count(), 0);

    const demo = page.locator(".pluginHeroMedia img");
    await demo.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = globalThis.document.querySelector(".pluginHeroMedia img");
      return image?.complete && image.naturalWidth > 0;
    });
    const demoSrc = await demo.getAttribute("src");
    assert.equal(await demo.getAttribute("loading"), "eager");
    assert.equal(await demo.evaluate((image) => globalThis.getComputedStyle(image).objectFit), "contain");
    const demoBounds = await page.locator(".pluginHeroMedia").boundingBox();
    assert.ok(Math.abs(demoBounds.width / demoBounds.height - 16 / 9) < 0.02, "Demo frame keeps its aspect ratio");
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.screenshot({ path: path.join(evidenceRoot, `demo-${language}-${theme}-${width}.png`), fullPage: true });

    downloadsError = true;
    await refreshDownloads.click();
    await page.locator("#plugin-download").getByText(l("Không thể kiểm tra bản tải. Vui lòng thử lại.", "Could not check downloads. Please try again."), { exact: true }).waitFor();
    assert.equal(await heroCta.getAttribute("aria-disabled"), "true");
    assert.equal(await finalCta.getAttribute("aria-disabled"), "true");
    downloadsError = false;
    await refreshDownloads.click();
    await page.locator("#plugin-release-details").waitFor();
    assert.equal(await heroCta.getAttribute("href"), "/plugin#plugin-download");
    await page.screenshot({ path: path.join(evidenceRoot, `downloads-${language}-${theme}-${width}.png`), fullPage: true });
    let requestStarted;
    let releaseRequest;
    const started = new Promise((resolve) => { requestStarted = resolve; });
    const pending = new Promise((resolve) => { releaseRequest = resolve; });
    const delayedAdminRequest = async (route) => {
      requestStarted();
      await pending;
      await route.fulfill({ json: { users: [] } }).catch((error) => {
        if (!/disposed|closed|canceled|aborted/i.test(error.message)) throw error;
      });
    };
    await context.route("**/api/admin/users?*", delayedAdminRequest);
    await page.goto(origin + "/admin");
    await started;
    await page.locator(".brandButton").click();
    await page.waitForURL(origin + "/");
    const homeDemo = page.locator(".homePluginHero .pluginHeroMedia img");
    await homeDemo.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => {
      const image = globalThis.document.querySelector(".homePluginHero .pluginHeroMedia img");
      return image?.complete && image.naturalWidth > 0;
    });
    assert.equal(await homeDemo.getAttribute("src"), demoSrc);
    assert.equal(await homeDemo.getAttribute("loading"), "lazy");
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1), false, "Home page overflow");
    await page.evaluate(() => globalThis.scrollTo(0, 0));
    await page.screenshot({ path: path.join(evidenceRoot, `home-demo-${language}-${theme}-${width}.png`), fullPage: true });
    releaseRequest();
    await page.waitForTimeout(200);
    await context.unroute("**/api/admin/users?*", delayedAdminRequest);
    assert.deepEqual(errors, []);
    cases.push({ language, theme, width, uploadPauseResume: true, expiredUploadDeleteRecreate: true, uploadAndVerification410Recovery: true, sharedDownloadRefresh: true, verifyPublishWithdrawReselect: true, correctMaxDownload: true, responsiveDemoGif: true, lazyHomeDemoGif: true, adminRequestCancelledOnNavigation: true });
    await context.close();
  }
  await fs.writeFile(path.join(evidenceRoot, "browser-results.json"), JSON.stringify({ ok: true, api: "isolated browser fixtures; real HTTP authorization and service behavior covered separately", cases }, null, 2));
  console.log(JSON.stringify({ ok: true, cases }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
