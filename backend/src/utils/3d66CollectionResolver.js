import { assert3D66CleanModelUrl, modelIdsShareAssetIdentity } from "./3d66CleanLink.js";

function collectionError(reason, status = 422) {
  return Object.assign(new Error("Cannot resolve a verified model link from the configured 3D66 collection."), {
    status, code: "THREED66_COLLECTION_RESOLUTION_FAILED", details: { stage: "collection-resolution", reason },
  });
}

export function is3D66CollectionError(error) {
  return String(error?.code || "").startsWith("THREED66_COLLECTION_");
}

export function collectionResolutionConfig(env = process.env) {
  const id = String(env.THREED66_COLLECTION_ID || "").trim();
  const user = String(env.THREED66_COLLECTION_USER || "").trim();
  if (!/^[1-9]\d{0,18}$/.test(id) || !/^[A-Z]{3}\d{5,20}$/.test(user)) {
    throw collectionError("invalid_collection_configuration", 503);
  }
  return {
    id, user,
    profileUrl: `https://user.3d66.com/inspiration/another/${user}`,
    detailUrl: `https://user.3d66.com/inspiration/favorites_other/detail?id=${id}&res_type=1&aui=${user}`,
  };
}

export function collectionModelPage(value) {
  let url;
  try { url = new URL(value); } catch { throw collectionError("invalid_source_model"); }
  if (url.protocol !== "https:" || url.hostname !== "3d.3d66.com" || url.username || url.password || url.port
    || !/^\/reshtml[a-z]*\/model\/items\/.+\.html$/i.test(url.pathname)
    || url.pathname.endsWith("/items/id/model.html") || url.searchParams.getAll("sof").length > 1
    || url.searchParams.getAll("id").length > 1
    || (url.searchParams.get("sof") && url.searchParams.get("id") && url.searchParams.get("sof") !== url.searchParams.get("id"))) {
    throw collectionError("a_real_3d_model_page_is_required", 400);
  }
  url.hash = "";
  return url;
}

function isCollectionPage(value, config) {
  try {
    const url = new URL(value);
    return url.origin === "https://user.3d66.com" && !url.username && !url.password
      && url.pathname === "/inspiration/favorites_other/detail"
      && ["id", "res_type", "aui"].every((key) => url.searchParams.getAll(key).length === 1)
      && url.searchParams.get("id") === config.id && url.searchParams.get("res_type") === "1"
      && url.searchParams.get("aui") === config.user;
  } catch { return false; }
}

async function hrefs(page, selector) {
  return page.locator(selector).evaluateAll((anchors) => anchors.slice(0, 500).map((anchor) => anchor.href));
}

export function selectCollectionModelLink(links, sourceUrl, expectedProductId) {
  const source = collectionModelPage(sourceUrl);
  const matches = [];
  for (const link of links) {
    let url;
    try { url = new URL(link); } catch { continue; }
    if (url.origin !== source.origin || url.pathname !== source.pathname) continue;
    const productId = assert3D66CleanModelUrl(link, { expectedProductId });
    matches.push({ url: link, productId });
  }
  if (new Set(matches.map((item) => item.productId)).size > 1) throw collectionError("ambiguous_model_links");
  return matches[0] || null;
}

export async function resolve3D66CollectionPage({ page, url, config, expectedProductId = "", navigate,
  timeout = 30000, refreshAttempts = 3, refreshDelayMs = 1500, maxPages = 5 }) {
  const source = collectionModelPage(url);
  await navigate(page, source.href);
  if (collectionModelPage(page.url()).pathname !== source.pathname) throw collectionError("source_redirected_to_another_model");
  const collect = page.locator(".collect-btn.details-gallery-favorites");
  await collect.waitFor({ state: "visible", timeout });
  const modelId = String(await collect.getAttribute("data-sof") || "").trim();
  if (!/^[A-Z]{3}\d{6,}$/i.test(modelId)
    || (expectedProductId && !modelIdsShareAssetIdentity(modelId, expectedProductId))) {
    throw collectionError("source_model_identity_mismatch");
  }
  await collect.click({ timeout });
  const collection = page.locator(`li[data-id="${config.id}"][data-type="1"]`);
  await collection.waitFor({ state: "visible", timeout });
  if (await collection.count() !== 1) throw collectionError("ambiguous_collection_selection");
  const saved = /(?:^|\s)active(?:\s|$)/.test(await collection.getAttribute("class") || "")
    || (await collection.locator(".btn-type-favorite").textContent() || "").trim() === "已收藏";
  if (!saved) {
    await collection.click({ timeout });
    // The collection page is the authoritative save check; allow the save XHR to settle first.
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 8000) }).catch(() => {});
  }
  await navigate(page, config.profileUrl);
  if (page.url() !== config.profileUrl) throw collectionError("collection_profile_redirected");
  const entries = await hrefs(page, 'a[href*="/inspiration/favorites_other/detail"]');
  const entry = entries.find((href) => isCollectionPage(href, config)) || config.detailUrl;
  const attempts = Math.min(5, Math.max(1, Math.floor(Number(refreshAttempts) || 3)));
  const pageLimit = Math.min(10, Math.max(1, Math.floor(Number(maxPages) || 5)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await page.waitForTimeout(Math.min(5000, Math.max(250, Number(refreshDelayMs) || 1500)));
    let current = entry;
    const visited = new Set();
    while (current && visited.size < pageLimit) {
      visited.add(current);
      await navigate(page, current);
      if (!isCollectionPage(page.url(), config)) throw collectionError("collection_page_redirected");
      await page.locator("a.box-images[href]").first().waitFor({ state: "attached", timeout: Math.min(timeout, 5000) }).catch(() => {});
      const selected = selectCollectionModelLink(await hrefs(page, "a.box-images[href]"), source.href, modelId);
      if (selected) return { ...selected, usedCollection: true };
      const next = await hrefs(page, 'a[rel="next"][href], a.next[href], a.layui-laypage-next[href]');
      current = next.find((href) => isCollectionPage(href, config) && !visited.has(href)) || "";
    }
  }
  throw collectionError("model_not_found_in_collection");
}

export function create3D66CollectionResolver({ withBrowserContext, navigate, serializeCookies, timeoutMs = () => 30000 }) {
  const pending = new Map();
  return async (url, cookieValue, expectedProductId = "", config = collectionResolutionConfig()) => {
    collectionModelPage(url);
    const key = `${config.user}:${config.id}`;
    const previous = pending.get(key) || Promise.resolve();
    const task = previous.catch(() => {}).then(() => withBrowserContext(url, cookieValue, async ({ page, context }) => {
      try {
        const result = await resolve3D66CollectionPage({ page, url, config, expectedProductId, navigate, timeout: timeoutMs(),
          refreshAttempts: process.env.THREED66_COLLECTION_REFRESH_ATTEMPTS,
          refreshDelayMs: process.env.THREED66_COLLECTION_REFRESH_DELAY_MS,
          maxPages: process.env.THREED66_COLLECTION_MAX_PAGES });
        return { ...result, cookieValue: serializeCookies(await context.cookies()) || cookieValue };
      } catch (error) {
        if (error.code === "THREED66_CLEAN_LINK_REQUIRED" || is3D66CollectionError(error)) throw error;
        throw collectionError("collection_operation_interrupted");
      }
    }, { allowProxyFallback: false }));
    pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}
