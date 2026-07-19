import { notify3D66ProxyFallback } from "./telegramNotifier.js";

const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BROWSER_CONCURRENCY = 2;
const DEFAULT_BROWSER_QUEUE_MAX = 50;
const DEFAULT_BROWSER_MAX_TASKS = 100;
const DEFAULT_BROWSER_MAX_AGE_MS = 30 * 60 * 1000;
const FOOTPRINT_URL = "https://user.3d66.com/newUser/index/index/footprint";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

// Defense-in-depth SSRF guard: dam bao Playwright khong navigate ra ngoai 3d66.com,
// ngay ca khi caller pass URL da bi redirect (response.url) ra external host.
// Neu khong guard: cookie 3D66 admin co the bi gui den evil.com qua cookieOrigins -> credential leak.
function assertSafe3D66Url(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    const error = new Error("3D66 browser navigation: invalid URL");
    error.status = 400;
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("3D66 browser navigation: only HTTP(S) allowed");
    error.status = 400;
    throw error;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== "3d66.com" && !host.endsWith(".3d66.com")) {
    const error = new Error(
      `3D66 browser navigation blocked for non-3d66 host: ${host}`,
    );
    error.status = 400;
    throw error;
  }
  return parsed;
}

function stripInternalUrlHash(rawUrl) {
  const parsed = assertSafe3D66Url(rawUrl);
  parsed.hash = "";
  return parsed.toString();
}

let browserPromise = null;
let activeBrowser = null;
let browserLaunchedAt = 0;
let browserTasksSinceLaunch = 0;
let browserRecyclePending = false;
let activeBrowserTasks = 0;
const browserTaskQueue = [];

function numberEnv(name, fallback) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function timeoutMs() {
  const value = numberEnv("THREED66_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  return value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

function navigationWaitUntil() {
  const value = String(process.env.THREED66_BROWSER_WAIT_UNTIL || "commit")
    .trim()
    .toLowerCase();
  return ["commit", "domcontentloaded", "load", "networkidle"].includes(value)
    ? value
    : "commit";
}

function postCommitWaitMs() {
  return numberEnv("THREED66_BROWSER_POST_COMMIT_WAIT_MS", 1200);
}

function footprintRefreshAttempts() {
  const value = numberEnv("THREED66_FOOTPRINT_REFRESH_ATTEMPTS", 4);
  return Math.min(8, Math.max(1, Math.floor(value)));
}

function footprintRefreshDelayMs() {
  return Math.max(250, numberEnv("THREED66_FOOTPRINT_REFRESH_DELAY_MS", 1500));
}

function navigationRetries() {
  const value = numberEnv("THREED66_BROWSER_NAV_RETRIES", 2);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function retryDelayMs(attempt) {
  return numberEnv("THREED66_BROWSER_RETRY_DELAY_MS", 1200) * attempt;
}

function shouldBlockAssets() {
  return process.env.THREED66_BROWSER_BLOCK_ASSETS !== "false";
}

function booleanEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return value === "true" || value === "1" || value === 1 || value === true;
}

function proxyFailClosed() {
  return booleanEnv("THREED66_PROXY_FAIL_CLOSED", false);
}

function maskProxyUrl(value = "") {
  try {
    const parsed = new URL(value);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    return parsed.toString();
  } catch {
    return "[invalid proxy url]";
  }
}

function browserProxyConfig() {
  if (!booleanEnv("THREED66_PROXY_ENABLED", false)) return null;
  if (!booleanEnv("THREED66_PROXY_FOR_BROWSER", false)) return null;

  const rawUrl = String(process.env.THREED66_PROXY_URL || "").trim();
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    if (!["http:", "https:", "socks5:"].includes(parsed.protocol)) {
      throw new Error("Unsupported proxy protocol");
    }
    const server = `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
    return {
      server,
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    };
  } catch (error) {
    if (!proxyFailClosed()) {
      notify3D66ProxyFallback({
        stage: "browser",
        proxy: maskProxyUrl(rawUrl),
        error,
      });
      return null;
    }

    const proxyError = new Error(`3D66 browser proxy URL is invalid: ${error.message}`);
    proxyError.status = 500;
    throw proxyError;
  }
}

function browserConcurrency() {
  const value = numberEnv(
    "THREED66_BROWSER_CONCURRENCY",
    DEFAULT_BROWSER_CONCURRENCY,
  );
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_BROWSER_CONCURRENCY;
}

function browserQueueMax() {
  const value = numberEnv("THREED66_BROWSER_QUEUE_MAX", DEFAULT_BROWSER_QUEUE_MAX);
  return value > 0 ? Math.floor(value) : DEFAULT_BROWSER_QUEUE_MAX;
}

function browserMaxTasks() {
  return Math.floor(numberEnv("THREED66_BROWSER_MAX_TASKS", DEFAULT_BROWSER_MAX_TASKS));
}

function browserMaxAgeMs() {
  return numberEnv("THREED66_BROWSER_MAX_AGE_MS", DEFAULT_BROWSER_MAX_AGE_MS);
}

function shouldRecycleBrowser() {
  if (!activeBrowser?.isConnected?.()) return false;

  const maxTasks = browserMaxTasks();
  if (maxTasks > 0 && browserTasksSinceLaunch >= maxTasks) return true;

  const maxAgeMs = browserMaxAgeMs();
  return maxAgeMs > 0 && browserLaunchedAt > 0 && Date.now() - browserLaunchedAt >= maxAgeMs;
}

async function importChromium() {
  try {
    const { chromium } = await import("playwright");
    return chromium;
  } catch {
    const error = new Error(
      "Playwright is not installed. Run `cd backend && npm install playwright && npx playwright install chromium`.",
    );
    error.status = 500;
    error.code = "PLAYWRIGHT_NOT_INSTALLED";
    throw error;
  }
}

async function closeActiveBrowser() {
  const browser = activeBrowser;
  activeBrowser = null;
  browserPromise = null;
  browserLaunchedAt = 0;
  browserTasksSinceLaunch = 0;
  browserRecyclePending = false;

  if (browser) {
    await browser.close().catch(() => {});
  }
}

async function recycleBrowserIfIdle() {
  if (activeBrowserTasks > 0) return;
  if (!browserRecyclePending && !shouldRecycleBrowser()) return;
  await closeActiveBrowser();
}

async function getSharedBrowser() {
  if (activeBrowser?.isConnected?.()) return activeBrowser;
  if (!browserPromise) {
    browserPromise = (async () => {
      const chromium = await importChromium();
      const browser = await chromium.launch({
        headless: process.env.THREED66_BROWSER_HEADLESS !== "false",
      });
      activeBrowser = browser;
      browserLaunchedAt = Date.now();
      browserTasksSinceLaunch = 0;
      browserRecyclePending = false;
      browser.on("disconnected", () => {
        if (activeBrowser === browser) activeBrowser = null;
        browserPromise = null;
        browserLaunchedAt = 0;
        browserTasksSinceLaunch = 0;
        browserRecyclePending = false;
      });
      return browser;
    })().catch((error) => {
      browserPromise = null;
      activeBrowser = null;
      browserLaunchedAt = 0;
      browserTasksSinceLaunch = 0;
      browserRecyclePending = false;
      throw error;
    });
  }
  return browserPromise;
}

function pumpBrowserQueue() {
  while (
    activeBrowserTasks < browserConcurrency() &&
    browserTaskQueue.length > 0
  ) {
    const item = browserTaskQueue.shift();
    activeBrowserTasks += 1;
    Promise.resolve()
      .then(item.task)
      .then(item.resolve, item.reject)
      .finally(async () => {
        activeBrowserTasks -= 1;
        await recycleBrowserIfIdle();
        pumpBrowserQueue();
      });
  }
}

function runBrowserTask(task) {
  if (browserTaskQueue.length >= browserQueueMax()) {
    const error = new Error("3D66 browser is busy. Please try again later.");
    error.status = 503;
    return Promise.reject(error);
  }

  return new Promise((resolve, reject) => {
    browserTaskQueue.push({ task, resolve, reject });
    pumpBrowserQueue();
  });
}

async function withBrowserContext(url, cookieValue, callback) {
  return runBrowserTask(async () => {
    const browser = await getSharedBrowser();
    const proxy = browserProxyConfig();
    const runWithProxy = async (currentProxy) => {
      const context = await browser.newContext({
        userAgent: DEFAULT_USER_AGENT,
        locale: "zh-CN",
        viewport: { width: 1440, height: 900 },
        ...(currentProxy ? { proxy: currentProxy } : {}),
      });

      try {
        await installFastRoutes(context);

        const cookies = buildBrowserCookies(cookieValue, url);
        if (cookies.length) {
          await context.addCookies(cookies);
        }

        const page = await context.newPage();
        return await callback({ context, page });
      } finally {
        await context.close().catch(() => {});
        browserTasksSinceLaunch += 1;
        if (shouldRecycleBrowser()) {
          browserRecyclePending = true;
        }
      }
    };

    if (!proxy) return runWithProxy(null);

    try {
      return await runWithProxy(proxy);
    } catch (error) {
      if (proxyFailClosed()) throw error;
      notify3D66ProxyFallback({
        stage: "browser",
        proxy: maskProxyUrl(process.env.THREED66_PROXY_URL || ""),
        error,
      });
      return runWithProxy(null);
    }
  });
}

export async function close3D66Browser() {
  await closeActiveBrowser();
}

async function installFastRoutes(context) {
  if (!shouldBlockAssets()) return;

  await context.route("**/*", async (route) => {
    const request = route.request();
    if (["image", "font", "media"].includes(request.resourceType())) {
      await route.abort();
      return;
    }

    await route.continue();
  });
}

async function waitForModelReady(page, includeDownloadButton = false) {
  if (navigationWaitUntil() === "commit" && postCommitWaitMs() > 0) {
    await page.waitForTimeout(postCommitWaitMs()).catch(() => {});
  }

  const selector = includeDownloadButton
    ? "h1.model-name, #detail_data, .j_download"
    : "h1.model-name, #detail_data, meta[property='og:image'], .llimgs, .orginal-price";

  await page
    .waitForSelector(selector, {
      timeout: Math.min(timeoutMs(), 10000),
    })
    .catch(() => {});

  if (process.env.THREED66_BROWSER_WAIT_NETWORKIDLE === "true") {
    await page
      .waitForLoadState("networkidle", { timeout: 5000 })
      .catch(() => {});
  }
}

async function evaluateMetadataWithRetry(page, includeDownloadButton = false) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await waitForModelReady(page, includeDownloadButton);
      return await page.evaluate(evaluateMetadata);
    } catch (error) {
      lastError = error;
      const message = String(error?.message || "");
      const canRetry =
        /Execution context was destroyed|Cannot find context|Target closed|Frame was detached/i.test(message);
      if (!canRetry || attempt === 3) break;
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(retryDelayMs(attempt)).catch(() => {});
    }
  }

  throw lastError;
}

async function goto3D66Page(page, url) {
  let lastError;
  const attempts = navigationRetries();
  const cleanUrl = stripInternalUrlHash(url);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(cleanUrl, {
        waitUntil: navigationWaitUntil(),
        timeout: timeoutMs(),
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await page.waitForTimeout(retryDelayMs(attempt)).catch(() => {});
    }
  }

  const error = new Error(
    `3D66 browser navigation timed out after ${attempts} attempts. 3D66 may be slow, blocking this server, or the cookie/session needs refresh. ${lastError?.message || ""}`.trim(),
  );
  error.status = lastError?.status || 504;
  error.cause = lastError;
  throw error;
}

function parseCookieHeader(cookieValue = "") {
  return String(cookieValue)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index <= 0) return null;
      return {
        name: part.slice(0, index).trim(),
        value: part.slice(index + 1).trim(),
      };
    })
    .filter(Boolean);
}

function cookieOrigins(modelUrl) {
  const parsed = new URL(modelUrl);
  return Array.from(
    new Set([
      parsed.origin,
      "https://www.3d66.com",
      "https://3d66.com",
      "https://user.3d66.com",
    ]),
  );
}

function buildBrowserCookies(cookieValue, modelUrl) {
  const cookies = parseCookieHeader(cookieValue);
  return cookieOrigins(modelUrl).flatMap((origin) =>
    cookies.map((cookie) => ({
      ...cookie,
      url: origin,
    })),
  );
}

function serializeCookies(cookies = []) {
  const merged = new Map();
  cookies
    .filter((cookie) => /\.?3d66\.com$/i.test(cookie.domain || ""))
    .forEach((cookie) => {
      if (cookie?.name && typeof cookie.value === "string") {
        merged.set(cookie.name, cookie.value);
      }
    });

  return Array.from(merged.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function modelIdFromUrl(value = "") {
  try {
    return String(new URL(value).searchParams.get("sof") || "").trim().toUpperCase();
  } catch {
    return "";
  }
}

function modelIdentityParts(value = "") {
  const match = String(value || "").trim().toUpperCase().match(/^([A-Z]{3})(\d{6,})$/);
  if (!match) return null;
  return { family: match[1].slice(1), digits: match[2] };
}

const MIN_ASSET_ID_SUFFIX_DIGITS = 5;

function commonTrailingDigitCount(left = "", right = "") {
  let count = 0;
  while (
    count < left.length &&
    count < right.length &&
    left[left.length - 1 - count] === right[right.length - 1 - count]
  ) {
    count += 1;
  }
  return count;
}

export function modelIdsShareAssetIdentity(left = "", right = "") {
  const normalizedLeft = String(left || "").trim().toUpperCase();
  const normalizedRight = String(right || "").trim().toUpperCase();
  if (!normalizedLeft || !normalizedRight) return false;
  if (normalizedLeft === normalizedRight) return true;

  const leftParts = modelIdentityParts(normalizedLeft);
  const rightParts = modelIdentityParts(normalizedRight);
  if (!leftParts || !rightParts || leftParts.family !== rightParts.family) return false;
  return (
    commonTrailingDigitCount(leftParts.digits, rightParts.digits) >=
    MIN_ASSET_ID_SUFFIX_DIGITS
  );
}

export function resolvedFootprintUrlMatches(value = "", selectedProductId = "") {
  const resolvedProductId = modelIdFromUrl(value);
  return Boolean(
    resolvedProductId &&
    modelIdsShareAssetIdentity(resolvedProductId, selectedProductId)
  );
}

function footprintCardMatches(card = {}, expectedProductIds = []) {
  const cardId = String(card.productId || "").trim().toUpperCase();
  if (!cardId) return false;
  const expectedIds = expectedProductIds
    .map((value) => String(value || "").trim().toUpperCase())
    .filter(Boolean);
  if (expectedIds.includes(cardId)) return true;

  return expectedIds.some((productId) => modelIdsShareAssetIdentity(productId, cardId));
}

async function readFootprintCards(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('a[href*="/reshtmla/"][href*="sof="]'))
      .map((anchor, index) => {
        try {
          const href = new URL(anchor.getAttribute("href") || "", location.href).toString();
          return {
            href,
            productId: new URL(href).searchParams.get("sof") || "",
            index,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean),
  );
}

async function findFootprintCardWithRefresh(page, expectedIds = []) {
  const attempts = footprintRefreshAttempts();
  let cards = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await page.waitForTimeout(footprintRefreshDelayMs()).catch(() => {});
      await page.reload({
        waitUntil: navigationWaitUntil(),
        timeout: timeoutMs(),
      }).catch(() => {});
    }

    await page
      .waitForSelector('a[href*="/reshtmla/"][href*="sof="]', {
        timeout: Math.min(timeoutMs(), 5000),
      })
      .catch(() => {});

    cards = await readFootprintCards(page);
    const selected = cards.find((card) => footprintCardMatches(card, expectedIds));
    if (selected) {
      return { selected, cards, attemptsUsed: attempt + 1 };
    }
  }

  return { selected: null, cards, attemptsUsed: attempts };
}

function evaluateMetadata() {
  function toNumber(value) {
    const number = Number(String(value || "").replace(/[^\d.]/g, ""));
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function parseDetailData() {
    const input = document.querySelector("#detail_data");
    if (!input?.value) return null;
    try {
      return JSON.parse(input.value);
    } catch {
      return null;
    }
  }

  function absolute(value) {
    if (!value) return "";
    try {
      return new URL(value, location.href).toString();
    } catch {
      return "";
    }
  }

  const detail = parseDetailData();
  const res =
    detail?.data?.res && typeof detail.data.res === "object"
      ? detail.data.res
      : detail?.data && typeof detail.data === "object"
        ? detail.data
        : detail?.res && typeof detail.res === "object"
          ? detail.res
          : {};
  const params = new URLSearchParams(location.search);
  const requestedSof = params.get("sof") || "";
  const detailLlId = String(res.ll_id || "").trim();
  const detailMatchesRequested = !requestedSof || !detailLlId || detailLlId === requestedSof;
  const metadataRes = detailMatchesRequested ? res : {};
  const metadataImages = Array.isArray(metadataRes.res_img) ? metadataRes.res_img : [];
  const cover =
    metadataImages.find(
      (item) => Number(item?.img_type) === 1 && item?.is_cover,
    ) ||
    metadataImages.find((item) => Number(item?.img_type) === 1) ||
    metadataImages.find((item) => item?.is_cover) ||
    metadataImages[0] ||
    {};
  const priceText =
    document.querySelector(".download-price .orginal-price")?.textContent ||
    document.querySelector(".download-price .original-price")?.textContent ||
    document.querySelector(".orginal-price")?.textContent ||
    document.querySelector(".original-price")?.textContent ||
    document.querySelector(".download-price .price")?.textContent ||
    "";
  const domPrice = toNumber(priceText);
  const detailPrice = detailMatchesRequested ? toNumber(res.res_price) : 0;
  const discountPrice = detailMatchesRequested ? toNumber(res.coupon_after_price) : 0;
  const creditCost = domPrice || detailPrice || discountPrice || 1;
  const priceKnown = Boolean(domPrice || detailPrice || discountPrice);

  const title =
    metadataRes.res_name_txt ||
    metadataRes.res_name ||
    document.querySelector("h1.model-name")?.getAttribute("title") ||
    document.querySelector("h1.model-name")?.textContent?.trim() ||
    document.querySelector("meta[property='og:title']")?.content ||
    document.title ||
    "";

  const imageUrl =
    document.querySelector("#swiper_max_html img[data-img-type='1']")?.src ||
    document.querySelector(".detail-swiper img[data-img-type='1']")?.src ||
    document.querySelector("img[data-img-type='1']")?.src ||
    document.querySelector("#swiper_max_html .swiper-imgs-list img.llimgs")
      ?.src ||
    document.querySelector("#swiper_max_html img.llimgs")?.src ||
    document.querySelector(".detail-swiper .swiper-imgs-list img")?.src ||
    document.querySelector(".detail-swiper img.llimgs")?.src ||
    document.querySelector(".swiper-imgs-list img")?.src ||
    document.querySelector("meta[property='og:image']")?.content ||
    cover.img_pic ||
    cover.thuimg600 ||
    cover.fullimg ||
    cover.thuimg88 ||
    cover.res_img_dg ||
    metadataRes.business_img ||
    metadataRes.res_img_dg ||
    "";

  return {
    productId:
      requestedSof ||
      (detailMatchesRequested ? res.ll_id : "") ||
      document.querySelector(".ll-id")?.textContent?.trim() ||
      document.querySelector(".slide-ll-id b")?.textContent?.trim() ||
      document.querySelector("[data-sof]")?.getAttribute("data-sof") ||
      "",
    title: title.trim(),
    imageUrl: absolute(imageUrl),
    creditCost,
    priceKnown,
    sourceUrl: location.href,
    dynamicFields: {
      llId:
        requestedSof ||
        (detailMatchesRequested ? res.ll_id : "") ||
        document.querySelector(".ll-id")?.textContent?.trim() ||
        document.querySelector(".slide-ll-id b")?.textContent?.trim() ||
        document.querySelector("[data-sof]")?.getAttribute("data-sof") ||
        "",
      sign: params.get("sign") || "",
      token:
        window.token ||
        window.download_token ||
        document.querySelector("input[name='token']")?.value ||
        "",
      upTime:
        window.up_time ||
        window.upTime ||
        document.querySelector("input[name='up_time']")?.value ||
        "",
      actionId:
        (detailMatchesRequested ? res.actionId : "") ||
        document.querySelector("#actionId")?.value ||
        document.querySelector("#action_id")?.value ||
        params.get("searchActionId") ||
        params.get("action_id") ||
        "",
      requestId: params.get("r_id") || params.get("request_id") || "",
      sourceAlg: params.get("s_alg") || params.get("source_alg") || "",
      position: params.get("position") || params.get("p") || "",
      fileFormat: Array.isArray(res.down_file_format)
        ? String((detailMatchesRequested ? res.down_file_format[0] : null)?.file_format || "")
        : "",
      site:
        document.querySelector("#site")?.value || String(detailMatchesRequested ? res.res_type || "" : ""),
      pageType: document.querySelector("#page_type")?.value || "",
    },
    found: {
      detailData: Boolean(detail),
      modelName: Boolean(document.querySelector("h1.model-name")),
      ogImage: Boolean(document.querySelector("meta[property='og:image']")),
      orginalPrice: Boolean(
        document.querySelector(".orginal-price, .original-price"),
      ),
    },
  };
}

function browserHttpError(message, status = 502, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.details = details;
  return error;
}

function isAllowed3D66DownloadUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").replaceAll("\\/", "/").trim());
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (hostname === "3d66.com" || hostname.endsWith(".3d66.com")) &&
      /^(?:k?down|download)[^.]*\./i.test(hostname)
    );
  } catch {
    return false;
  }
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

function waitForDownloadHandleResponse(page, timeout = timeoutMs()) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/download/handle") &&
      response.request().method().toUpperCase() === "POST",
    { timeout },
  );
}

async function parseDownloadHandleResponse(response) {
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw browserHttpError(
      "3D66 browser download returned non-JSON response",
      502,
      {
        body: text.slice(0, 300),
        status: response.status(),
      },
    );
  }

  const fileUrl = extractDownloadFileUrl(json);
  if (fileUrl) {
    return { json, fileUrl };
  }

  throw browserHttpError(
    `3D66 browser download failed: ${json.msg || "missing download URL"}`,
    502,
    {
      response: json,
    },
  );
}

async function waitForDownloadOrPaymentPopup(page) {
  const responseWait = waitForDownloadHandleResponse(
    page,
    Math.min(timeoutMs(), 10000),
  )
    .then((response) => ({ type: "response", response }))
    .catch(() => null);
  const popupWait = page
    .waitForSelector(".paytype-item, .right-pay-btn", {
      timeout: Math.min(timeoutMs(), 10000),
    })
    .then(() => ({ type: "popup" }))
    .catch(() => null);

  return Promise.race([responseWait, popupWait]);
}

async function waitForFormatPopupDownloadOrPayment(page) {
  const responseWait = waitForDownloadHandleResponse(
    page,
    Math.min(timeoutMs(), 10000),
  )
    .then((response) => ({ type: "response", response }))
    .catch(() => null);
  const formatWait = page
    .waitForSelector(".download-file-format-pop .pop-bd-item, .pop-bd-item[data-file_format]", {
      timeout: Math.min(timeoutMs(), 10000),
    })
    .then(() => ({ type: "format" }))
    .catch(() => null);
  const paymentWait = page
    .waitForSelector(".paytype-item, .right-pay-btn", {
      timeout: Math.min(timeoutMs(), 10000),
    })
    .then(() => ({ type: "payment" }))
    .catch(() => null);

  return Promise.race([formatWait, responseWait, paymentWait]);
}

function downloadFormatKey(format = {}) {
  const key = String(format.key || "").trim();
  if (key) return key;
  const fileFormat = String(format.fileFormat || format.file_format || "").trim();
  const formatVersion = String(format.formatVersion || format.format_version || "").trim();
  const rendererType = String(format.rendererType || format.renderer_type || "").trim();
  return fileFormat ? [fileFormat, formatVersion, rendererType].join("|") : "";
}

function evaluateFormatOptions() {
  function formatNameFromCode(fileFormat = "") {
    return {
      1: "3Dmax（.max）",
      3: "OBJ（.obj）",
      14: "FBX（.fbx）",
    }[String(fileFormat || "")] || (fileFormat ? `Format ${fileFormat}` : "");
  }

  function text(selector, root = document) {
    return (root.querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function attr(node, name) {
    return (node.getAttribute(name) || "").trim();
  }

  function spanTitle(item, keywordPattern) {
    for (const span of item.querySelectorAll("span[title]")) {
      const label = (span.textContent || "").replace(/\s+/g, " ").trim();
      if (!keywordPattern || keywordPattern.test(label)) {
        return attr(span, "title") || label.replace(/^[^:：]+[:：]\s*/, "");
      }
    }
    return "";
  }

  return Array.from(document.querySelectorAll(".download-file-format-pop .pop-bd-item, .pop-bd-item[data-file_format]"))
    .map((item, index) => {
      const fileFormat = attr(item, "data-file_format");
      if (!fileFormat || fileFormat === "0") return null;
      const title = text(".bd-title", item).replace(/^✓\s*/, "").trim();
      return {
        key: [fileFormat, attr(item, "data-format_version") || spanTitle(item, /版本|version/i), attr(item, "data-renderer_type")].join("|"),
        fileFormat,
        formatVersion: attr(item, "data-format_version") || spanTitle(item, /版本|version/i),
        rendererType: attr(item, "data-renderer_type"),
        rendererLabel: spanTitle(item, /渲染器|renderer/i),
        label: title || formatNameFromCode(fileFormat) || fileFormat,
        size: text(".right-file-size", item),
        isDefault: item.classList.contains("active") || index === 0,
      };
    })
    .filter(Boolean);
}

async function submitDownloadFormatPopup(page, requestedFormat = null) {
  const requestedKey = downloadFormatKey(requestedFormat);
  if (requestedKey) {
    const selected = await page.evaluate((key) => {
      const items = Array.from(document.querySelectorAll(".download-file-format-pop .pop-bd-item, .pop-bd-item[data-file_format]"));
      const match = items.find((item) => {
        const fileFormat = (item.getAttribute("data-file_format") || "").trim();
        const formatVersion = (item.getAttribute("data-format_version") || "").trim();
        const rendererType = (item.getAttribute("data-renderer_type") || "").trim();
        return [fileFormat, formatVersion, rendererType].join("|") === key;
      });
      if (!match) return false;
      match.click();
      return true;
    }, requestedKey);

    if (!selected) {
      throw browserHttpError(
        "Selected 3D66 file format is no longer available.",
        400,
        { requestedFormat },
      );
    }
  }

  const nextResult = waitForDownloadOrPaymentPopup(page);
  const button = page.locator(".download-file-format-pop .file-format-pop-btn, .file-format-pop-btn").last();
  await button.click({ timeout: Math.min(timeoutMs(), 10000), force: true });
  return nextResult;
}

async function selectGiftPointWallet(page) {
  const configuredPaytype = String(process.env.THREED66_PAYTYPE_VALUE || "4").trim();
  const paytypeValue = /^[\w-]{1,20}$/.test(configuredPaytype)
    ? configuredPaytype
    : "4";
  const byValue = page.locator(`.paytype-item[value="${paytypeValue}"]`).first();
  if ((await byValue.count()) > 0) {
    await byValue.click({ timeout: Math.min(timeoutMs(), 10000), force: true });
    return `value=${paytypeValue}`;
  }

  const byText = page.locator(".paytype-item", { hasText: "赠点" }).first();
  if ((await byText.count()) > 0) {
    await byText.click({ timeout: Math.min(timeoutMs(), 10000), force: true });
    return "text=赠点";
  }

  throw browserHttpError(
    "3D66 payment popup did not show the gift-point wallet.",
    502,
  );
}

async function confirmPaymentPopup(page) {
  await selectGiftPointWallet(page);

  const payButton = page.locator(".right-pay-btn").last();
  await payButton.waitFor({
    state: "visible",
    timeout: Math.min(timeoutMs(), 10000),
  });
  const buttonText = ((await payButton.textContent()) || "")
    .replace(/\s+/g, " ")
    .trim();
  const buttonType = await payButton.getAttribute("data-type");

  if (/余额不足|去充值|不足/i.test(buttonText)) {
    throw browserHttpError(
      "Tài khoản 3D66 không đủ số dư để mua model này.",
      502,
      {
        buttonText,
        buttonType,
      },
    );
  }

  const responsePromise = waitForDownloadHandleResponse(page);
  await payButton.click({ timeout: Math.min(timeoutMs(), 10000), force: true });
  return responsePromise;
}

export async function fetch3D66PageWithBrowser(url, cookieValue) {
  assertSafe3D66Url(url);
  return withBrowserContext(url, cookieValue, async ({ context, page }) => {
    await goto3D66Page(page, url);

    const metadata = await evaluateMetadataWithRetry(page);
    const html = await page.content();
    const browserCookies = await context.cookies();

    return {
      html,
      pageUrl: page.url(),
      metadata,
      cookieValue: serializeCookies(browserCookies) || cookieValue,
      usedBrowser: true,
    };
  });
}

export async function resolve3D66ModelUrlFromFootprint(
  url,
  cookieValue,
  expectedProductIds = [],
) {
  assertSafe3D66Url(url);
  return withBrowserContext(url, cookieValue, async ({ context, page }) => {
    await goto3D66Page(page, url);
    await page.waitForTimeout(Math.max(500, postCommitWaitMs())).catch(() => {});

    await goto3D66Page(page, FOOTPRINT_URL);

    const sourceProductId = modelIdFromUrl(url);
    const expectedIds = [...new Set([sourceProductId, ...expectedProductIds].filter(Boolean))];
    const { selected, cards, attemptsUsed } = await findFootprintCardWithRefresh(
      page,
      expectedIds,
    );
    if (!selected) {
      throw browserHttpError(
        "Không tìm thấy đúng model vừa mở trong lịch sử truy cập 3D66.",
        502,
        {
          expectedProductIds: expectedIds,
          footprintProductIds: cards.slice(0, 10).map((card) => card.productId),
          footprintRefreshAttempts: attemptsUsed,
        },
      );
    }

    assertSafe3D66Url(selected.href);
    const openedPagePromise = Promise.any([
      context.waitForEvent("page", { timeout: Math.min(timeoutMs(), 6000) }),
      page
        .waitForURL(
          (candidate) => candidate.pathname.includes("/reshtmla/") && candidate.searchParams.has("sof"),
          { timeout: Math.min(timeoutMs(), 6000) },
        )
        .then(() => page),
    ]).catch(() => null);
    await page.evaluate((href) => {
      const anchor = Array.from(
        document.querySelectorAll('a[href*="/reshtmla/"][href*="sof="]'),
      ).find((item) => {
        try {
          return new URL(item.getAttribute("href") || "", location.href).toString() === href;
        } catch {
          return false;
        }
      });
      anchor?.click();
    }, selected.href);

    let openedPage = await openedPagePromise;
    if (!openedPage) {
      openedPage = await context.newPage();
      await goto3D66Page(openedPage, selected.href);
    }

    await openedPage.waitForLoadState("commit", { timeout: timeoutMs() }).catch(() => {});
    if (!openedPage.url() || openedPage.url() === "about:blank") {
      await goto3D66Page(openedPage, selected.href);
    }
    await openedPage
      .waitForURL(
        (candidate) =>
          candidate.pathname.includes("/reshtmla/") &&
          candidate.searchParams.has("sof") &&
          candidate.searchParams.has("sign"),
        { timeout: Math.min(timeoutMs(), 4000) },
      )
      .catch(() => {});
    await openedPage.waitForTimeout(Math.max(500, postCommitWaitMs())).catch(() => {});

    const resolvedUrl = openedPage.url();
    assertSafe3D66Url(resolvedUrl);
    const resolvedProductId = modelIdFromUrl(resolvedUrl);
    if (!resolvedFootprintUrlMatches(resolvedUrl, selected.productId)) {
      throw browserHttpError(
        "3D66 opened a different model than the selected footprint item.",
        502,
        {
          selectedProductId: selected.productId,
          resolvedProductId,
          stage: "footprint-opened-model",
        },
      );
    }

    const browserCookies = await context.cookies();
    return {
      url: resolvedUrl,
      productId: resolvedProductId,
      cookieValue: serializeCookies(browserCookies) || cookieValue,
      usedFootprint: true,
    };
  });
}

export async function inspect3D66DownloadFormatsWithBrowser(url, cookieValue) {
  assertSafe3D66Url(url);
  return withBrowserContext(url, cookieValue, async ({ context, page }) => {
    await goto3D66Page(page, url);

    const metadata = await evaluateMetadataWithRetry(page, true);
    const downloadButton = page.locator(".j_download").last();
    await downloadButton.click({
      timeout: Math.min(timeoutMs(), 15000),
      force: true,
    });

    const result = await waitForFormatPopupDownloadOrPayment(page);
    const browserCookies = await context.cookies();
    if (result?.type === "format") {
      const formatOptions = await page.evaluate(evaluateFormatOptions);
      return {
        metadata: {
          ...metadata,
          formatOptions,
          selectedFormat: formatOptions.find((option) => option.isDefault) || formatOptions[0] || null,
        },
        formatOptions,
        pageUrl: page.url(),
        cookieValue: serializeCookies(browserCookies) || cookieValue,
        usedBrowser: true,
      };
    }

    if (result?.type === "response") {
      try {
        const { json, fileUrl } = await parseDownloadHandleResponse(result.response);
        return {
          fileUrl,
          productId: metadata.dynamicFields?.llId || metadata.productId,
          sourceUrl: page.url(),
          title: metadata.title,
          imageUrl: metadata.imageUrl,
          creditCost: metadata.creditCost || 1,
          metadata,
          formatOptions: [],
          pageUrl: page.url(),
          cookieValue: serializeCookies(browserCookies) || cookieValue,
          response: json,
          usedBrowser: true,
          terminalType: "response",
        };
      } catch (error) {
        return {
          metadata,
          formatOptions: [],
          pageUrl: page.url(),
          cookieValue: serializeCookies(browserCookies) || cookieValue,
          usedBrowser: true,
          terminalType: "response",
          responseError: error.message,
        };
      }
    }

    return {
      metadata,
      formatOptions: [],
      pageUrl: page.url(),
      cookieValue: serializeCookies(browserCookies) || cookieValue,
      usedBrowser: true,
      terminalType: result?.type || "none",
    };
  });
}

export async function download3D66WithBrowser(url, cookieValue, options = {}) {
  assertSafe3D66Url(url);
  return withBrowserContext(url, cookieValue, async ({ context, page }) => {
    await goto3D66Page(page, url);

    const metadata = await evaluateMetadataWithRetry(page, true);
    const downloadButton = page.locator(".j_download").last();
    await downloadButton.click({
      timeout: Math.min(timeoutMs(), 15000),
      force: true,
    });
    const firstResult = await waitForFormatPopupDownloadOrPayment(page);
    let response;
    if (firstResult?.type === "response") {
      response = firstResult.response;
    } else if (firstResult?.type === "format") {
      const afterFormat = await submitDownloadFormatPopup(page, options.downloadFormat);
      response =
        afterFormat?.type === "response"
          ? afterFormat.response
          : await confirmPaymentPopup(page);
    } else {
      response = await confirmPaymentPopup(page);
    }
    const { json, fileUrl } = await parseDownloadHandleResponse(response);

    const browserCookies = await context.cookies();
    return {
      fileUrl,
      productId: metadata.dynamicFields?.llId || metadata.productId,
      sourceUrl: page.url(),
      title: metadata.title,
      imageUrl: metadata.imageUrl,
      creditCost: metadata.creditCost || 1,
      formatOptions: options.downloadFormat ? [options.downloadFormat] : metadata.formatOptions || [],
      selectedFormat: options.downloadFormat || metadata.selectedFormat || null,
      cookieValue: serializeCookies(browserCookies) || cookieValue,
      response: json,
      usedBrowser: true,
    };
  });
}
