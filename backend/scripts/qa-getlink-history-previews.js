import assert from "node:assert/strict";
import path from "node:path";

const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jJ1sAAAAASUVORK5CYII=", "base64");

export async function verifyGetlinkHistoryPreviews(page, context, { origin, screenshotRoot, viewport }) {
  const items = [
    { _id: "preview-active", title: "Downloaded model with a deliberately long title for mobile wrapping", productId: "AJI896357712130659", imageUrl: `${origin}/api/getlink/preview-cache/active`, canRedownload: true },
    { _id: "preview-expired", title: "Expired download", productId: "AJI896357714859465", imageUrl: `${origin}/api/getlink/preview-cache/expired`, canRedownload: false },
    { _id: "preview-broken", title: "Unavailable preview", productId: "AJI896357710444152", imageUrl: `${origin}/api/getlink/preview-cache/broken`, canRedownload: false },
    { _id: "preview-missing", title: "Legacy download without an image", productId: "AJI896357717972535", imageUrl: "", canRedownload: false },
  ].map((item) => ({ ...item, creditUsed: 28, createdAt: "2026-10-07T09:00:00Z", redownloadExpiresAt: "2099-01-01T00:00:00Z", redownloadRemaining: 5, redownloadLimit: 5 }));
  const historyHandler = (route) => route.fulfill({ json: { history: items } });
  const timelineHandler = (route) => route.fulfill({ json: {
    events: new URL(route.request().url()).searchParams.get("type") === "credit" ? [] : items.map((item) => ({
      id: `getlink:${item._id}`, type: "getlink", title: item.title, status: "approved", amount: -28,
      createdAt: item.createdAt, metadata: { ...item, historyId: item._id, previewImageUrl: item.imageUrl },
    })),
    pagination: { page: 1, totalPages: 1, total: 4 },
  } });
  const imageRequests = [];
  const imageHandler = (route) => {
    const pathname = new URL(route.request().url()).pathname;
    imageRequests.push(pathname);
    return pathname.endsWith("/broken")
      ? route.fulfill({ status: 404, body: "Preview unavailable" })
      : route.fulfill({ contentType: "image/png", body: PIXEL });
  };
  const jobHandler = (route) => route.fulfill({ json: { job: null } });
  const patterns = ["**/api/getlink/history", "**/api/history/timeline?*", "**/api/getlink/preview-cache/*", "**/api/getlink/jobs/latest"];
  const handlers = [historyHandler, timelineHandler, imageHandler, jobHandler];
  const mutations = [];
  const track = (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/getlink") && request.method() !== "GET") mutations.push(request.url());
  };
  const preferences = await page.evaluate(() => ({ language: localStorage.getItem("language"), theme: localStorage.getItem("3dipl-theme") }));
  page.on("request", track);
  for (let index = 0; index < patterns.length; index += 1) await context.route(patterns[index], handlers[index]);
  try {
    for (const language of ["vi", "en"]) for (const theme of ["light", "dark"]) {
      await page.evaluate(({ language, theme }) => {
        localStorage.setItem("language", language);
        localStorage.setItem("3dipl-theme", theme);
      }, { language, theme });
      for (const screen of ["getlink", "history"]) {
        await page.goto(`${origin}/${screen}${screen === "history" ? "?type=getlink" : ""}`, { waitUntil: "domcontentloaded" });
        const list = page.locator(screen === "getlink" ? ".compactHistoryTable" : ".timelineHistoryList").first();
        await list.locator(".getlinkHistoryThumbnail").first().waitFor();
        await list.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => globalThis.document.querySelectorAll(".getlinkHistoryThumbnailEmpty").length === 2);
        assert.equal(await list.locator(".getlinkHistoryThumbnail").count(), 4);
        assert.equal(await list.locator("a.getlinkHistoryThumbnail").count(), 2);
        assert.equal(await list.locator(".getlinkHistoryThumbnailEmpty").count(), 2);
        assert.equal(await list.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
        assert.ok(await list.locator('img[src$="/active"]').evaluate((img) => img.complete && img.naturalWidth > 0));
        const expiry = screen === "getlink" ? list.locator(".tableRow").nth(1) : list.locator(".timelineEventCard").nth(1);
        assert.equal(await expiry.locator("img").count(), 1);
        if (screen === "getlink") assert.equal(await expiry.locator(".historyExpired").count(), 1);
        else assert.equal(await expiry.getByRole("button").isDisabled(), true);
        await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-${screen}-previews-${language}-${theme}.png`) });
        const popupPromise = context.waitForEvent("page");
        await list.locator("a.getlinkHistoryThumbnail").first().click();
        const popup = await popupPromise;
        await popup.waitForURL(`${origin}/api/getlink/preview-cache/active`);
        await popup.close();
      }
    }
    assert.ok(imageRequests.length > 0);
    assert.deepEqual(mutations, [], "Viewing previews must not prepare downloads, buy models, or charge Credit");
  } catch (error) {
    await page.screenshot({ path: path.join(screenshotRoot, `${viewport}-getlink-preview-failure.png`), fullPage: true });
    throw error;
  } finally {
    page.off("request", track);
    for (let index = 0; index < patterns.length; index += 1) await context.unroute(patterns[index], handlers[index]);
    await page.evaluate((preferences) => {
      for (const [key, value] of [["language", preferences.language], ["3dipl-theme", preferences.theme]]) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
    }, preferences);
  }
}
