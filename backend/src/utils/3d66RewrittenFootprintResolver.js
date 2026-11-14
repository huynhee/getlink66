import crypto from "node:crypto";
import { assert3D66CleanModelUrl, assert3D66AccountProductId, modelIdsShareExactAssetIdentity,
  required3D66AccountMarker } from "./3d66CleanLink.js";

const FOOTPRINT_URL = "https://user.3d66.com/newUser/index/index/footprint";
export const FOOTPRINT_MODEL_SELECTOR = 'a[href*="/items/"][href*="sof="]';
const RESOURCE_PATHS = {
  "3d.3d66.com": /^\/reshtmla\/model\/items\/[^/]+\/[^/]+\.html$/,
  "su.3d66.com": /^\/reshtmla\/sketchup\/items\/[^/]+\/[^/]+\.html$/,
  "cad.3d66.com": /^\/reshtmla\/cad\/items\/[^/]+\/[^/]+\.html$/,
  "tietu.3d66.com": /^\/reshtmla\/tietu\/items\/[^/]+\/[^/]+\.html$/,
  "fanganwenben.3d66.com": /^\/(?:reshtmla\/fanganwenben\/items\/[^/]+|items)\/[^/]+\.html$/,
  "xiaoguotu.3d66.com": /^\/(?:imghtml\/items\/[^/]+|items)\/[^/]+\.html$/,
};
const verificationPages = new WeakMap();
const NETWORK_CODES = new Set(["ERR_ABORTED", "ERR_FAILED", "ERR_BLOCKED_BY_CLIENT", "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_RESET", "ERR_CONNECTION_REFUSED", "ERR_CONNECTION_TIMED_OUT", "ERR_TIMED_OUT",
  "ERR_NETWORK_CHANGED", "ERR_NAME_NOT_RESOLVED", "ERR_INTERNET_DISCONNECTED", "ERR_PROXY_CONNECTION_FAILED"]);

export function get3D66VerificationPage(error) {
  return verificationPages.get(error);
}

function resolutionError(reason, status = 422, diagnostics = {}) {
  const message = reason === "upstream_verification_required"
    ? "3D66 requires browser verification before a signed model link can be obtained. No purchase or download was attempted."
    : "Cannot obtain a verified model link from rewritten 3D66 history.";
  return Object.assign(new Error(message), {
    status, code: "THREED66_REWRITTEN_FOOTPRINT_FAILED",
    details: { stage: "rewritten-footprint", reason, ...diagnostics },
  });
}

function interruptedNavigation(error) {
  return /net::ERR_ABORTED\b|interrupted by another navigation/i.test(String(error?.message || ""));
}

async function historyOperation(operation, run) {
  try { return await run(); }
  catch (error) {
    if (error?.code === "THREED66_CLEAN_LINK_REQUIRED" || is3D66RewrittenFootprintError(error)
      || /^THREED66_(?:PROFILE_|VERIFICATION_SESSION$)/.test(error?.code || "")) throw error;
    const message = String(error?.cause?.message || error?.message || "");
    const matchedCode = message.match(/\bnet::(ERR_[A-Z_]+)\b/)?.[1];
    const networkCode = NETWORK_CODES.has(matchedCode) ? matchedCode : undefined;
    const failure = networkCode ? "network" : error?.name === "TimeoutError" || /\btimeout|timed out\b/i.test(message)
      ? "timeout" : /target.*closed|browser.*closed|context.*closed/i.test(message) ? "browser_closed" : "unexpected_error";
    // Playwright messages can contain signed URLs. Expose only fixed stages and bounded error categories.
    throw resolutionError("history_operation_interrupted", 502, { operation, failure, ...(networkCode ? { networkCode } : {}) });
  }
}

export function is3D66FootprintHome(value) {
  try {
    const url = new URL(value);
    return ["3d66.com", "www.3d66.com", ...Object.keys(RESOURCE_PATHS)].includes(url.hostname)
      && url.protocol === "https:" && !url.port
      && !url.username && !url.password && url.pathname === "/" && !url.search;
  } catch { return false; }
}

export function is3D66RewrittenFootprintError(error) {
  return error?.code === "THREED66_REWRITTEN_FOOTPRINT_FAILED";
}

export async function assert3D66FootprintPageVerified(page) {
  const title = (await page.title()).trim();
  if (/^(?:滑动验证(?:页面)?|安全验证|访问验证|captcha|security verification|verification required)$/i.test(title)) {
    const error = resolutionError("upstream_verification_required", 403);
    verificationPages.set(error, page);
    throw error;
  }
}

export function is3D66FootprintModelPage(value) {
  try {
    const url = new URL(value);
    const pattern = RESOURCE_PATHS[url.hostname];
    return Boolean(pattern && url.protocol === "https:" && !url.port && !url.username && !url.password
      && pattern.test(url.pathname)
      && !url.pathname.endsWith("/items/id/model.html"));
  } catch { return false; }
}

function modelPage(value) {
  let url;
  try { url = new URL(value); } catch { throw resolutionError("invalid_source_url", 400); }
  if (!is3D66FootprintModelPage(url)) {
    throw resolutionError("a_real_3d_model_page_is_required", 400);
  }
  return url;
}

export function build3D66FootprintSeed(value) {
  const source = modelPage(value);
  const ids = source.searchParams.getAll("sof");
  if (ids.length !== 1 || source.searchParams.getAll("sign").length > 1 || source.searchParams.getAll("id").length > 1
    || source.searchParams.getAll("id").some((id) => id !== ids[0])) {
    throw resolutionError("missing_or_conflicting_model_id", 400);
  }
  const parts = ids[0].match(/^([A-Z]{3})(\d{5,28})$/i);
  if (!parts) throw resolutionError("invalid_source_model_id", 400);
  // Tracked IDs have an eight-digit sender marker; short public IDs contain only the asset suffix.
  const digits = parts[2];
  const marker = required3D66AccountMarker();
  const suffix = digits.startsWith(marker) && digits.length - marker.length >= 5 ? digits.slice(marker.length)
    : digits.length >= 13 ? digits.slice(8) : digits.length <= 8 ? digits : "";
  if (!suffix) throw resolutionError("ambiguous_source_model_id", 400);
  const productId = `A${parts[1].slice(1).toUpperCase()}${marker}${suffix}`;
  const sourceFirst = source.hostname !== "3d.3d66.com";
  source.hash = "";
  return {
    sourceProductId: ids[0], productId, modelPage: source.origin + source.pathname,
    url: sourceFirst ? source.href : `${source.origin}${source.pathname}?${new URLSearchParams({ sof: productId, st: "2" })}`,
    ...(sourceFirst ? { sourceFirst: true } : {}),
  };
}

export function footprintLookupKey(seed, page = seed.modelPage) {
  return JSON.stringify([seed.sourceFirst ? "source-history" : "rewritten-history", page,
    seed.sourceFirst ? `A${seed.productId.slice(1)}` : seed.productId]);
}

export function assert3D66RewrittenFootprintLink(value, seed) {
  const url = modelPage(value);
  if (url.origin + url.pathname !== seed.modelPage
    || url.origin !== modelPage(seed.url || seed.modelPage).origin) throw resolutionError("model_page_mismatch");
  const productId = assert3D66CleanModelUrl(value, { expectedProductId: seed.productId });
  if (productId.toUpperCase() !== seed.productId && !(seed.sourceFirst
    && modelIdsShareExactAssetIdentity(productId, seed.productId))) throw resolutionError("model_id_mismatch");
  return productId;
}

export function selectRewrittenFootprintCard(links, seed) {
  const origin = modelPage(seed.url || seed.modelPage).origin;
  for (const [index, link] of links.entries()) {
    let url;
    try { url = new URL(link); } catch { continue; }
    const matches = id => {
      if (!seed.sourceFirst) return id.toUpperCase() === seed.productId;
      try { assert3D66AccountProductId(id); }
      catch { return false; }
      return modelIdsShareExactAssetIdentity(id, seed.productId);
    };
    if (!url.searchParams.getAll("sof").some(matches)) continue;
    modelPage(link);
    if (url.origin !== origin) continue;
    const productId = url.searchParams.get("sof").toUpperCase();
    if (url.searchParams.getAll("sof").length !== 1 || url.searchParams.getAll("id").some((id) => id.toUpperCase() !== productId)) {
      throw resolutionError("ambiguous_history_model_id");
    }
    url.hash = "";
    const canonicalModelPage = url.origin + url.pathname;
    if (url.searchParams.has("sign")) assert3D66RewrittenFootprintLink(url.href, { ...seed, productId, modelPage: canonicalModelPage });
    return { url: url.href, productId, canonicalModelPage, index };
  }
  return null;
}

export async function resolveRewrittenFootprintPage({ page, seed, navigate, navigateSeed = navigate, openHistoryLink, timeout = 30000,
  refreshAttempts = 4, refreshDelayMs = 1500, settleMs = 1200 }) {
  await historyOperation("seed_navigation", async () => {
    let navigationError;
    try { await navigateSeed(page, seed.url); }
    catch (error) {
      if (!interruptedNavigation(error)) throw error;
      navigationError = error;
    }
    await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeout, 8000) }).catch(() => {});
    await page.waitForTimeout(Math.min(5000, Math.max(500, Number(settleMs) || 1200)));
    await assert3D66FootprintPageVerified(page);
    // The seed can register a view and redirect home. That landing never authorizes a download.
    if (!is3D66FootprintHome(page.url())) {
      if (navigationError) throw navigationError;
      const opened = modelPage(page.url());
      const visitId = seed.sourceFirst ? seed.sourceProductId : seed.productId;
      if (opened.origin !== new URL(seed.url).origin || opened.searchParams.getAll("sof").length !== 1
        || opened.searchParams.getAll("id").some(id => id !== opened.searchParams.get("sof"))) throw resolutionError("seed_redirected");
      if (opened.searchParams.get("sof") !== visitId) {
        if (!seed.sourceFirst) throw resolutionError("seed_redirected");
        assert3D66RewrittenFootprintLink(opened.href, { ...seed, modelPage: opened.origin + opened.pathname });
      }
    }
  });
  return resolveRewrittenFootprintHistory({ page, seed, navigate, openHistoryLink, timeout, refreshAttempts, refreshDelayMs });
}

export async function resolveRewrittenFootprintHistory({ page, seed, navigate, openHistoryLink, timeout = 30000,
  refreshAttempts = 4, refreshDelayMs = 1500 }) {
  const attempts = Math.min(8, Math.max(1, Math.floor(Number(refreshAttempts) || 4)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await page.waitForTimeout(Math.min(5000, Math.max(250, Number(refreshDelayMs) || 1500)));
    const links = await historyOperation("history_read", async () => {
      await navigate(page, FOOTPRINT_URL);
      const history = new URL(page.url());
      if (history.origin + history.pathname !== FOOTPRINT_URL || history.username || history.password) {
        throw resolutionError("history_redirected");
      }
      await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeout, 8000) }).catch(() => {});
      await page.locator(FOOTPRINT_MODEL_SELECTOR).first().waitFor({ state: "attached", timeout: Math.min(timeout, 5000) }).catch(() => {});
      await assert3D66FootprintPageVerified(page);
      return page.locator(FOOTPRINT_MODEL_SELECTOR).evaluateAll((anchors) => anchors.slice(0, 500).map((anchor) => anchor.href));
    });
    const selected = selectRewrittenFootprintCard(links, seed);
    if (selected) {
      const boundSeed = { ...seed, productId: selected.productId, modelPage: selected.canonicalModelPage };
      const opened = new URL(selected.url).searchParams.has("sign") ? selected.url
        : openHistoryLink ? await historyOperation("history_card_open", () => openHistoryLink(page, selected, boundSeed)) : "";
      const url = typeof opened === "string" ? opened : opened.url;
      const canonicalModelPage = typeof opened === "string" ? boundSeed.modelPage : opened.canonicalModelPage;
      assert3D66RewrittenFootprintLink(url, { ...boundSeed, modelPage: canonicalModelPage });
      return { url, productId: selected.productId, usedFootprint: true, canonicalModelPage };
    }
  }
  throw resolutionError("signed_model_not_found_in_history");
}

export function create3D66RewrittenFootprintResolver({ withBrowserContext, navigate, navigateSeed = navigate, serializeCookies, openHistoryLink,
  timeoutMs = () => 30000, settleMs = () => 1200 }) {
  const pending = new Map();
  return async (url, cookieValue) => {
    const seed = build3D66FootprintSeed(url);
    const key = crypto.createHash("sha256").update(JSON.stringify([cookieValue, seed.url])).digest("hex");
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      return historyOperation("browser_context", async () => {
        return await withBrowserContext(seed.url, cookieValue, async ({ page, context }) => {
          const result = await resolveRewrittenFootprintPage({ page, seed, navigate, navigateSeed,
            openHistoryLink: openHistoryLink ? (page, card, boundSeed) => openHistoryLink(page, card, boundSeed, context) : undefined,
            timeout: timeoutMs(), settleMs: settleMs(),
            refreshAttempts: process.env.THREED66_FOOTPRINT_REFRESH_ATTEMPTS,
            refreshDelayMs: process.env.THREED66_FOOTPRINT_REFRESH_DELAY_MS });
          return historyOperation("session_save", async () => ({ ...result, cookieValue: serializeCookies(await context.cookies()) || cookieValue }));
        }, { allowProxyFallback: false, rewrittenFootprintSeed: seed, readOnly: true });
      });
    })();
    pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}
