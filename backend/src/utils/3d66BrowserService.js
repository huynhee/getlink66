const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BROWSER_CONCURRENCY = 2;
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

let browserPromise = null;
let activeBrowser = null;
let shutdownHandlersInstalled = false;
let activeBrowserTasks = 0;
const browserTaskQueue = [];

function timeoutMs() {
  const value = Number(process.env.THREED66_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
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
  const value = Number(process.env.THREED66_BROWSER_POST_COMMIT_WAIT_MS || 1200);
  return Number.isFinite(value) && value >= 0 ? value : 1200;
}

function navigationRetries() {
  const value = Number(process.env.THREED66_BROWSER_NAV_RETRIES || 2);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 2;
}

function retryDelayMs(attempt) {
  const base = Number(process.env.THREED66_BROWSER_RETRY_DELAY_MS || 1200);
  const safeBase = Number.isFinite(base) && base >= 0 ? base : 1200;
  return safeBase * attempt;
}

function shouldBlockAssets() {
  return process.env.THREED66_BROWSER_BLOCK_ASSETS !== "false";
}

function browserConcurrency() {
  const value = Number(
    process.env.THREED66_BROWSER_CONCURRENCY || DEFAULT_BROWSER_CONCURRENCY,
  );
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : DEFAULT_BROWSER_CONCURRENCY;
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

function installShutdownHandlers() {
  if (shutdownHandlersInstalled) return;
  shutdownHandlersInstalled = true;

  const closeBrowser = async () => {
    const browser = activeBrowser;
    activeBrowser = null;
    browserPromise = null;
    if (browser) {
      await browser.close().catch(() => {});
    }
  };

  process.once("SIGINT", () => {
    closeBrowser().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    closeBrowser().finally(() => process.exit(0));
  });
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
      browser.on("disconnected", () => {
        if (activeBrowser === browser) activeBrowser = null;
        browserPromise = null;
      });
      installShutdownHandlers();
      return browser;
    })().catch((error) => {
      browserPromise = null;
      activeBrowser = null;
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
      .finally(() => {
        activeBrowserTasks -= 1;
        pumpBrowserQueue();
      });
  }
}

function runBrowserTask(task) {
  return new Promise((resolve, reject) => {
    browserTaskQueue.push({ task, resolve, reject });
    pumpBrowserQueue();
  });
}

async function withBrowserContext(url, cookieValue, callback) {
  return runBrowserTask(async () => {
    const browser = await getSharedBrowser();
    const context = await browser.newContext({
      userAgent: DEFAULT_USER_AGENT,
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
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
    }
  });
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
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, {
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

function toNumber(value) {
  const number = Number(String(value || "").replace(/[^\d.]/g, ""));
  return Number.isFinite(number) && number > 0 ? number : 0;
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
  const detailImages = Array.isArray(res.res_img) ? res.res_img : [];
  const cover =
    detailImages.find(
      (item) => Number(item?.img_type) === 1 && item?.is_cover,
    ) ||
    detailImages.find((item) => Number(item?.img_type) === 1) ||
    detailImages.find((item) => item?.is_cover) ||
    detailImages[0] ||
    {};
  const params = new URLSearchParams(location.search);
  const priceText =
    document.querySelector(".download-price .orginal-price")?.textContent ||
    document.querySelector(".download-price .original-price")?.textContent ||
    document.querySelector(".orginal-price")?.textContent ||
    document.querySelector(".original-price")?.textContent ||
    document.querySelector(".download-price .price")?.textContent ||
    "";
  const domPrice = toNumber(priceText);
  const detailPrice = toNumber(res.res_price);
  const discountPrice = toNumber(res.coupon_after_price);
  const creditCost = domPrice || detailPrice || discountPrice || 1;
  const priceKnown = Boolean(domPrice || detailPrice || discountPrice);

  const title =
    res.res_name_txt ||
    res.res_name ||
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
    res.business_img ||
    res.res_img_dg ||
    "";

  return {
    productId:
      res.ll_id ||
      document.querySelector(".ll-id")?.textContent?.trim() ||
      document.querySelector(".slide-ll-id b")?.textContent?.trim() ||
      document.querySelector("[data-sof]")?.getAttribute("data-sof") ||
      params.get("sof") ||
      "",
    title: title.trim(),
    imageUrl: absolute(imageUrl),
    creditCost,
    priceKnown,
    sourceUrl: location.href,
    dynamicFields: {
      llId:
        res.ll_id ||
        document.querySelector(".ll-id")?.textContent?.trim() ||
        document.querySelector(".slide-ll-id b")?.textContent?.trim() ||
        document.querySelector("[data-sof]")?.getAttribute("data-sof") ||
        params.get("sof") ||
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
        res.actionId ||
        document.querySelector("#actionId")?.value ||
        document.querySelector("#action_id")?.value ||
        params.get("searchActionId") ||
        params.get("action_id") ||
        "",
      requestId: params.get("r_id") || params.get("request_id") || "",
      sourceAlg: params.get("s_alg") || params.get("source_alg") || "",
      position: params.get("position") || params.get("p") || "",
      fileFormat: Array.isArray(res.down_file_format)
        ? String(res.down_file_format[0]?.file_format || "")
        : "",
      site:
        document.querySelector("#site")?.value || String(res.res_type || ""),
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
      /^(?:down|download)[^.]*\./i.test(hostname)
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

export async function download3D66WithBrowser(url, cookieValue) {
  assertSafe3D66Url(url);
  return withBrowserContext(url, cookieValue, async ({ context, page }) => {
    await goto3D66Page(page, url);

    const metadata = await evaluateMetadataWithRetry(page, true);
    const downloadButton = page.locator(".j_download").last();
    await downloadButton.click({
      timeout: Math.min(timeoutMs(), 15000),
      force: true,
    });
    const firstResult = await waitForDownloadOrPaymentPopup(page);
    const response =
      firstResult?.type === "response"
        ? firstResult.response
        : await confirmPaymentPopup(page);
    const { json, fileUrl } = await parseDownloadHandleResponse(response);

    const browserCookies = await context.cookies();
    return {
      fileUrl,
      productId: metadata.dynamicFields?.llId || metadata.productId,
      sourceUrl: page.url(),
      title: metadata.title,
      imageUrl: metadata.imageUrl,
      creditCost: metadata.creditCost || 1,
      cookieValue: serializeCookies(browserCookies) || cookieValue,
      response: json,
      usedBrowser: true,
    };
  });
}
