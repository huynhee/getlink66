import crypto from "crypto";
import { ProxyAgent } from "undici";
import {
  download3D66WithBrowser,
  fetch3D66PageWithBrowser,
  inspect3D66DownloadFormatsWithBrowser,
  resolve3D66ModelUrlFromFootprint,
} from "./3d66BrowserService.js";
import {
  close3D66ProxyPolicy,
  create3D66ProxyConnectionError,
  get3D66ProxyUrl,
  mask3D66ProxyUrl,
  resolve3D66ProxyRoute,
  shouldFallback3D66ProxyFailure,
} from "./3d66ProxyPolicy.js";
import { notify3D66ProxyFallback } from "./telegramNotifier.js";

const DEFAULT_DOWNLOAD_ENDPOINT = "https://user.3d66.com/api/v1/download/handle";
const DEFAULT_DOWNLOAD_POP_ENDPOINT = "https://user.3d66.com/api/v1/download/pop";
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_HTML_LENGTH = 2 * 1024 * 1024;
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";
const ACCOUNT_SEARCH_ENDPOINT = "https://www.3d66.com/api/v1/search/checkKeyword";
const SEARCH_REFERER = "https://user.3d66.com/";
const MODEL_RESOLVE_MODES = new Set(["search", "footprint", "direct"]);
const FOOTPRINT_CACHE_TTL_MS = 2 * 60 * 1000;
const FOOTPRINT_CACHE_MAX = 500;
const PROXY_AGENT_CACHE_MAX = 5;
const proxyAgentCache = new Map();
const footprintModelUrlCache = new Map();
const DEFAULT_SITE_CONTEXTS = {
  "3d.3d66.com": {
    site: "1",
    pageType: "5",
    accessSourceSite: "1",
    accessSourcePage: "5",
    fileFormat: "1"
  },
  "su.3d66.com": {
    site: "6",
    pageType: "5",
    accessSourceSite: "6",
    accessSourcePage: "5"
  },
  "tietu.3d66.com": {
    site: "5",
    pageType: "5",
    accessSourceSite: "5",
    accessSourcePage: "1"
  },
  "cad.3d66.com": {
    site: "8",
    pageType: "5",
    accessSourceSite: "8",
    accessSourcePage: "5"
  },
  "xiaoguotu.3d66.com": {
    site: "10",
    pageType: "5",
    accessSourceSite: "10",
    accessSourcePage: "5"
  },
  "fanganwenben.3d66.com": {
    site: "12",
    pageType: "5",
    accessSourceSite: "12",
    accessSourcePage: "5"
  },
  "linggantu.3d66.com": {
    site: "6",
    pageType: "5",
    accessSourceSite: "6",
    accessSourcePage: "5"
  },
  "3d66.com": {
    site: "2",
    pageType: "5",
    accessSourceSite: "2",
    accessSourcePage: "5"
  },
  "www.3d66.com": {
    site: "2",
    pageType: "5",
    accessSourceSite: "2",
    accessSourcePage: "5"
  }
};

function httpError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === 1 || value === true;
}

function proxyDispatcher(urlValue, stage) {
  try {
    const parsed = new URL(urlValue);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Proxy URL must use http:// or https://");
    }
  } catch (error) {
    throw httpError("3D66 proxy URL is invalid", 500, {
      stage,
      proxy: mask3D66ProxyUrl(urlValue),
      cause: error.message,
    });
  }

  if (!proxyAgentCache.has(urlValue)) {
    while (proxyAgentCache.size >= PROXY_AGENT_CACHE_MAX) {
      const oldestKey = proxyAgentCache.keys().next().value;
      if (!oldestKey) break;
      const oldestAgent = proxyAgentCache.get(oldestKey);
      proxyAgentCache.delete(oldestKey);
      Promise.resolve(oldestAgent?.close?.()).catch(() => {});
    }
    proxyAgentCache.set(urlValue, new ProxyAgent(urlValue));
  }
  return proxyAgentCache.get(urlValue);
}

export async function close3D66ProxyAgents() {
  const agents = [...proxyAgentCache.values()];
  proxyAgentCache.clear();
  await Promise.allSettled([
    ...agents.map((agent) => Promise.resolve(agent?.close?.())),
    close3D66ProxyPolicy(),
  ]);
}

async function fetch3D66(url, options = {}, { stage = "api" } = {}) {
  const route = await resolve3D66ProxyRoute(stage, url);

  if (route.fallback) {
    notify3D66ProxyFallback({
      stage,
      proxy: mask3D66ProxyUrl(get3D66ProxyUrl()),
      error: route.error,
    });
    return fetch(url, options);
  }
  if (!route.useProxy) return fetch(url, options);

  let dispatcher;
  try {
    dispatcher = proxyDispatcher(route.proxyUrl, stage);
  } catch (error) {
    if (shouldFallback3D66ProxyFailure(stage)) {
      notify3D66ProxyFallback({
        stage,
        proxy: mask3D66ProxyUrl(get3D66ProxyUrl()),
        error,
      });
      return fetch(url, options);
    }
    throw error;
  }

  try {
    return await fetch(url, { ...options, dispatcher });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (shouldFallback3D66ProxyFailure(stage)) {
      notify3D66ProxyFallback({
        stage,
        proxy: mask3D66ProxyUrl(get3D66ProxyUrl()),
        error,
      });
      return fetch(url, options);
    }
    throw create3D66ProxyConnectionError(stage, error);
  }
}

function requestedProductIdFromUrl(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    return parsed.searchParams.get("sof") || parsed.searchParams.get("id") || productIdFromPath(parsed.pathname);
  } catch {
    return "";
  }
}

function requestedProductIdCandidatesFromUrl(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    const candidates = [
      parsed.searchParams.get("sof"),
      parsed.searchParams.get("id"),
      productIdFromPath(parsed.pathname),
    ];
    const hash = decodeURIComponent(String(parsed.hash || "").replace(/^#/, ""));
    const hashCandidates = hash.match(/(?:^|&)candidates=([^&]+)/)?.[1] || "";
    if (hashCandidates) candidates.push(...hashCandidates.split(","));
    return [...new Set(candidates.map(safeSearchKeyword).filter(Boolean))];
  } catch {
    return [];
  }
}

function isGeneratedModelIdUrl(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
    return hashParams.get("input") === "model-id";
  } catch {
    return false;
  }
}

function isFootprintResolvedUrl(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
    return hashParams.get("resolved") === "footprint";
  } catch {
    return false;
  }
}

function footprintLogicalProductId(rawUrl = "") {
  try {
    const parsed = new URL(rawUrl);
    const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
    return safeSearchKeyword(hashParams.get("logical") || "");
  } catch {
    return "";
  }
}

function stripInternalUrlHash(rawUrl = "") {
  const parsed = normalizeModelUrl(rawUrl);
  parsed.hash = "";
  return parsed.toString();
}

function markFootprintResolvedUrl(rawUrl = "", logicalProductId = "") {
  const parsed = normalizeModelUrl(rawUrl);
  const hashParams = new URLSearchParams(String(parsed.hash || "").replace(/^#/, ""));
  hashParams.set("resolved", "footprint");
  const logicalId = safeSearchKeyword(logicalProductId);
  if (logicalId) hashParams.set("logical", logicalId);
  parsed.hash = hashParams.toString();
  return parsed.toString();
}

function productIdFromPath(pathname = "") {
  const numericIds = [...String(pathname || "").matchAll(/(\d{6,})/g)].map((match) => match[1]);
  if (numericIds.length) return numericIds.sort((a, b) => b.length - a.length)[0];
  return "";
}

function safeSearchKeyword(value = "") {
  const keyword = String(value || "").trim();
  return /^[A-Z0-9_-]{6,64}$/i.test(keyword) ? keyword : "";
}

function safeAccountModelUrl(rawUrl, productId) {
  const normalized = normalizeModelUrl(rawUrl);
  const next = new URL(normalized.origin + normalized.pathname);
  const keyword = safeSearchKeyword(productId);
  if (keyword) {
    next.searchParams.set("kw", keyword);
    next.searchParams.set("sof", keyword);
  }
  next.searchParams.set("alichlgref", SEARCH_REFERER);
  return next.toString();
}

function isExactModelPageUrl(candidateUrl = "", productId = "") {
  const keyword = safeSearchKeyword(productId);
  if (!keyword) return false;
  try {
    const parsed = new URL(candidateUrl);
    if (!isAllowed3D66Host(parsed.hostname)) return false;
    if (!/(?:\/reshtml[a-z]*\/|\/items\/)/i.test(parsed.pathname) || !/\.html$/i.test(parsed.pathname)) return false;
    const candidateId =
      parsed.searchParams.get("sof") ||
      parsed.searchParams.get("id") ||
      parsed.searchParams.get("kw") ||
      productIdFromPath(parsed.pathname);
    return String(candidateId || "").trim() === keyword;
  } catch {
    return false;
  }
}

function candidateUrlsFromText(text = "", baseUrl = "https://www.3d66.com/") {
  const source = decodeHtml(String(text || "").replaceAll("\\/", "/"));
  const urls = [];
  const patterns = [
    /https?:\/\/[^"' <>\n]+3d66\.com\/reshtml[a-z]*\/[^"' <>\n]+?\.html(?:\?[^"' <>\n]*)?/gi,
    /https?:\/\/[^"' <>\n]+3d66\.com\/items\/[^"' <>\n]+?\.html(?:\?[^"' <>\n]*)?/gi,
    /(?:href|url|resUrl|link)["']?\s*[:=]\s*["'](\/reshtml[a-z]*\/[^"' <>\n]+?\.html(?:\?[^"'<>\n]*)?)["']/gi,
    /(?:href|url|resUrl|link)["']?\s*[:=]\s*["'](\/items\/[^"' <>\n]+?\.html(?:\?[^"'<>\n]*)?)["']/gi,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const raw = match[1] || match[0];
      try {
        urls.push(new URL(raw, baseUrl).toString());
      } catch {
        // Ignore malformed candidates; search responses may contain escaped snippets.
      }
    }
  }

  return urls;
}

function exactModelUrlFromAny(value, productId, baseUrl = "https://www.3d66.com/", depth = 0) {
  if (depth > 6 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    for (const candidate of candidateUrlsFromText(value, baseUrl)) {
      if (isExactModelPageUrl(candidate, productId)) return candidate;
    }
    return "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = exactModelUrlFromAny(item, productId, baseUrl, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  for (const key of ["url", "href", "link", "resUrl", "res_url", "sourceUrl", "source_url"]) {
    const raw = value[key];
    if (!raw || typeof raw !== "string") continue;
    try {
      const candidate = new URL(raw.replaceAll("\\/", "/"), baseUrl).toString();
      if (isExactModelPageUrl(candidate, productId)) return candidate;
    } catch {
      // Keep scanning nested data.
    }
  }

  for (const item of Object.values(value)) {
    const found = exactModelUrlFromAny(item, productId, baseUrl, depth + 1);
    if (found) return found;
  }
  return "";
}

function accountSearchEnabled() {
  return booleanEnv("THREED66_ACCOUNT_SEARCH_ENABLED", true);
}

function modelResolveMode() {
  const mode = String(process.env.THREED66_MODEL_RESOLVE_MODE || "search")
    .trim()
    .toLowerCase();
  return MODEL_RESOLVE_MODES.has(mode) ? mode : "search";
}

function footprintCacheKey(productIds = [], cookieValue = "") {
  const cookieHash = crypto
    .createHash("sha256")
    .update(String(cookieValue || ""))
    .digest("hex")
    .slice(0, 16);
  return `${cookieHash}:${productIds.join(",")}`;
}

function cachedFootprintModelUrl(key = "") {
  const entry = footprintModelUrlCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > FOOTPRINT_CACHE_TTL_MS) {
    footprintModelUrlCache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheFootprintModelUrl(key, value) {
  if (footprintModelUrlCache.size >= FOOTPRINT_CACHE_MAX) {
    const oldestKey = footprintModelUrlCache.keys().next().value;
    if (oldestKey) footprintModelUrlCache.delete(oldestKey);
  }
  footprintModelUrlCache.set(key, { createdAt: Date.now(), value });
}

async function requestAccountSearchUrl(productId, cookieValue, sourceUrl) {
  const keyword = safeSearchKeyword(productId);
  if (!keyword || !accountSearchEnabled()) return "";
  const cleanSourceUrl = sourceUrl ? stripInternalUrlHash(sourceUrl) : sourceUrl;
  const searchContext = searchContextFromUrl(cleanSourceUrl);

  const endpoint = new URL(ACCOUNT_SEARCH_ENDPOINT);
  endpoint.searchParams.set("keyword", keyword);
  endpoint.searchParams.set("origin", searchContext.origin);
  endpoint.searchParams.set("is_all_search", "1");
  endpoint.searchParams.set("refer_url", SEARCH_REFERER);
  endpoint.searchParams.set("site", searchContext.searchSite);
  endpoint.searchParams.set("page_type", searchContext.pageType);
  endpoint.searchParams.set("access_source_site", searchContext.accessSourceSite);
  endpoint.searchParams.set("access_source_page", searchContext.accessSourcePage);
  endpoint.searchParams.set("url", searchContext.origin + "/");
  endpoint.searchParams.set("browser", DEFAULT_USER_AGENT);
  endpoint.searchParams.set("res_type", searchContext.resType);

  const { controller, done } = withTimeout();
  try {
    const response = await fetch3D66(endpoint.toString(), {
      method: "GET",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/plain, */*",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
        cookie: cookieValue,
        referer: cleanSourceUrl || SEARCH_REFERER,
        "user-agent": DEFAULT_USER_AGENT,
        "x-requested-with": "XMLHttpRequest",
      },
    }, { stage: "preview" });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }

    return (
      exactModelUrlFromAny(parsed, keyword, endpoint.toString()) ||
      exactModelUrlFromAny(text, keyword, endpoint.toString())
    );
  } catch (error) {
    if (error.name === "AbortError") return "";
    return "";
  } finally {
    done();
  }
}

function searchContextFromUrl(sourceUrl = "") {
  try {
    const parsed = new URL(sourceUrl);
    const configured = configuredSiteContexts()[parsed.hostname.toLowerCase()] || {};
    const site = String(configured.site || "1");
    return {
      origin: parsed.origin,
      resType: site,
      searchSite: parsed.hostname === "www.3d66.com" ? "14" : site,
      pageType: String(configured.pageType || "1"),
      accessSourceSite: String(configured.accessSourceSite || site),
      accessSourcePage: String(configured.accessSourcePage || "5"),
    };
  } catch {
    return {
      origin: "https://www.3d66.com",
      resType: "1",
      searchSite: "14",
      pageType: "1",
      accessSourceSite: "15",
      accessSourcePage: "26",
    };
  }
}

async function resolveAccountModelUrl(
  rawUrl,
  cookieValue,
  cookies = null,
  { stage = "preview" } = {},
) {
  const normalized = normalizeModelUrl(rawUrl);
  const productIds = requestedProductIdCandidatesFromUrl(normalized.toString());
  const resolvedLogicalProductId = footprintLogicalProductId(normalized.toString());
  const productId = resolvedLogicalProductId || productIds[0] || "";
  if (!productIds.length || process.env.THREED66_MOCK !== "false") {
    return { productId, url: normalized.toString(), usedAccountSearch: false };
  }

  const mode = modelResolveMode();
  const generatedFromModelId = isGeneratedModelIdUrl(normalized.toString());
  if (stage !== "preview" && isFootprintResolvedUrl(normalized.toString())) {
    return {
      productId,
      resolvedProductId: productIds[0] || productId,
      url: normalized.toString(),
      usedAccountSearch: false,
      usedFootprint: true,
      cookieValue,
      cookies,
    };
  }
  if (
    mode === "direct" ||
    (mode === "footprint" && stage === "preview" && !generatedFromModelId)
  ) {
    return {
      productId,
      url: normalized.toString(),
      usedAccountSearch: false,
      usedFootprint: false,
      cookies,
    };
  }

  if (mode === "footprint" && stage !== "preview" && !generatedFromModelId) {
    const cacheKey = footprintCacheKey(productIds, cookieValue);
    const cached = cachedFootprintModelUrl(cacheKey);
    const footprint = cached || await resolve3D66ModelUrlFromFootprint(
      normalized.toString(),
      cookieValue,
      productIds,
    );
    if (!cached) cacheFootprintModelUrl(cacheKey, footprint);
    return {
      productId,
      resolvedProductId: footprint.productId || productId,
      url: markFootprintResolvedUrl(footprint.url, productId),
      usedAccountSearch: false,
      usedFootprint: true,
      cookieValue: footprint.cookieValue || cookieValue,
      cookies,
    };
  }

  let safeUrl = safeAccountModelUrl(normalized.toString(), productId);
  for (const candidate of productIds) {
    const candidateSafeUrl = safeAccountModelUrl(normalized.toString(), candidate);
    const searchUrl = await requestAccountSearchUrl(candidate, cookieValue, candidateSafeUrl);
    if (searchUrl) {
      return {
        productId: candidate,
        url: searchUrl,
        safeUrl: candidateSafeUrl,
        usedAccountSearch: true,
        cookies,
      };
    }
    safeUrl = safeUrl || candidateSafeUrl;
  }

  return {
    productId,
    url: safeUrl,
    safeUrl,
    usedAccountSearch: false,
    cookies,
  };
}

function enforceRequestedProductId(fields = {}, metadata = {}, requestedProductId = "") {
  const lockedId = String(requestedProductId || "").trim();
  if (!lockedId) return { fields, metadata };
  return {
    fields: {
      ...fields,
      llId: lockedId,
    },
    metadata: {
      ...metadata,
      productId: lockedId,
    },
  };
}

function timeoutMs() {
  const value = Number(process.env.THREED66_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function withTimeout() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  return { controller, done: () => clearTimeout(timer) };
}

function shouldFallbackToBrowserPage(error) {
  return (
    (process.env.THREED66_BROWSER_ALWAYS === "true" ||
      process.env.THREED66_DISABLE_BROWSER_PAGE_FALLBACK !== "true") &&
    (error.status === 502 || error.status === 504)
  );
}

function shouldAlwaysUseBrowserPage() {
  return process.env.THREED66_BROWSER_ALWAYS === "true";
}

function isPlaywrightMissing(error) {
  return error?.code === "PLAYWRIGHT_NOT_INSTALLED";
}

function cookieMap(cookieValue = "") {
  return String(cookieValue)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((map, part) => {
      const index = part.indexOf("=");
      if (index <= 0) return map;
      map.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
      return map;
    }, new Map());
}

function requireCookie(cookieValue) {
  if (!cookieValue) {
    throw httpError("3D66 cookie is required", 400);
  }

  const cookies = cookieMap(cookieValue);
  const missing = ["PHPSESSID", "login_token", "login_sign"].filter((key) => !cookies.get(key));
  if (missing.length) {
    throw httpError(`3D66 cookie missing required keys: ${missing.join(", ")}`, 400);
  }

  return cookies;
}

function normalizeModelUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw httpError("Invalid 3D66 URL", 400);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw httpError("Only HTTP(S) URLs are supported", 400);
  }

  if (!isAllowed3D66Host(parsed.hostname)) {
    throw httpError("Only 3d66.com links are supported", 400);
  }

  return parsed;
}

function isAllowed3D66Host(hostname = "") {
  const normalized = String(hostname || "").toLowerCase();
  return normalized === "3d66.com" || normalized.endsWith(".3d66.com");
}

function isAllowed3D66DownloadUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").replaceAll("\\/", "/").trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      isAllowed3D66Host(hostname) &&
      /^(?:k?down|download)[^.]*\./i.test(hostname)
    );
  } catch {
    return false;
  }
}

async function fetch3D66DownloadWithRedirects(url, options = {}) {
  let currentUrl = String(url || "");
  for (let redirectCount = 0; redirectCount <= 5; redirectCount += 1) {
    if (!isAllowed3D66DownloadUrl(currentUrl)) {
      throw httpError("3D66 download redirect host is not allowed", 400);
    }

    const response = await fetch3D66(
      currentUrl,
      { ...options, redirect: "manual" },
      { stage: "file" },
    );
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel().catch(() => {});
    if (!location || redirectCount >= 5) {
      throw httpError("3D66 download redirect is invalid", 502);
    }
    try {
      currentUrl = new URL(location, currentUrl).toString();
    } catch {
      throw httpError("3D66 download redirect is invalid", 502);
    }
  }
  throw httpError("Too many 3D66 download redirects", 502);
}

function extractDownloadFileUrl(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\/", "/").trim();
    return isAllowed3D66DownloadUrl(normalized) ? normalized : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const fileUrl = extractDownloadFileUrl(item, depth + 1);
      if (fileUrl) return fileUrl;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  const preferredKeys = [
    "url",
    "fileUrl",
    "file_url",
    "downloadUrl",
    "download_url",
    "downUrl",
    "down_url",
    "data",
  ];
  for (const key of preferredKeys) {
    const fileUrl = extractDownloadFileUrl(value[key], depth + 1);
    if (fileUrl) return fileUrl;
  }
  for (const nested of Object.values(value)) {
    const fileUrl = extractDownloadFileUrl(nested, depth + 1);
    if (fileUrl) return fileUrl;
  }
  return "";
}

function configuredSiteContexts() {
  const raw = String(process.env.THREED66_SITE_CONTEXTS || "").trim();
  if (!raw) return DEFAULT_SITE_CONTEXTS;

  try {
    return {
      ...DEFAULT_SITE_CONTEXTS,
      ...JSON.parse(raw)
    };
  } catch {
    return DEFAULT_SITE_CONTEXTS;
  }
}

function parseJsonCookie(cookies, key) {
  const value = cookies.get(key);
  if (!value) return null;

  try {
    return JSON.parse(decodeURIComponent(value));
  } catch {
    return null;
  }
}

function siteContext(pageUrl, cookies) {
  const parsed = new URL(stripInternalUrlHash(pageUrl));
  const origin = process.env.THREED66_ORIGIN || parsed.origin;
  const originHost = new URL(origin).hostname;
  const configured = configuredSiteContexts()[originHost] || {};
  const referrerContext = parseJsonCookie(cookies, "resUrlreferrer") || {};
  const site = String(referrerContext.site || configured.site || "6");
  const pageType = String(referrerContext.page_type || configured.pageType || "5");
  const accessSourceSite = String(referrerContext.access_source_site || configured.accessSourceSite || site);
  const accessSourcePage = String(referrerContext.access_source_page || configured.accessSourcePage || "5");
  const fileFormat = String(configured.fileFormat || "");

  return {
    origin,
    site,
    pageType,
    accessSourceSite,
    accessSourcePage,
    fileFormat
  };
}

function currentUnixSeconds() {
  return String(Math.floor(Date.now() / 1000));
}

function applyFieldsToContext(context, fields = {}) {
  if (fields.site) {
    context.site = String(fields.site);
    context.accessSourceSite = String(fields.site);
  }
  if (fields.pageType) {
    context.pageType = String(fields.pageType);
    context.accessSourcePage = String(fields.pageType);
  }
  if (fields.fileFormat) {
    context.fileFormat = String(fields.fileFormat);
  }
  if (fields.accessSourceSite) context.accessSourceSite = String(fields.accessSourceSite);
  if (fields.accessSourcePage) context.accessSourcePage = String(fields.accessSourcePage);
  if (fields.formatVersion) context.formatVersion = String(fields.formatVersion);
  if (fields.rendererType) context.rendererType = String(fields.rendererType);
  if (fields.selectedFormat) context.selectedFormat = fields.selectedFormat;
  return context;
}

function configuredPaytypeValue() {
  const value = String(process.env.THREED66_PAYTYPE_VALUE || "4").trim();
  return /^[\w-]{1,20}$/.test(value) ? value : "4";
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function decodeHtml(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlAttribute(value = "") {
  return String(value)
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#34;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function absoluteUrl(value = "", baseUrl = "") {
  if (!value) return "";
  try {
    return new URL(decodeHtml(value), baseUrl).toString();
  } catch {
    return "";
  }
}

function attrValue(tag = "", attr = "") {
  const match = String(tag).match(new RegExp(`\\s${attr}\\s*=\\s*["']([^"']+)["']`, "i"));
  return match?.[1] || "";
}

function tagWithAttributeValue(html = "", tagName = "", attr = "", value = "") {
  return String(html).match(
    new RegExp(`<${tagName}\\b(?=[^>]*\\s${attr}\\s*=\\s*["']${value}["'])[^>]*>`, "i")
  )?.[0] || "";
}

function metaContent(html = "", key = "") {
  const tag =
    tagWithAttributeValue(html, "meta", "property", key) ||
    tagWithAttributeValue(html, "meta", "name", key);
  return attrValue(tag, "content");
}

function jsonLdObjects(html = "") {
  const objects = [];
  const pattern = /<script\b(?=[^>]*\btype=["']application\/ld\+json["'])[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const parsed = JSON.parse(stripTags(match[1]));
      if (Array.isArray(parsed)) objects.push(...parsed);
      else if (parsed && typeof parsed === "object") objects.push(parsed);
    } catch {
      // ignore invalid embedded schema
    }
  }
  return objects;
}

function firstJsonLdValue(html = "", key = "") {
  for (const item of jsonLdObjects(html)) {
    const value = item?.[key];
    if (Array.isArray(value) && value.length) return value[0];
    if (typeof value === "string" && value) return value;
  }
  return "";
}

function stripTags(value = "") {
  return decodeHtml(String(value).replace(/<[^>]+>/g, " "));
}

function cleanTitle(value = "") {
  let title = stripTags(value)
    .replace(/\s+/g, " ")
    .trim();

  const bracketTitle = title.match(/^【(.+?)】/)?.[1];
  if (bracketTitle) title = bracketTitle;

  title = title
    .replace(/(?:下载|素材下载|3D模型下载|CAD图纸下载)$/i, "")
    .replace(/\s*[-_]\s*(?:3D溜溜网|3d66|3D66).*$/i, "")
    .trim();

  return title;
}

function normalizeFormatText(value = "") {
  return decodeHtml(String(value || "").replace(/\s+/g, " ").trim());
}

function downloadFormatKey(format = {}) {
  const key = String(format.key || "").trim();
  if (key) {
    const keyFileFormat = key.split("|")[0];
    if (usableFormatCode(format.fileFormat || format.file_format || keyFileFormat)) return key;
  }
  const fileFormat = String(format.fileFormat || format.file_format || "").trim();
  const formatVersion = String(format.formatVersion || format.format_version || "").trim();
  const rendererType = String(format.rendererType || format.renderer_type || "").trim();
  if (!usableFormatCode(fileFormat)) return "";
  return [fileFormat, formatVersion, rendererType].join("|");
}

function formatNameFromCode(fileFormat = "") {
  const code = String(fileFormat || "");
  return {
    1: "3Dmax（.max）",
    3: "OBJ（.obj）",
    14: "FBX（.fbx）",
  }[code] || (code ? `Format ${code}` : "Default");
}

function rendererNameFromCode(rendererType = "") {
  const code = String(rendererType || "");
  return {
    0: "",
    3: "Corona",
    4: "Vray",
  }[code] || (code ? `Renderer ${code}` : "");
}

function ownProp(value = {}, key = "") {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function usableFormatCode(value) {
  const text = String(value ?? "").trim();
  return text && text !== "0" ? text : "";
}

function downloadFileFormatCode(option = {}, keyParts = []) {
  const explicit = [
    option.fileFormat,
    option.file_format,
    option.fileFormatCode,
    option.file_format_code,
    option.formatCode,
    option.format_code,
  ].map(usableFormatCode).find(Boolean);
  if (explicit) return explicit;

  const plainFormat = usableFormatCode(option.format);
  if (plainFormat) return plainFormat;

  return usableFormatCode(keyParts[0]);
}

function normalizeDownloadFormatOption(option = {}, index = 0, isDefault = false) {
  const keyParts = String(option.key || "").split("|");
  const fileFormat = downloadFileFormatCode(option, keyParts);
  const formatVersion = String(
    option.formatVersion ?? option.format_version ?? option.version ?? keyParts[1] ?? "",
  ).trim();
  const rendererType = String(
    option.rendererType ??
      option.renderer_type ??
      option.renderType ??
      option.render_type ??
      option.rendererCode ??
      option.renderer_code ??
      keyParts[2] ??
      "",
  ).trim();
  if (!fileFormat) return null;

  const baseLabel = normalizeFormatText(
    option.label ||
      option.name ||
      option.title ||
      option.fileFormatName ||
      option.file_format_name ||
      option.formatName ||
      option.format_name ||
      formatNameFromCode(fileFormat),
  );
  const rendererLabel = normalizeFormatText(
    option.rendererLabel ||
      option.rendererName ||
      option.renderer_name ||
      option.renderName ||
      option.render_name ||
      rendererNameFromCode(rendererType),
  );
  const size = normalizeFormatText(
    option.size || option.fileSize || option.file_size || option.zip_size || option.package_size || "",
  );
  const key = downloadFormatKey({ fileFormat, formatVersion, rendererType });

  return {
    key,
    fileFormat,
    formatVersion,
    rendererType,
    label: baseLabel,
    rendererLabel,
    size,
    isDefault: Boolean(isDefault || option.isDefault || option.active || index === 0),
  };
}

function uniqueFormatOptions(options = []) {
  const seen = new Set();
  return options.filter(Boolean).filter((option) => {
    const optionFileFormat = usableFormatCode(
      option.fileFormat || option.file_format || String(option.key || "").split("|")[0],
    );
    if (!optionFileFormat) return false;
    if (!option.key || seen.has(option.key)) return false;
    seen.add(option.key);
    return true;
  });
}

function hasFormatOptionFields(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const hasStructuredKey = ownProp(value, "key") && String(value.key || "").includes("|");
  const hasExplicitFileFormat = [
    "fileFormat",
    "file_format",
    "fileFormatCode",
    "file_format_code",
    "formatCode",
    "format_code",
  ].some((key) => ownProp(value, key) && usableFormatCode(value[key]));
  const hasPlainFormat =
    ownProp(value, "format") &&
    usableFormatCode(value.format) &&
    [
      "fileFormatName",
      "file_format_name",
      "formatName",
      "format_name",
      "formatVersion",
      "format_version",
      "version",
      "rendererType",
      "renderer_type",
      "renderType",
      "render_type",
      "rendererLabel",
      "rendererName",
      "renderer_name",
      "fileSize",
      "file_size",
      "zip_size",
      "package_size",
      "size",
    ].some((key) => ownProp(value, key));

  return hasStructuredKey || hasExplicitFileFormat || hasPlainFormat || [
    "formatVersion",
    "format_version",
    "rendererType",
    "renderer_type",
    "renderType",
    "render_type",
    "rendererCode",
    "renderer_code",
    "rendererLabel",
    "rendererName",
    "renderer_name",
  ].some((key) => ownProp(value, key) && usableFormatCode(downloadFileFormatCode(value)));
}

function parseFormatOptionsFromDetail(detailRes = {}) {
  const candidateLists = [
    detailRes.down_file_format,
    detailRes.download_file_format,
    detailRes.file_format_list,
    detailRes.fileFormatList,
    detailRes.format_list,
    detailRes.formatList,
  ].filter(Array.isArray);

  const options = uniqueFormatOptions(
    candidateLists.flatMap((list) =>
      list
        .map((item, index) =>
          hasFormatOptionFields(item) ? normalizeDownloadFormatOption(item, index, index === 0) : null,
        )
        .filter(Boolean),
    ),
  );

  return options.length > 1 ? options : [];
}

function formatSpanValue(item = "", keywordPattern = null) {
  const spans = String(item).matchAll(/<span\b[^>]*title=["']([^"']*)["'][^>]*>([\s\S]*?)<\/span>/gi);
  for (const span of spans) {
    const title = normalizeFormatText(span[1]);
    const text = normalizeFormatText(stripTags(span[2]));
    if (!keywordPattern || keywordPattern.test(text)) {
      return title || normalizeFormatText(text.replace(/^[^:：]+[:：]\s*/, ""));
    }
  }
  return "";
}

function parseFormatOptionsFromHtml(html = "") {
  const options = [];
  const itemPattern = /<li\b(?=[^>]*class=["'][^"']*pop-bd-item[^"']*["'])[^>]*>[\s\S]*?<\/li>/gi;
  let match;
  while ((match = itemPattern.exec(html))) {
    const item = match[0];
    const openTag = item.match(/<li\b[^>]*>/i)?.[0] || "";
    const active = /\bactive\b/i.test(attrValue(openTag, "class"));
    const titleBlock = firstMatch(item, [
      /<div\b(?=[^>]*class=["'][^"']*bd-title[^"']*["'])[^>]*>[\s\S]*?<\/i>\s*([\s\S]*?)<\/div>/i,
      /<div\b(?=[^>]*class=["'][^"']*bd-title[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i,
    ]);
    options.push(
      normalizeDownloadFormatOption(
        {
          fileFormat: attrValue(openTag, "data-file_format"),
          formatVersion: attrValue(openTag, "data-format_version") || formatSpanValue(item, /\u7248\u672c|version/i),
          rendererType: attrValue(openTag, "data-renderer_type"),
          rendererLabel: formatSpanValue(item, /\u6e32\u67d3\u5668|renderer/i),
          label: stripTags(titleBlock).replace(/^✓\s*/, ""),
          size: stripTags(
            firstMatch(item, [
              /<div\b(?=[^>]*class=["'][^"']*right-file-size[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i,
            ]),
          ),
          active,
        },
        options.length,
        active,
      ),
    );
  }
  return options.filter(Boolean);
}

function formatOptionsFromAny(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return [];
  if (typeof value === "string") {
    return /pop-bd-item|data-file_format|download-file-format-pop/i.test(value)
      ? parseFormatOptionsFromHtml(value)
      : [];
  }
  if (Array.isArray(value)) {
    const direct = value
      .map((item, index) => (hasFormatOptionFields(item) ? normalizeDownloadFormatOption(item, index, index === 0) : null))
      .filter(Boolean);
    if (direct.length) return direct;
    return uniqueFormatOptions(value.flatMap((item) => formatOptionsFromAny(item, depth + 1)));
  }
  if (typeof value !== "object") return [];

  const current = normalizeDownloadFormatOption(value, 0, false);
  const options = hasFormatOptionFields(value) && current ? [current] : [];

  for (const nested of Object.values(value)) {
    options.push(...formatOptionsFromAny(nested, depth + 1));
  }
  return uniqueFormatOptions(options);
}

function formatOptionsFromPage(html = "", detailRes = {}) {
  const options = uniqueFormatOptions([
    ...parseFormatOptionsFromHtml(html),
    ...parseFormatOptionsFromDetail(detailRes),
  ]);
  const defaultIndex = options.findIndex((option) => option.isDefault);
  if (defaultIndex > 0) {
    const [defaultOption] = options.splice(defaultIndex, 1);
    options.unshift(defaultOption);
  }
  return options.map((option, index) => ({
    ...option,
    isDefault: index === 0 || option.isDefault,
  }));
}

function selectedOrDefaultFormat(formatOptions = [], requestedFormat = null) {
  const options = uniqueFormatOptions(formatOptions);
  if (!options.length && !requestedFormat) return null;
  const requested = requestedFormat ? normalizeDownloadFormatOption(requestedFormat, 0, false) : null;
  if (requested) {
    const exact = options.find((option) => option.key === requested.key);
    if (exact) return exact;
    if (!options.length) return requested;
    throw httpError("Định dạng file đã chọn không còn khả dụng trên 3D66.", 400, {
      code: "THREED66_FORMAT_UNAVAILABLE",
      requestedFormat: requested,
      formatOptions: options,
    });
  }
  return options.find((option) => option.isDefault) || options[0] || null;
}

function applySelectedFormat(fields = {}, metadata = {}, requestedFormat = null) {
  const options = metadata.formatOptions || fields.formatOptions || [];
  const selected = selectedOrDefaultFormat(options, requestedFormat);
  if (!selected) return { fields, metadata };
  return {
    fields: {
      ...fields,
      fileFormat: selected.fileFormat || fields.fileFormat,
      formatVersion: selected.formatVersion,
      rendererType: selected.rendererType,
      selectedFormat: selected,
    },
    metadata: {
      ...metadata,
      formatOptions: options,
      selectedFormat: selected,
    },
  };
}

function firstTagWithClass(html = "", tag = "", className = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>[\\s\\S]*?<\\/${tag}>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstOpenTagWithClass(html = "", tag = "", className = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstTagWithAttr(html = "", tag = "", attr = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["'][^"']+["'][^>]*>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstTagWithAttrValue(html = "", tag = "", attr = "", value = "") {
  const pattern = new RegExp(`<${tag}\\b[^>]*\\s${attr}\\s*=\\s*["']${value}["'][^>]*>`, "i");
  return html.match(pattern)?.[0] || "";
}

function firstImageInBlock(html = "", blockPattern) {
  const block = html.match(blockPattern)?.[0] || "";
  return firstOpenTagWithClass(block, "img", "llimgs") || block.match(/<img\b[^>]*>/i)?.[0] || "";
}

function parseDetailData(html = "") {
  const direct = html.match(/<input\b(?=[^>]*\bid=["']detail_data["'])[^>]*\bvalue=(["'])([\s\S]*?)\1[^>]*>/i);
  const tag = direct?.[0] || firstTagWithAttrValue(html, "input", "id", "detail_data");
  const raw = direct?.[2] || attrValue(tag, "value");
  if (!raw) return null;

  try {
    return JSON.parse(decodeHtmlAttribute(raw).trim());
  } catch {
    return null;
  }
}

function detailResFromData(detailData) {
  const data = detailData?.data;
  if (data?.res && typeof data.res === "object") return data.res;
  if (data && typeof data === "object") return data;
  if (detailData?.res && typeof detailData.res === "object") return detailData.res;
  return {};
}

function firstAttrFromMatchedTag(html = "", tagPattern, attr = "") {
  const tag = html.match(tagPattern)?.[0] || "";
  return attrValue(tag, attr);
}

function extractModelTitleFromHtml(html = "") {
  const titleMaterial = html.match(/<div\b(?=[^>]*\bclass=["'][^"']*title-material[^"']*["'])[\s\S]*?<h1\b(?=[^>]*\bclass=["'][^"']*model-name[^"']*["'])[^>]*\btitle=(["'])([\s\S]*?)\1/i)?.[2];
  if (titleMaterial) return titleMaterial;

  const titleFromAttr = html.match(/<h1\b(?=[^>]*\bclass=["'][^"']*model-name[^"']*["'])[^>]*\btitle=(["'])([\s\S]*?)\1[^>]*>/i)?.[2];
  if (titleFromAttr) return titleFromAttr;

  const titleFromText = html.match(/<h1\b(?=[^>]*\bclass=["'][^"']*model-name[^"']*["'])[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  if (titleFromText) return stripTags(titleFromText);

  return (
    metaContent(html, "og:title") ||
    firstJsonLdValue(html, "title") ||
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
    ""
  );
}

function extractPreviewImageFromHtml(html = "", pageUrl = "") {
  const dataTypeOneImage = html.match(/<img\b(?=[^>]*\bdata-img-type=["']1["'])[^>]*\bsrc=(["'])([\s\S]*?)\1/i)?.[2];
  const dataTypeOneUrl = absoluteUrl(String(dataTypeOneImage || "").replaceAll("\\/", "/"), pageUrl);
  if (dataTypeOneUrl) return dataTypeOneUrl;

  const mainGalleryImage = html.match(/<div\b(?=[^>]*\bid=["']swiper_max_html["'])[\s\S]*?<div\b(?=[^>]*\bclass=["'][^"']*swiper-imgs-list[^"']*["'])[\s\S]*?<img\b(?=[^>]*\bclass=["'][^"']*llimgs[^"']*["'])[^>]*\bsrc=(["'])([\s\S]*?)\1/i)?.[2];
  const mainGalleryUrl = absoluteUrl(String(mainGalleryImage || "").replaceAll("\\/", "/"), pageUrl);
  if (mainGalleryUrl) return mainGalleryUrl;

  const directPatterns = [
    /<img\b(?=[^>]*\bdata-img-type=["']1["'])[^>]*>/i,
    /<div\b(?=[^>]*\bclass=["'][^"']*swiper-imgs-list[^"']*["'])[\s\S]*?<img\b[^>]*>/i,
    /<div\b(?=[^>]*\bid=["']swiper_max_html["'])[\s\S]*?<img\b[^>]*>/i,
    /<div\b(?=[^>]*\bclass=["'][^"']*gallery-top[^"']*["'])[\s\S]*?<img\b[^>]*>/i,
    /<img\b(?=[^>]*\bclass=["'][^"']*llimgs[^"']*["'])[^>]*>/i,
    /<meta\b(?=[^>]*\bproperty=["']og:image["'])[^>]*>/i
  ];

  for (const pattern of directPatterns) {
    const raw =
      firstAttrFromMatchedTag(html, pattern, "src") ||
      firstAttrFromMatchedTag(html, pattern, "data-imgurl") ||
      firstAttrFromMatchedTag(html, pattern, "data-src") ||
      firstAttrFromMatchedTag(html, pattern, "data-original") ||
      firstAttrFromMatchedTag(html, pattern, "content");
    const absolute = absoluteUrl(String(raw).replaceAll("\\/", "/"), pageUrl);
    if (absolute) return absolute;
  }

  const metaImage = absoluteUrl(metaContent(html, "og:image") || metaContent(html, "twitter:image"), pageUrl);
  if (metaImage) return metaImage;

  const jsonLdImage = absoluteUrl(firstJsonLdValue(html, "images") || firstJsonLdValue(html, "image"), pageUrl);
  if (jsonLdImage) return jsonLdImage;

  return "";
}

function extractCreditCostFromHtml(html = "", options = {}) {
  const useDetailData = options.useDetailData !== false;
  if (useDetailData) {
    const detailData = parseDetailData(html);
    const detailRes = detailResFromData(detailData);
    const detailPrice = Number(detailRes.res_price || detailRes.origin_price || detailRes.coupon_after_price);
    if (Number.isFinite(detailPrice) && detailPrice > 0) return detailPrice;
  }

  const source = decodeHtml(html);
  const downloadPriceBlock = html.match(/<div\b(?=[^>]*\bclass=["'][^"']*download-price[^"']*["'])[\s\S]*?<\/div>\s*<\/div>/i)?.[0] || "";
  const originalInBlock = downloadPriceBlock.match(/<div\b(?=[^>]*\bclass=["'][^"']*(?:orginal-price|original-price)[^"']*["'])[^>]*>([\s\S]*?)<\/div>/i)?.[1];
  const originalInBlockValue = stripTags(originalInBlock || "").match(/(\d+(?:\.\d+)?)/)?.[1];
  if (originalInBlockValue) {
    const number = Number(originalInBlockValue);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const directPrice = html.match(/<[^>]+\bclass=["'][^"']*(?:orginal-price|original-price)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];
  const directPriceValue = stripTags(directPrice || "").match(/(\d+(?:\.\d+)?)/)?.[1];
  if (directPriceValue) {
    const number = Number(directPriceValue);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const priceTag =
    firstTagWithClass(html, "div", "orginal-price") ||
    firstTagWithClass(html, "div", "original-price");
  const priceFromTag = stripTags(priceTag).match(/(\d+(?:\.\d+)?)/)?.[1];
  if (priceFromTag) {
    const number = Number(priceFromTag);
    if (Number.isFinite(number) && number > 0) return number;
  }

  const candidates = [
    /<div[^>]+class=["'][^"']*orginal-price[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*下载币\s*<\/div>/i,
    /<div[^>]+class=["'][^"']*original-price[^"']*["'][^>]*>\s*(\d+(?:\.\d+)?)\s*下载币\s*<\/div>/i,
    /class=["'][^"']*(?:orginal-price|original-price)[^"']*["'][^>]*>[\s\S]{0,80}?(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*下载币/i,
    /res_price["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
    /coupon_after_price["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)/i,
    /["'](?:credit|credits|download_price|need_xzb|xzb|xuan_dian|cost|download_cost)["']\s*:\s*["']?(\d+(?:\.\d+)?)/i,
    /(?:credit|download_price|need_xzb|xzb|xuan_dian|cost|download_cost)\s*=\s*["']?(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:credit|credits|玄点|点)/i
  ];
  const value = firstMatch(source, candidates);
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 1;
}

function hasKnownCreditCostInHtml(html = "", options = {}) {
  const useDetailData = options.useDetailData !== false;
  if (useDetailData) {
    const detailData = parseDetailData(html);
    const detailRes = detailResFromData(detailData);
    const detailPrice = Number(detailRes.res_price || detailRes.origin_price || detailRes.coupon_after_price);
    if (Number.isFinite(detailPrice) && detailPrice > 0) return true;
  }

  return /orginal-price|original-price|download-price|res_price|coupon_after_price|download_price|need_xzb|xuan_dian|çŽ„ç‚¹|ç‚¹/i.test(
    decodeHtml(html),
  );
}

function parseModelMetadata(html, pageUrl, fields = {}) {
  const detailData = parseDetailData(html);
  const detailRes = detailResFromData(detailData);
  const requestedLlId = String(fields.llId || "").trim();
  const detailLlId = String(detailRes.ll_id || "").trim();
  const detailMatchesRequested = !requestedLlId || !detailLlId || detailLlId === requestedLlId;
  const detailForMetadata = detailMatchesRequested ? detailRes : {};
  const formatOptions = formatOptionsFromPage(html, detailForMetadata);
  const detailImages = Array.isArray(detailForMetadata.res_img) ? detailForMetadata.res_img : [];
  const coverItem =
    detailImages.find((item) => Number(item?.img_type) === 1 && item?.is_cover) ||
    detailImages.find((item) => Number(item?.img_type) === 1) ||
    detailImages.find((item) => item?.is_cover) ||
    detailImages[0] ||
    {};
  const directPreviewImage = extractPreviewImageFromHtml(html, pageUrl);
  const previewImageTag =
    firstTagWithAttrValue(html, "img", "data-img-type", "1") ||
    firstImageInBlock(html, /<div[^>]+id=["']swiper_max_html["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/i) ||
    firstImageInBlock(html, /<div[^>]+class=["'][^"']*gallery-top[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/i) ||
    firstImageInBlock(html, /<div[^>]+class=["'][^"']*swiper-imgs-list[^"']*["'][^>]*>[\s\S]*?<\/div>/i) ||
    firstOpenTagWithClass(html, "img", "llimgs") ||
    firstTagWithAttr(html, "img", "data-img-type") ||
    firstTagWithAttr(html, "img", "data-img-id");
  const largeHtmlImage =
    attrValue(previewImageTag, "src") ||
    attrValue(previewImageTag, "data-imgurl") ||
    attrValue(previewImageTag, "data-src") ||
    attrValue(previewImageTag, "data-original");
  const coverImage =
    directPreviewImage ||
    largeHtmlImage ||
    coverItem.img_pic ||
    coverItem.thuimg600 ||
    coverItem.fullimg ||
    coverItem.thuimg88 ||
    coverItem.res_img_dg ||
    detailForMetadata.business_img ||
    detailForMetadata.res_img_dg ||
    (detailMatchesRequested ? detailData?.images?.[0] : "") ||
    "";
  const modelNameTag = firstTagWithClass(html, "h1", "model-name");
  const directTitle = extractModelTitleFromHtml(html);
  const detailTitle = detailMatchesRequested ? detailRes.res_name_txt || detailRes.res_name : "";
  const modelTitle =
    detailTitle ||
    directTitle ||
    attrValue(modelNameTag, "title") ||
    stripTags(modelNameTag);
  const title = cleanTitle(
    modelTitle ||
    firstMatch(html, [
      /<h1[^>]+class=["'][^"']*model-name[^"']*["'][^>]+title=["']([^"']+)["'][^>]*>/i,
      /<h1[^>]+title=["']([^"']+)["'][^>]+class=["'][^"']*model-name[^"']*["'][^>]*>/i,
      /<h1[^>]+class=["'][^"']*model-name[^"']*["'][^>]*>\s*([\s\S]*?)\s*<\/h1>/i,
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i,
      /<meta[^>]+name=["']title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
      /["']title["']\s*:\s*["']([^"']+)["']/i
    ])
  );

  const rawImage = (
    coverImage ||
    attrValue(previewImageTag, "src") ||
    attrValue(previewImageTag, "data-src") ||
    attrValue(previewImageTag, "data-original") ||
    firstMatch(html, [
    /<img[^>]+class=["'][^"']*llimgs[^"']*["'][^>]+src=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*llimgs[^"']*["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+data-img-type=["']1["'][^>]*>/i,
    /<img[^>]+data-img-type=["']1["'][^>]+src=["']([^"']+)["'][^>]*>/i,
    /<img[^>]+src=["']([^"']+)["'][^>]+data-img-id=["'][^"']+["'][^>]*>/i,
    /<img[^>]+data-img-id=["'][^"']+["'][^>]+src=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /["'](?:cover|cover_url|thumb|thumb_url|image|img|pic|pic_url)["']\s*:\s*["']([^"']+)["']/i,
    /(https?:\\?\/\\?\/[^"']+\.(?:jpg|jpeg|png|webp)(?:[^"']*)?)/i
  ])).replaceAll("\\/", "/");

  return {
    productId: fields.llId || detailRes.ll_id || "",
    title: title || fields.llId || "3D66 model",
    imageUrl: absoluteUrl(rawImage, pageUrl),
    creditCost: extractCreditCostFromHtml(html, { useDetailData: detailMatchesRequested }),
    priceKnown: hasKnownCreditCostInHtml(html, { useDetailData: detailMatchesRequested }),
    formatOptions,
    sourceUrl: pageUrl
  };
}

function parseDynamicFields(html, pageUrl) {
  const parsed = new URL(pageUrl);
  const source = `${pageUrl}\n${html}`;
  const detailRes = detailResFromData(parseDetailData(html));
  const requestedSof = parsed.searchParams.get("sof") || "";
  const detailLlId = String(detailRes.ll_id || "").trim();
  const detailMatchesRequested = !requestedSof || !detailLlId || detailLlId === requestedSof;
  const detailForFields = detailMatchesRequested ? detailRes : {};
  const param = (...names) => {
    for (const name of names) {
      const value = parsed.searchParams.get(name);
      if (value) return value;
    }
    return "";
  };
  const firstFileFormat = Array.isArray(detailForFields.down_file_format)
    ? detailForFields.down_file_format[0] || {}
    : {};
  const formatOptions = formatOptionsFromPage(html, detailForFields);
  const defaultFormat = formatOptions.find((option) => option.isDefault) || formatOptions[0] || {};

  return {
    llId:
      requestedSof ||
      detailForFields.ll_id ||
      firstMatch(source, [
        /\sdata-sof=["']([A-Z0-9_-]{8,})["']/i,
        /<span[^>]+class=["'][^"']*ll-id[^"']*["'][^>]*>\s*([A-Z0-9_-]{8,})\s*<\/span>/i,
        /<div[^>]+class=["'][^"']*slide-ll-id[^"']*["'][^>]*>\s*ID\s*<b>\s*([A-Z0-9_-]{8,})\s*<\/b>/i,
        /["']ll_id["']\s*:\s*["']([^"']+)["']/i,
        /(?:ll_id|llId)\s*=\s*["']([^"']+)["']/i
      ]),
    sign:
      parsed.searchParams.get("sign") ||
      firstMatch(source, [
        /["'?&]sign=([a-z0-9_-]{8,})/i,
        /["']sign["']\s*:\s*["']([^"']+)["']/i,
        /sign\s*=\s*["']([^"']+)["']/i
      ]),
    token: firstMatch(source, [
      /["']token["']\s*:\s*["']([^"']+)["']/i,
      /(?:download_)?token\s*=\s*["']([^"']+)["']/i,
      /name=["']token["']\s+value=["']([^"']+)["']/i,
      /token["']?\s*,\s*["']([a-f0-9]{16,64})["']/i
    ]),
    upTime: firstMatch(source, [
      /["']up_time["']\s*:\s*["']?(\d{8,})["']?/i,
      /up_time\s*=\s*["']?(\d{8,})["']?/i,
      /["']upTime["']\s*:\s*["']?(\d{8,})["']?/i
    ]),
    site: firstMatch(source, [/<input\b(?=[^>]*\bid=["']site["'])[^>]*\bvalue=["']([^"']+)["']/i]),
    pageType: firstMatch(source, [/<input\b(?=[^>]*\bid=["']page_type["'])[^>]*\bvalue=["']([^"']+)["']/i]),
    actionId:
      detailRes.actionId ||
      param("action_id", "actid", "searchActionId") ||
      firstMatch(source, [
        /["']action_id["']\s*:\s*["']([^"']+)["']/i,
        /["']actionId["']\s*:\s*["']([^"']+)["']/i,
        /(?:action_id|actionId)\s*=\s*["']([^"']+)["']/i
      ]),
    requestId: param("r_id", "request_id"),
    sourceAlg: param("s_alg", "source_alg"),
    position: param("position", "p"),
    llwSourceScene: param("lss", "llw_source_scene"),
    listLayoutType: param("llt", "list_layout_type"),
    ab: param("ab_f", "ab"),
    algorithmType: param("algorithm_type", "gp"),
    algorithmVersion: param("algorithm_version", "a_v"),
    accessSourceSite: param("access_source_site"),
    accessSourcePage: param("access_source_page"),
    fileFormat: defaultFormat.fileFormat || (firstFileFormat.file_format ? String(firstFileFormat.file_format) : ""),
    rendererType: defaultFormat.rendererType || (firstFileFormat.renderer_type ? String(firstFileFormat.renderer_type) : ""),
    formatVersion:
      defaultFormat.formatVersion ||
      firstFileFormat.format_version ||
      firstMatch(source, [
        /["']format_version["']\s*:\s*["']([^"']+)["']/i,
        /format_version\s*=\s*["']([^"']+)["']/i
      ]),
    formatOptions
  };
}

function buildModelUrls(pageUrl, fields) {
  const resUrl = new URL(stripInternalUrlHash(pageUrl));
  if (fields.llId && !resUrl.searchParams.get("sof")) resUrl.searchParams.set("sof", fields.llId);
  if (fields.sign && !resUrl.searchParams.get("sign")) resUrl.searchParams.set("sign", fields.sign);
  if (!resUrl.searchParams.get("alichlgref")) resUrl.searchParams.set("alichlgref", "https://user.3d66.com/");

  const referrer = new URL(resUrl);
  referrer.searchParams.delete("alichlgref");

  return {
    resUrl: resUrl.toString(),
    referrer: referrer.toString()
  };
}

async function fetchModelPage(url, cookieValue) {
  const { controller, done } = withTimeout();
  const cleanUrl = stripInternalUrlHash(url);
  try {
    const response = await fetch3D66(cleanUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "vi,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
        "cache-control": "no-cache",
        cookie: cookieValue,
        pragma: "no-cache",
        referer: cleanUrl,
        "sec-ch-ua": "\"Chromium\";v=\"148\", \"Google Chrome\";v=\"148\", \"Not/A)Brand\";v=\"99\"",
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": "\"Windows\"",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "same-origin",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
        "user-agent": DEFAULT_USER_AGENT
      }
    }, { stage: "preview" });

    const html = await response.text();
    if (!response.ok) {
      throw httpError(`3D66 model page request failed: HTTP ${response.status}`, 502);
    }

    const safeHtml = html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html;
    return { html: safeHtml, pageUrl: response.url || cleanUrl };
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError("3D66 model page request timed out", 504);
    }
    if (error.status) throw error;
    throw httpError(`3D66 model page request failed: ${error.message}`, 502);
  } finally {
    done();
  }
}

function buildDownloadPayload(fields, urls, cookies, context) {
  const selectedFormat = fields.selectedFormat || context.selectedFormat || null;
  const fileFormat = selectedFormat
    ? String(selectedFormat.fileFormat || "")
    : context.fileFormat;
  const rendererType = selectedFormat
    ? String(selectedFormat.rendererType || "")
    : context.rendererType || process.env.THREED66_RENDERER_TYPE || "4";
  const formatVersion = selectedFormat
    ? String(selectedFormat.formatVersion || "")
    : context.formatVersion || fields.formatVersion || process.env.THREED66_FORMAT_VERSION || "max2018";
  const payload = new URLSearchParams({
    action: "user_pay_download",
    rartype: "1",
    ll_id: fields.llId,
    needtype: fields.needtype || "1",
    actid: fields.actionId || "",
    action_id: fields.actionId || "",
    token: fields.token,
    sotu_action_id: "",
    kw: "",
    rlai: "",
    collect: "0",
    dl_course: "",
    parentId: "",
    st: "2",
    source: "0",
    click_res_source: "1",
    uid: cookies.get("Hm_lvt_bh_ud") || "",
    uid_front: cookies.get("Hm_lvt_bh_ud_uid_front") || "",
    up_time: fields.upTime,
    coupon_id: fields.couponId || "",
    source_alg: fields.sourceAlg || "",
    model_num: "1",
    resUrl: urls.resUrl,
    referrer: urls.referrer,
    position: fields.position || "1",
    llw_source_scene: fields.llwSourceScene || "0",
    site: context.site,
    page_type: context.pageType,
    access_source_site: context.accessSourceSite,
    access_source_page: context.accessSourcePage,
    experimental_grouping: "2",
    browser: DEFAULT_USER_AGENT,
    search_word: "",
    package_id: fields.packageId || "",
    list_layout_type: fields.listLayoutType || "",
    is_business: "0",
    down_type: "0",
    is_commercial: "false",
    voucher_id: fields.voucherId || "",
    file_format: fileFormat,
    renderer_type: rendererType,
    format_version: formatVersion,
    ab: fields.ab || "",
    algorithm_type: fields.algorithmType || "",
    algorithm_version: fields.algorithmVersion || "",
    request_id: fields.requestId || ""
  });

  if (!fileFormat) payload.delete("file_format");
  return payload;
}

function validateDynamicFields(fields) {
  const missing = [];
  if (!fields.llId) missing.push("ll_id/sof");
  if (!fields.token) missing.push("token");
  if (!fields.upTime) missing.push("up_time");

  if (missing.length) {
    throw httpError(`Cannot build 3D66 download request. Missing: ${missing.join(", ")}`, 422);
  }
}

function snippetAround(html = "", pattern, radius = 220) {
  const match = html.match(pattern);
  if (!match) return "";
  const index = Math.max(0, match.index - radius);
  return decodeHtml(html.slice(index, Math.min(html.length, match.index + match[0].length + radius)));
}

function compactTextSample(html = "", length = 1200) {
  return stripTags(html)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, length);
}

function detectUnexpectedPage(html = "") {
  const text = compactTextSample(html, 1600);
  return {
    hasHtmlTag: /<html\b/i.test(html),
    hasTitleTag: /<title\b/i.test(html),
    hasScriptOnlyShell: /<script\b/i.test(html) && !/model-name|detail_data|og:image|swiper_max_html/i.test(html),
    looksLikeChallenge:
      /acw_sc|acw_tc|aliyun|captcha|riddler|security|challenge|verify|验证|安全|访问异常|滑块/i.test(html + text),
    looksLikeLogin:
      /login|登录|请先登录|sign in/i.test(html + text),
    looksLikeNotFound:
      /404|not found|页面不存在|资源不存在|已下架/i.test(html + text)
  };
}

function shouldUseBrowserPage(html = "", metadata = {}, fields = {}, requireDownloadFields = false) {
  if (process.env.THREED66_BROWSER_ALWAYS === "true") return true;
  if (process.env.THREED66_DISABLE_BROWSER_PAGE_FALLBACK === "true") return false;

  const diagnostics = detectUnexpectedPage(html);
  if (diagnostics.looksLikeChallenge || diagnostics.hasScriptOnlyShell) return true;

  if (requireDownloadFields && (!fields.llId || !fields.token || !fields.upTime)) return true;

  const title = String(metadata.title || "").trim();
  const productId = String(metadata.productId || fields.llId || "").trim();
  const hasBasicMetadata = Boolean(
    !requireDownloadFields &&
      productId &&
      title &&
      title !== "3D66 model" &&
      title !== productId,
  );
  if (hasBasicMetadata) return false;

  const creditCost = Number(metadata.creditCost || 0);
  const priceKnown = Boolean(metadata.priceKnown || creditCost > 1);
  return Boolean(!title || title === "3D66 model" || creditCost <= 0 || (!priceKnown && creditCost <= 1));
}

function isWeakMetadata(metadata = {}) {
  const title = String(metadata.title || "").trim();
  const creditCost = Number(metadata.creditCost || 0);
  const priceKnown = Boolean(metadata.priceKnown || creditCost > 1);
  return Boolean(!title || title === "3D66 model" || creditCost <= 0 || (!priceKnown && creditCost <= 1));
}

async function fetch3D66PageWithBrowserFallback(url, cookieValue, originalError = null) {
  try {
    return await fetch3D66PageWithBrowser(url, cookieValue);
  } catch (error) {
    if (isPlaywrightMissing(error) && originalError) throw originalError;
    if (isPlaywrightMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function download3D66WithBrowserFallback(url, cookieValue, originalError = null, options = {}) {
  try {
    return await download3D66WithBrowser(url, cookieValue, options);
  } catch (error) {
    if (isPlaywrightMissing(error) && originalError) throw originalError;
    if (isPlaywrightMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function inspect3D66DownloadFormatsWithBrowserFallback(url, cookieValue) {
  if (
    process.env.THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK === "true" &&
    modelResolveMode() !== "footprint"
  ) {
    return null;
  }
  try {
    return await inspect3D66DownloadFormatsWithBrowser(url, cookieValue);
  } catch (error) {
    if (isPlaywrightMissing(error)) return null;
    return null;
  }
}

function mergeBrowserFields(fields = {}, browserMetadata = {}) {
  const browserFields = browserMetadata.dynamicFields || {};
  return {
    ...fields,
    llId: browserFields.llId || browserMetadata.productId || fields.llId,
    sign: browserFields.sign || fields.sign,
    token: browserFields.token || fields.token,
    upTime: browserFields.upTime || fields.upTime,
    actionId: browserFields.actionId || fields.actionId,
    fileFormat: browserFields.fileFormat || fields.fileFormat,
    site: browserFields.site || fields.site,
    pageType: browserFields.pageType || fields.pageType,
    requestId: browserFields.requestId || fields.requestId,
    sourceAlg: browserFields.sourceAlg || fields.sourceAlg,
    position: browserFields.position || fields.position,
    llwSourceScene: browserFields.llwSourceScene || fields.llwSourceScene,
    listLayoutType: browserFields.listLayoutType || fields.listLayoutType,
    ab: browserFields.ab || fields.ab,
    algorithmType: browserFields.algorithmType || fields.algorithmType,
    algorithmVersion: browserFields.algorithmVersion || fields.algorithmVersion,
    accessSourceSite: browserFields.accessSourceSite || fields.accessSourceSite,
    accessSourcePage: browserFields.accessSourcePage || fields.accessSourcePage,
    rendererType: browserFields.rendererType || fields.rendererType,
    formatVersion: browserFields.formatVersion || fields.formatVersion
  };
}

function mergeBrowserMetadata(metadata = {}, browserMetadata = {}, fields = {}) {
  const browserCost = Number(browserMetadata.creditCost || 0);
  return {
    productId: browserMetadata.productId || metadata.productId || fields.llId || "",
    title: browserMetadata.title || metadata.title || fields.llId || "3D66 model",
    imageUrl: browserMetadata.imageUrl || metadata.imageUrl || "",
    creditCost: browserCost > 0 ? browserCost : metadata.creditCost || 1,
    priceKnown: Boolean(browserMetadata.priceKnown || metadata.priceKnown || browserCost > 1),
    formatOptions: metadata.formatOptions || browserMetadata.formatOptions || fields.formatOptions || [],
    selectedFormat: metadata.selectedFormat || browserMetadata.selectedFormat || fields.selectedFormat || null,
    sourceUrl: browserMetadata.sourceUrl || metadata.sourceUrl || ""
  };
}

async function requestDownloadPop(fields, cookieValue, context) {
  if (!fields.llId) return null;
  const endpoint = process.env.THREED66_DOWNLOAD_POP_ENDPOINT || DEFAULT_DOWNLOAD_POP_ENDPOINT;
  const { controller, done } = withTimeout();
  const payload = new URLSearchParams({
    sof: fields.llId,
    res_type: context.site || "1"
  });

  try {
    const response = await fetch3D66(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        cookie: cookieValue,
        origin: context.origin,
        referer: `${context.origin}/`,
        "user-agent": DEFAULT_USER_AGENT,
        "x-requested-with": "XMLHttpRequest"
      },
      body: payload
    }, { stage: "api" });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw httpError("3D66 download pop returned non-JSON response", 502, { body: text.slice(0, 300) });
    }

    if (!response.ok || Number(json.status || json.code) !== 200) {
      throw httpError(`3D66 download pop failed: ${json.msg || `HTTP ${response.status}`}`, 502, {
        response: json
      });
    }

    return json.data || null;
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError("3D66 download pop timed out", 504);
    }
    if (error.status) throw error;
    throw httpError(`3D66 download pop request failed: ${error.message}`, 502);
  } finally {
    done();
  }
}

function mergeDownloadPopFields(fields = {}, popData = {}) {
  const resInfo = popData.resInfo || {};
  const priceInfo = popData.user?.priceInfo || {};
  const discount = priceInfo.discount_arr || {};
  const formatOptions = uniqueFormatOptions([
    ...(fields.formatOptions || []),
    ...formatOptionsFromAny(popData),
  ]);
  const isDirectDownload =
    Number(popData.is_direct_download || 0) === 1 ||
    [3, 4].includes(Number(popData.download_status || 0));
  return {
    ...fields,
    llId: fields.llId || resInfo.sof || "",
    token: fields.token || popData.token || "",
    upTime: fields.upTime || currentUnixSeconds(),
    site: fields.site || resInfo.res_type || "",
    needtype: fields.needtype || (isDirectDownload ? "1" : configuredPaytypeValue()),
    couponId: fields.couponId || discount.coupon_id || "",
    voucherId: fields.voucherId || discount.voucher_id || "",
    packageId: fields.packageId || (discount.package_id ? String(discount.package_id) : ""),
    formatOptions,
    selectedFormat: fields.selectedFormat || formatOptions.find((option) => option.isDefault) || formatOptions[0] || null,
  };
}

function mergeDownloadPopMetadata(metadata = {}, popData = {}, pageUrl = "", fields = {}) {
  const resInfo = popData.resInfo || {};
  const popCost = Number(resInfo.res_price || extractCreditCost(popData) || 0);
  const formatOptions = uniqueFormatOptions([
    ...(metadata.formatOptions || []),
    ...(fields.formatOptions || []),
    ...formatOptionsFromAny(popData),
  ]);
  return {
    productId: metadata.productId || resInfo.sof || fields.llId || "",
    title: resInfo.res_name || metadata.title || fields.llId || "3D66 model",
    imageUrl: absoluteUrl(resInfo.img, pageUrl) || metadata.imageUrl || "",
    creditCost: popCost > 0 ? popCost : metadata.creditCost || 1,
    priceKnown: Boolean(popCost > 0 || metadata.priceKnown),
    formatOptions,
    selectedFormat:
      metadata.selectedFormat ||
      fields.selectedFormat ||
      formatOptions.find((option) => option.isDefault) ||
      formatOptions[0] ||
      null,
    sourceUrl: metadata.sourceUrl || pageUrl
  };
}

function downloadPopChoiceValue(popData = {}) {
  const candidates = [
    popData?.user?.priceInfo?.is_choice,
    popData?.priceInfo?.is_choice,
    popData?.resInfo?.is_choice,
    popData?.is_choice,
  ];
  return candidates.find((value) => value !== undefined && value !== null && String(value) !== "");
}

function hasDownloadFormatChoice(popData = {}) {
  const choiceValue = downloadPopChoiceValue(popData);
  if (choiceValue === undefined) return null;
  return Number(choiceValue) === 1;
}

function downloadRequestIdSuffix(json = {}) {
  const requestId = String(json.request_id || json.requestId || "").trim();
  return requestId ? ` (${requestId})` : "";
}

function map3D66DownloadFailure(json = {}, fallbackMessage = "missing download URL") {
  const rawMessage = String(json.msg || json.message || fallbackMessage || "").trim();
  const combined = `${rawMessage} ${JSON.stringify(json)}`;
  const requestId = downloadRequestIdSuffix(json);

  if (
    /\u5df2\u4e0b\u67b6|\u91cd\u65b0\u6311\u9009|\u5df2\u5220\u9664|\u8d44\u6e90\u4e0d\u5b58\u5728|not\s*found/i.test(
      combined,
    )
  ) {
    return httpError(
      `Model này đã bị 3D66 gỡ khỏi kho. Vui lòng chọn model khác.${requestId}`,
      410,
      { code: "THREED66_MODEL_REMOVED", response: json },
    );
  }

  return httpError(
    `3D66 download failed: ${rawMessage || fallbackMessage}${requestId}`,
    502,
    { response: json },
  );
}

async function enrichFromDownloadPop(fields, metadata, pageUrl, cookieValue, context) {
  let nextFields = { ...fields };
  let nextMetadata = { ...metadata };
  if (!nextFields.llId) {
    return { fields: nextFields, metadata: nextMetadata };
  }

  if (!nextFields.upTime) {
    nextFields.upTime = currentUnixSeconds();
  }

  if (nextFields.token && !isWeakMetadata(nextMetadata)) {
    return { fields: nextFields, metadata: nextMetadata };
  }

  try {
    const popData = await requestDownloadPop(nextFields, cookieValue, context);
    if (popData) {
      nextFields = mergeDownloadPopFields(nextFields, popData);
      nextMetadata = mergeDownloadPopMetadata(nextMetadata, popData, pageUrl, nextFields);
    }
  } catch {
    // Keep the existing browser fallback path when the lightweight popup API is unavailable.
  }

  return { fields: nextFields, metadata: nextMetadata };
}

async function previewFromDownloadPopOnly(url, cookieValue, cookies) {
  const fields = parseDynamicFields("", url);
  if (!fields.llId) return null;
  const context = applyFieldsToContext(siteContext(url, cookies), fields);
  const metadata = {
    productId: fields.llId,
    title: "3D66 model",
    imageUrl: "",
    creditCost: 1,
    priceKnown: false,
    sourceUrl: url
  };
  const enriched = await enrichFromDownloadPop(fields, metadata, url, cookieValue, context);
  return isWeakMetadata(enriched.metadata) ? null : enriched;
}

async function requestDownloadUrl(payload, cookieValue, origin) {
  const endpoint = process.env.THREED66_DOWNLOAD_ENDPOINT || DEFAULT_DOWNLOAD_ENDPOINT;
  const { controller, done } = withTimeout();

  try {
    const response = await fetch3D66(endpoint, {
      method: "POST",
      signal: controller.signal,
      headers: {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        cookie: cookieValue,
        origin,
        referer: `${origin}/`,
        "user-agent": DEFAULT_USER_AGENT,
        "x-requested-with": "XMLHttpRequest"
      },
      body: payload
    }, { stage: "api" });

    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw httpError("3D66 download API returned non-JSON response", 502, { body: text.slice(0, 300) });
    }

    if (!response.ok) {
      throw map3D66DownloadFailure(json, `HTTP ${response.status}`);
    }

    const fileUrl = extractDownloadFileUrl(json);
    if (fileUrl) {
      return {
        fileUrl,
        creditCost: extractCreditCost(json)
      };
    }

    throw map3D66DownloadFailure(json, "missing download URL");
  } catch (error) {
    if (error.name === "AbortError") {
      throw httpError("3D66 download API timed out", 504);
    }
    if (error.status) throw error;
    throw httpError(`3D66 download API request failed: ${error.message}`, 502);
  } finally {
    done();
  }
}

function extractCreditCost(value) {
  const candidates = [];
  const priceKeys = new Set([
    "credit",
    "credits",
    "price",
    "download_price",
    "need_xzb",
    "xzb",
    "xuan_dian",
    "cost",
    "download_cost"
  ]);

  function visit(node) {
    if (!node || typeof node !== "object") return;
    for (const [key, raw] of Object.entries(node)) {
      const normalizedKey = key.toLowerCase();
      if (priceKeys.has(normalizedKey)) {
        const number = Number(String(raw).replace(/[^\d.]/g, ""));
        if (Number.isFinite(number) && number > 0) candidates.push(number);
      }
      if (typeof raw === "object") visit(raw);
    }
  }

  visit(value);
  return candidates.length ? candidates[0] : 1;
}

export async function validate3D66Cookie(cookieValue, modelUrl = "") {
  requireCookie(cookieValue);

  if (!modelUrl) {
    return { ok: true, mode: "cookie-keys" };
  }

  const normalized = normalizeModelUrl(modelUrl);
  const { html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue);
  const fields = parseDynamicFields(html, pageUrl);
  return {
    ok: true,
    mode: "model-page",
    pageUrl,
    hasLlId: Boolean(fields.llId),
    hasToken: Boolean(fields.token),
    hasUpTime: Boolean(fields.upTime)
  };
}

export async function fetch3D66Preview(url, cookieValue) {
  if (process.env.THREED66_MOCK !== "false") {
    const digest = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
    return {
      productId: digest,
      title: "Mock 3D66 model",
      imageUrl: "",
      creditCost: 1,
      priceKnown: true,
      sourceUrl: url
    };
  }

  const cookies = requireCookie(cookieValue);
  const accountModel = await resolveAccountModelUrl(url, cookieValue, cookies);
  const normalized = normalizeModelUrl(accountModel.url);
  const requestedProductId = accountModel.productId || requestedProductIdFromUrl(normalized.toString());
  const popPreview = await previewFromDownloadPopOnly(normalized.toString(), cookieValue, cookies);
  if (popPreview) return popPreview.metadata;

  let browserMetadata = null;
  let html = "";
  let pageUrl = normalized.toString();
  if (shouldAlwaysUseBrowserPage()) {
    const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue);
    if (browserPage) {
      browserMetadata = browserPage.metadata;
      html = browserPage.html;
      pageUrl = browserPage.pageUrl || normalized.toString();
    }
  }
  if (!browserMetadata) {
    ({ html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue).catch(async (error) => {
      if (!shouldFallbackToBrowserPage(error)) throw error;
      const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue, error);
      browserMetadata = browserPage.metadata;
      return { html: browserPage.html, pageUrl: browserPage.pageUrl || normalized.toString() };
    }));
  }
  let fields = parseDynamicFields(html, pageUrl);
  let metadata = parseModelMetadata(html, pageUrl, fields);
  if (browserMetadata) {
    fields = mergeBrowserFields(fields, browserMetadata);
    metadata = mergeBrowserMetadata(metadata, browserMetadata, fields);
  }

  if (!browserMetadata && isWeakMetadata(metadata)) {
    const context = applyFieldsToContext(siteContext(pageUrl, cookies), fields);
    ({ fields, metadata } = await enrichFromDownloadPop(fields, metadata, pageUrl, cookieValue, context));
  }

  if (!browserMetadata && shouldUseBrowserPage(html, metadata, fields)) {
    const browserPage = await fetch3D66PageWithBrowserFallback(pageUrl || normalized.toString(), cookieValue);
    if (browserPage) {
      html = browserPage.html;
      pageUrl = browserPage.pageUrl;
      fields = mergeBrowserFields(parseDynamicFields(html, pageUrl), browserPage.metadata);
      metadata = mergeBrowserMetadata(parseModelMetadata(html, pageUrl, fields), browserPage.metadata, fields);
    }
  }

  ({ fields, metadata } = enforceRequestedProductId(fields, metadata, requestedProductId));
  return metadata;
}

export async function inspect3D66Page(url, cookieValue) {
  const cookies = requireCookie(cookieValue);
  const accountModel = await resolveAccountModelUrl(url, cookieValue, cookies);
  const normalized = normalizeModelUrl(accountModel.url);
  const requestedProductId = accountModel.productId || requestedProductIdFromUrl(normalized.toString());
  let browserMetadata = null;
  let html = "";
  let pageUrl = normalized.toString();
  if (shouldAlwaysUseBrowserPage()) {
    const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue);
    if (browserPage) {
      browserMetadata = browserPage.metadata;
      html = browserPage.html;
      pageUrl = browserPage.pageUrl || normalized.toString();
    }
  }
  if (!browserMetadata) {
    ({ html, pageUrl } = await fetchModelPage(normalized.toString(), cookieValue).catch(async (error) => {
      if (!shouldFallbackToBrowserPage(error)) throw error;
      const browserPage = await fetch3D66PageWithBrowserFallback(normalized.toString(), cookieValue, error);
      browserMetadata = browserPage.metadata;
      return { html: browserPage.html, pageUrl: browserPage.pageUrl || normalized.toString() };
    }));
  }
  let fields = parseDynamicFields(html, pageUrl);
  let metadata = parseModelMetadata(html, pageUrl, fields);
  let usedBrowser = Boolean(browserMetadata);
  if (browserMetadata) {
    fields = mergeBrowserFields(fields, browserMetadata);
    metadata = mergeBrowserMetadata(metadata, browserMetadata, fields);
  }

  if (!browserMetadata && shouldUseBrowserPage(html, metadata, fields)) {
    const browserPage = await fetch3D66PageWithBrowserFallback(pageUrl || normalized.toString(), cookieValue);
    if (browserPage) {
      html = browserPage.html;
      pageUrl = browserPage.pageUrl;
      fields = mergeBrowserFields(parseDynamicFields(html, pageUrl), browserPage.metadata);
      metadata = mergeBrowserMetadata(parseModelMetadata(html, pageUrl, fields), browserPage.metadata, fields);
      usedBrowser = true;
    }
  }
  ({ fields, metadata } = enforceRequestedProductId(fields, metadata, requestedProductId));

  const detailData = parseDetailData(html);

  return {
    pageUrl,
    htmlLength: html.length,
    metadata,
    dynamicFields: {
      llId: fields.llId || "",
      hasSign: Boolean(fields.sign),
      hasToken: Boolean(fields.token),
      hasUpTime: Boolean(fields.upTime)
    },
    found: {
      detailData: Boolean(detailData),
      modelName: /model-name/i.test(html),
      ogImage: /og:image/i.test(html),
      orginalPrice: /orginal-price|original-price|下载币/i.test(html)
    },
    pageDiagnostics: detectUnexpectedPage(html),
    usedBrowser,
    snippets: {
      title: snippetAround(html, /<title[\s\S]*?<\/title>/i),
      modelName: snippetAround(html, /<h1\b(?=[^>]*model-name)[\s\S]*?<\/h1>/i),
      ogImage: snippetAround(html, /<meta\b(?=[^>]*(?:og:image|twitter:image))[^>]*>/i),
      price: snippetAround(html, /(?:orginal-price|original-price|下载币)/i),
      detailData: snippetAround(html, /id=["']detail_data["']/i),
      htmlStart: decodeHtml(html.slice(0, 1800)),
      textStart: compactTextSample(html, 1800)
    }
  };
}

export async function request3D66File(fileUrl, cookieValue, options = {}) {
  requireCookie(cookieValue);
  if (!isAllowed3D66DownloadUrl(fileUrl)) {
    throw httpError("Only 3d66.com download links are supported", 400);
  }
  const parsedFileUrl = new URL(fileUrl);
  const sourceUrl = stripInternalUrlHash(
    options.sourceUrl || process.env.THREED66_ORIGIN || "https://3d.3d66.com/",
  );
  const origin = new URL(sourceUrl).origin;
  const headers = {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
    "accept-language": "vi,en-US;q=0.9,en;q=0.8,zh-CN;q=0.7,zh;q=0.6",
    "cache-control": "no-cache",
    cookie: cookieValue,
    pragma: "no-cache",
    referer: sourceUrl,
    "sec-ch-ua": '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": isAllowed3D66Host(parsedFileUrl.hostname) ? "same-site" : "cross-site",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
    "user-agent": DEFAULT_USER_AGENT
  };

  if (origin && process.env.THREED66_DOWNLOAD_SEND_ORIGIN === "true") {
    headers.origin = origin;
  }

  if (options.range) headers.range = options.range;

  return fetch3D66DownloadWithRedirects(fileUrl, {
    signal: options.signal,
    headers
  });
}

export async function inspect3D66DownloadFormats(url, cookieValue) {
  const cookies = requireCookie(cookieValue);
  const accountModel = await resolveAccountModelUrl(url, cookieValue, cookies, {
    stage: "download",
  });
  const normalized = normalizeModelUrl(accountModel.url);
  const inspection = await inspect3D66DownloadFormatsWithBrowserFallback(
    normalized.toString(),
    accountModel.cookieValue || cookieValue,
  );
  if (!inspection) return inspection;
  const inspectedSourceUrl =
    inspection.sourceUrl || inspection.pageUrl || normalized.toString();
  const resolvedSourceUrl = accountModel.usedFootprint
    ? markFootprintResolvedUrl(inspectedSourceUrl, accountModel.productId)
    : inspectedSourceUrl;
  return {
    ...inspection,
    productId: accountModel.productId || inspection.productId,
    sourceUrl: url,
    resolvedSourceUrl,
    metadata: inspection.metadata
      ? {
          ...inspection.metadata,
          productId: accountModel.productId || inspection.metadata.productId,
          sourceUrl: url,
          resolvedSourceUrl,
        }
      : inspection.metadata,
  };
}

export async function inspect3D66DownloadChoice(url, cookieValue) {
  const cookies = requireCookie(cookieValue);
  const accountModel = await resolveAccountModelUrl(url, cookieValue, cookies, {
    stage: "download",
  });
  const normalized = normalizeModelUrl(accountModel.url);
  const effectiveCookieValue = accountModel.cookieValue || cookieValue;
  const effectiveCookies = requireCookie(effectiveCookieValue);
  const fields = parseDynamicFields("", normalized.toString());
  if (!fields.llId) return null;

  const context = applyFieldsToContext(
    siteContext(normalized.toString(), effectiveCookies),
    fields,
  );
  const popData = await requestDownloadPop(fields, effectiveCookieValue, context);
  if (!popData) return null;

  const mergedFields = mergeDownloadPopFields(fields, popData);
  const metadata = mergeDownloadPopMetadata(
    {
      productId: fields.llId,
      title: "3D66 model",
      imageUrl: "",
      creditCost: 1,
      priceKnown: false,
      sourceUrl: normalized.toString(),
    },
    popData,
    normalized.toString(),
    mergedFields,
  );
  metadata.productId = accountModel.productId || metadata.productId;
  metadata.sourceUrl = url;
  metadata.resolvedSourceUrl = accountModel.usedFootprint
    ? markFootprintResolvedUrl(normalized.toString(), accountModel.productId)
    : normalized.toString();
  const formatOptions = uniqueFormatOptions([
    ...(mergedFields.formatOptions || []),
    ...(metadata.formatOptions || []),
  ]);

  return {
    hasFormatChoice: hasDownloadFormatChoice(popData),
    choiceValue: downloadPopChoiceValue(popData),
    fields: mergedFields,
    metadata,
    formatOptions,
  };
}

export async function fetchFrom3D66(url, cookieValue, options = {}) {
  if (process.env.THREED66_MOCK !== "false") {
    const digest = crypto.createHash("sha256").update(url).digest("hex").slice(0, 16);
    const selectedFormat = normalizeDownloadFormatOption(
      options.downloadFormat || { fileFormat: "1", formatVersion: "max2018", rendererType: "4", label: "3Dmax" },
      0,
      true,
    );
    return {
      fileUrl: `https://download.mock-3d66.local/${digest}.zip`,
      productId: digest,
      sourceUrl: url,
      resolvedSourceUrl: url,
      title: "Mock 3D66 model",
      imageUrl: "",
      creditCost: 1,
      priceKnown: true,
      formatOptions: selectedFormat ? [selectedFormat] : [],
      selectedFormat
    };
  }

  const initialCookies = requireCookie(cookieValue);
  const originalSourceUrl = options.sourceUrl || url;
  const accountModel = await resolveAccountModelUrl(url, cookieValue, initialCookies, {
    stage: "download",
  });
  const normalized = normalizeModelUrl(accountModel.url);
  const logicalProductId =
    accountModel.productId || requestedProductIdFromUrl(normalized.toString());
  const persistentResolvedSourceUrl = (value) =>
    accountModel.usedFootprint
      ? markFootprintResolvedUrl(
          value || normalized.toString(),
          logicalProductId || accountModel.productId,
        )
      : value || normalized.toString();
  const requestedProductId =
    accountModel.resolvedProductId ||
    requestedProductIdFromUrl(normalized.toString()) ||
    logicalProductId;
  let effectiveCookieValue = accountModel.cookieValue || cookieValue;
  let browserMetadata = null;
  const requestedFormat = options.downloadFormat
    ? normalizeDownloadFormatOption(options.downloadFormat, 0, false)
    : null;
  let effectiveCookies = requireCookie(effectiveCookieValue);
  const popPreview = await previewFromDownloadPopOnly(
    normalized.toString(),
    effectiveCookieValue,
    effectiveCookies,
  );
  let seedFields = popPreview?.fields || null;
  let seedMetadata = popPreview?.metadata || null;
  let html = "";
  let pageUrl = normalized.toString();
  if (!seedFields || !seedMetadata) {
    if (shouldAlwaysUseBrowserPage()) {
      const browserPage = await fetch3D66PageWithBrowserFallback(
        normalized.toString(),
        effectiveCookieValue,
      );
      if (browserPage) {
        browserMetadata = browserPage.metadata;
        effectiveCookieValue = browserPage.cookieValue || effectiveCookieValue;
        html = browserPage.html;
        pageUrl = browserPage.pageUrl || normalized.toString();
      }
    }
    if (!browserMetadata) {
      ({ html, pageUrl } = await fetchModelPage(
        normalized.toString(),
        effectiveCookieValue,
      ).catch(async (error) => {
        if (!shouldFallbackToBrowserPage(error)) throw error;
        const browserPage = await fetch3D66PageWithBrowserFallback(
          normalized.toString(),
          effectiveCookieValue,
          error,
        );
        browserMetadata = browserPage.metadata;
        effectiveCookieValue = browserPage.cookieValue || effectiveCookieValue;
        return { html: browserPage.html, pageUrl: browserPage.pageUrl || normalized.toString() };
      }));
    }
  }
  let fields = seedFields || parseDynamicFields(html, pageUrl);
  let metadata = seedMetadata || parseModelMetadata(html, pageUrl, fields);
  if (browserMetadata) {
    fields = mergeBrowserFields(fields, browserMetadata);
    metadata = mergeBrowserMetadata(metadata, browserMetadata, fields);
    effectiveCookies = requireCookie(effectiveCookieValue);
  }

  let context = applyFieldsToContext(siteContext(pageUrl, effectiveCookies), fields);
  if (!browserMetadata) {
    ({ fields, metadata } = await enrichFromDownloadPop(fields, metadata, pageUrl, effectiveCookieValue, context));
    applyFieldsToContext(context, fields);
  }

  if (!browserMetadata && shouldUseBrowserPage(html, metadata, fields, true)) {
    const browserPage = await fetch3D66PageWithBrowserFallback(
      pageUrl || normalized.toString(),
      effectiveCookieValue,
    );
    if (browserPage) {
      html = browserPage.html;
      pageUrl = browserPage.pageUrl;
      effectiveCookieValue = browserPage.cookieValue || effectiveCookieValue;
      fields = mergeBrowserFields(parseDynamicFields(html, pageUrl), browserPage.metadata);
      metadata = mergeBrowserMetadata(parseModelMetadata(html, pageUrl, fields), browserPage.metadata, fields);
      effectiveCookies = requireCookie(effectiveCookieValue);
      context = applyFieldsToContext(siteContext(pageUrl, effectiveCookies), fields);
    }
  }

  ({ fields, metadata } = enforceRequestedProductId(fields, metadata, requestedProductId));
  ({ fields, metadata } = applySelectedFormat(fields, metadata, requestedFormat));

  if (!fields.llId || !fields.token || !fields.upTime) {
    if (
      process.env.THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK === "true" &&
      !accountModel.usedFootprint
    ) {
      validateDynamicFields(fields);
    }
    const browserDownload = await download3D66WithBrowserFallback(
      pageUrl || normalized.toString(),
      effectiveCookieValue,
      null,
      { downloadFormat: requestedFormat },
    );
    if (browserDownload) {
      return {
        ...browserDownload,
        productId: logicalProductId || browserDownload.productId,
        sourceUrl: originalSourceUrl,
        resolvedSourceUrl: persistentResolvedSourceUrl(
          browserDownload.sourceUrl || pageUrl,
        ),
      };
    }
    validateDynamicFields(fields);
  }

  const urls = buildModelUrls(pageUrl, fields);
  applyFieldsToContext(context, fields);
  const payload = buildDownloadPayload(fields, urls, effectiveCookies, context);
  let download;
  try {
    download = await requestDownloadUrl(payload, effectiveCookieValue, context.origin);
  } catch (error) {
    if (
      accountModel.usedFootprint ||
      (
        process.env.THREED66_DOWNLOAD_HANDLE_BROWSER_FALLBACK === "true" &&
        process.env.THREED66_DISABLE_BROWSER_DOWNLOAD_FALLBACK !== "true"
      )
    ) {
      const browserDownload = await download3D66WithBrowserFallback(
        pageUrl || normalized.toString(),
        effectiveCookieValue,
        error,
        { downloadFormat: requestedFormat },
      );
      if (browserDownload) {
        return {
          ...browserDownload,
          productId: logicalProductId || browserDownload.productId,
          sourceUrl: originalSourceUrl,
          resolvedSourceUrl: persistentResolvedSourceUrl(
            browserDownload.sourceUrl || pageUrl,
          ),
        };
      }
    }
    throw error;
  }
  return {
    fileUrl: download.fileUrl,
    productId: logicalProductId || fields.llId,
    sourceUrl: originalSourceUrl,
    resolvedSourceUrl: persistentResolvedSourceUrl(pageUrl),
    title: metadata.title,
    imageUrl: metadata.imageUrl,
    creditCost: download.creditCost || metadata.creditCost,
    formatOptions: metadata.formatOptions || [],
    selectedFormat: metadata.selectedFormat || fields.selectedFormat || null,
    priceKnown: Boolean(
      download.priceKnown ||
        metadata.priceKnown ||
        Number(download.creditCost || metadata.creditCost || 0) > 1,
    )
  };
}
