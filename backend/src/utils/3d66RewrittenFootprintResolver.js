import crypto from "node:crypto";
import { assert3D66CleanModelUrl, required3D66AccountMarker } from "./3d66CleanLink.js";

const FOOTPRINT_URL = "https://user.3d66.com/newUser/index/index/footprint";
const MODEL_SELECTOR = 'a[href*="/reshtmla/"][href*="sof="]';
const verificationPages = new WeakMap();

export function get3D66VerificationPage(error) {
  return verificationPages.get(error);
}

function resolutionError(reason, status = 422) {
  const message = reason === "upstream_verification_required"
    ? "3D66 requires browser verification before a signed model link can be obtained. No purchase or download was attempted."
    : "Cannot obtain a verified model link from rewritten 3D66 history.";
  return Object.assign(new Error(message), {
    status, code: "THREED66_REWRITTEN_FOOTPRINT_FAILED",
    details: { stage: "rewritten-footprint", reason },
  });
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

function modelPage(value) {
  let url;
  try { url = new URL(value); } catch { throw resolutionError("invalid_source_url", 400); }
  if (url.protocol !== "https:" || url.origin !== "https://3d.3d66.com" || url.username || url.password
    || !/^\/reshtmla\/model\/items\/[^/]+\/[^/]+\.html$/.test(url.pathname)
    || url.pathname.endsWith("/items/id/model.html")) {
    throw resolutionError("a_real_3d_model_page_is_required", 400);
  }
  return url;
}

export function build3D66FootprintSeed(value) {
  const source = modelPage(value);
  const ids = source.searchParams.getAll("sof");
  if (ids.length !== 1 || source.searchParams.getAll("id").length > 1
    || source.searchParams.getAll("id").some((id) => id !== ids[0])) {
    throw resolutionError("missing_or_conflicting_model_id", 400);
  }
  const parts = ids[0].match(/^([A-Z]{3})(\d{5,28})$/i);
  if (!parts) throw resolutionError("invalid_source_model_id", 400);
  // Tracked IDs have an eight-digit sender marker; short public IDs contain only the asset suffix.
  const digits = parts[2];
  const suffix = digits.length >= 13 ? digits.slice(8) : digits.length <= 8 ? digits : "";
  if (!suffix) throw resolutionError("ambiguous_source_model_id", 400);
  const productId = `A${parts[1].slice(1).toUpperCase()}${required3D66AccountMarker()}${suffix}`;
  return {
    sourceProductId: ids[0], productId, modelPage: source.origin + source.pathname,
    url: `${source.origin}${source.pathname}?${new URLSearchParams({ sof: productId, st: "2" })}`,
  };
}

export function assert3D66RewrittenFootprintLink(value, seed) {
  const url = modelPage(value);
  if (url.origin + url.pathname !== seed.modelPage) throw resolutionError("model_page_mismatch");
  const productId = assert3D66CleanModelUrl(value, { expectedProductId: seed.productId });
  if (productId.toUpperCase() !== seed.productId) throw resolutionError("model_id_mismatch");
  return productId;
}

export function selectRewrittenFootprintCard(links, seed) {
  for (const [index, link] of links.entries()) {
    let url;
    try { url = new URL(link); } catch { continue; }
    if (!url.searchParams.getAll("sof").some((id) => id.toUpperCase() === seed.productId)) continue;
    modelPage(link);
    if (url.searchParams.getAll("sof").length !== 1 || url.searchParams.getAll("id").some((id) => id.toUpperCase() !== seed.productId)) {
      throw resolutionError("ambiguous_history_model_id");
    }
    url.hash = "";
    const canonicalModelPage = url.origin + url.pathname;
    if (url.searchParams.has("sign")) assert3D66RewrittenFootprintLink(url.href, { ...seed, modelPage: canonicalModelPage });
    return { url: url.href, productId: seed.productId, canonicalModelPage, index };
  }
  return null;
}

export async function resolveRewrittenFootprintPage({ page, seed, navigate, openHistoryLink, timeout = 30000,
  refreshAttempts = 4, refreshDelayMs = 1500, settleMs = 1200 }) {
  await navigate(page, seed.url);
  const opened = modelPage(page.url());
  if (opened.searchParams.getAll("sof").length !== 1
    || opened.searchParams.get("sof") !== seed.productId) throw resolutionError("seed_redirected");
  // An empty seed page is expected. Only a signed, exact history entry can authorize the next step.
  await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeout, 8000) }).catch(() => {});
  await page.waitForTimeout(Math.min(5000, Math.max(500, Number(settleMs) || 1200)));
  await assert3D66FootprintPageVerified(page);
  return resolveRewrittenFootprintHistory({ page, seed, navigate, openHistoryLink, timeout, refreshAttempts, refreshDelayMs });
}

export async function resolveRewrittenFootprintHistory({ page, seed, navigate, openHistoryLink, timeout = 30000,
  refreshAttempts = 4, refreshDelayMs = 1500 }) {
  const attempts = Math.min(8, Math.max(1, Math.floor(Number(refreshAttempts) || 4)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt) await page.waitForTimeout(Math.min(5000, Math.max(250, Number(refreshDelayMs) || 1500)));
    await navigate(page, FOOTPRINT_URL);
    const history = new URL(page.url());
    if (history.origin + history.pathname !== FOOTPRINT_URL || history.username || history.password) {
      throw resolutionError("history_redirected");
    }
    await page.locator(MODEL_SELECTOR).first().waitFor({ state: "attached", timeout: Math.min(timeout, 5000) }).catch(() => {});
    await assert3D66FootprintPageVerified(page);
    const links = await page.locator(MODEL_SELECTOR).evaluateAll((anchors) => anchors.slice(0, 500).map((anchor) => anchor.href));
    const selected = selectRewrittenFootprintCard(links, seed);
    if (selected) {
      const boundSeed = { ...seed, modelPage: selected.canonicalModelPage };
      const url = new URL(selected.url).searchParams.has("sign") ? selected.url
        : openHistoryLink ? await openHistoryLink(page, selected, boundSeed) : "";
      assert3D66RewrittenFootprintLink(url, boundSeed);
      return { url, productId: seed.productId, usedFootprint: true, canonicalModelPage: selected.canonicalModelPage };
    }
  }
  throw resolutionError("signed_model_not_found_in_history");
}

export function create3D66RewrittenFootprintResolver({ withBrowserContext, navigate, serializeCookies, openHistoryLink,
  timeoutMs = () => 30000, settleMs = () => 1200 }) {
  const pending = new Map();
  return async (url, cookieValue) => {
    const seed = build3D66FootprintSeed(url);
    const key = crypto.createHash("sha256").update(JSON.stringify([cookieValue, seed.url])).digest("hex");
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try {
        return await withBrowserContext(seed.url, cookieValue, async ({ page, context }) => {
          const result = await resolveRewrittenFootprintPage({ page, seed, navigate,
            openHistoryLink: openHistoryLink ? (page, card, boundSeed) => openHistoryLink(page, card, boundSeed, context) : undefined,
            timeout: timeoutMs(), settleMs: settleMs(),
            refreshAttempts: process.env.THREED66_FOOTPRINT_REFRESH_ATTEMPTS,
            refreshDelayMs: process.env.THREED66_FOOTPRINT_REFRESH_DELAY_MS });
          return { ...result, cookieValue: serializeCookies(await context.cookies()) || cookieValue };
        }, { allowProxyFallback: false, rewrittenFootprintSeed: seed });
      } catch (error) {
        if (error.code === "THREED66_CLEAN_LINK_REQUIRED" || is3D66RewrittenFootprintError(error)) throw error;
        throw resolutionError("history_operation_interrupted", 502);
      }
    })();
    pending.set(key, task);
    try { return await task; }
    finally { if (pending.get(key) === task) pending.delete(key); }
  };
}
