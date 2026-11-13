import fs from "node:fs/promises";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { chromium } from "playwright";
import { decryptSecret } from "/app/src/utils/secretBox.js";

const source = "https://3d.3d66.com/reshtmla/model/items/zm/zmO4AZgFk84WE9fR78Wg.html?sof=BJI010779713376927&ab_f=0&a_v=34.1&gp=12&r_id=1C1FACFF63CF023D1721FD3CE602A908&sign=0d139133b20aaf51&action_id=6f01ch8fb6f6kf735hbft00aoe179142558116&s_alg=304&p=3&parentId=BJI010779719931259&lss=2&crs=2&llt=2";
const target = new URL(source);
const safeMethods = new Set(["GET", "HEAD"]);
const requests = [];
const blocked = [];
const pages = [];
let browserLaunches = 0;
let captchaSeen = false;
const originalFetch = globalThis.fetch;
const originalLaunch = chromium.launch.bind(chromium);
let legacyBrowser;
let legacyService;
let connection;
let cookieRecord;
let cookieDigest;
const result = { sourceCommit: "3a02f0d", testKind: "legacy preview and legacy browser on current VPS, current source site and current database cookie", historicalEnvironmentReproduced: false, cases: [] };

function readOnlyRequest(raw, method) {
  let url;
  try { url = new URL(raw); } catch { return false; }
  if (["about:", "blob:", "data:"].includes(url.protocol)) return true;
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return false;
  const sourceHost = url.hostname === "3d66.com" || url.hostname.endsWith(".3d66.com");
  if (!sourceHost || /^(?:k?down|download)[^.]*\./i.test(url.hostname)) return false;
  if (/\/api\/v1\/download\//i.test(url.pathname) && url.pathname !== "/api/v1/download/pop") return false;
  if (/\.(?:zip|rar|7z|exe|mzp)(?:$|\/)/i.test(url.pathname)) return false;
  if (!safeMethods.has(method) && !(method === "POST" && url.pathname === "/api/v1/download/pop")) return false;
  if (/\/reshtml[a-z]*\/model\//i.test(url.pathname)) {
    const sof = url.searchParams.get("sof") || "";
    if (url.pathname !== target.pathname && !["BJI010779713376927", "AJI896357713376927"].includes(sof)) return false;
  }
  return true;
}

function categorizeHtml(html = "") {
  const title = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() || "";
  return /^(?:滑动验证(?:页面)?|安全验证|访问验证|captcha|security verification|verification required)$/i.test(title)
    || (/访问验证/.test(html) && /(?:验证失败|滑块|请进行验证)/.test(html));
}

globalThis.fetch = async (input, options = {}) => {
  const raw = typeof input === "string" || input instanceof URL ? String(input) : input.url;
  const method = String(options.method || input?.method || "GET").toUpperCase();
  if (!readOnlyRequest(raw, method)) {
    blocked.push({ channel: "fetch", method, host: new URL(raw).hostname, path: new URL(raw).pathname });
    throw Object.assign(new Error("Diagnostic blocked non-read operation"), { code: "DIAGNOSTIC_READ_ONLY_BOUNDARY" });
  }
  if (captchaSeen) throw Object.assign(new Error("Stop after verification challenge"), { code: "DIAGNOSTIC_CAPTCHA_STOP" });
  const response = await originalFetch(input, options);
  requests.push({ channel: "fetch", method, host: new URL(raw).hostname, path: new URL(raw).pathname, status: response.status });
  if (/html/i.test(response.headers.get("content-type") || "")) {
    const text = await response.clone().text();
    if (categorizeHtml(text)) {
      captchaSeen = true;
      throw Object.assign(new Error("Source returned verification page"), { code: "DIAGNOSTIC_CAPTCHA_STOP" });
    }
  }
  return response;
};

chromium.launch = async options => {
  browserLaunches++;
  const browser = await originalLaunch(options);
  const originalContext = browser.newContext.bind(browser);
  browser.newContext = async contextOptions => {
    const context = await originalContext(contextOptions);
    const route = context.route.bind(context);
    context.route = (pattern, handler, routeOptions) => route(pattern, async (requestRoute, request) => {
      const r = request || requestRoute.request();
      const method = r.method().toUpperCase();
      if (!readOnlyRequest(r.url(), method) || captchaSeen) {
        const u = new URL(r.url());
        if (!safeMethods.has(method) || /\/api\/v1\/download\//i.test(u.pathname)) blocked.push({ channel: "browser", method, host: u.hostname, path: u.pathname });
        await requestRoute.abort("blockedbyclient");
        return;
      }
      await handler(requestRoute, r);
    }, routeOptions);
    context.on("page", page => {
      pages.push(page);
      const evaluate = page.evaluate.bind(page);
      page.evaluate = async (...args) => {
        const title = (await page.title()).trim();
        if (/^(?:滑动验证(?:页面)?|安全验证|访问验证|captcha|security verification|verification required)$/i.test(title)) {
          captchaSeen = true;
          throw Object.assign(new Error("Source returned verification page"), { code: "DIAGNOSTIC_CAPTCHA_STOP" });
        }
        return evaluate(...args);
      };
      const goto = page.goto.bind(page);
      page.goto = async (...args) => {
        if (captchaSeen) throw Object.assign(new Error("Stop after verification challenge"), { code: "DIAGNOSTIC_CAPTCHA_STOP" });
        const response = await goto(...args);
        const title = (await page.title()).trim();
        if (/^(?:滑动验证(?:页面)?|安全验证|访问验证|captcha|security verification|verification required)$/i.test(title)) {
          captchaSeen = true;
          await page.screenshot({ path: "/tmp/legacy-preview-captcha.png" }).catch(() => {});
          throw Object.assign(new Error("Source returned verification page"), { code: "DIAGNOSTIC_CAPTCHA_STOP" });
        }
        return response;
      };
      page.on("response", response => {
        if (response.request().resourceType() === "document") {
          const u = new URL(response.url());
          requests.push({ channel: "browser", method: response.request().method(), host: u.hostname, path: u.pathname, status: response.status() });
        }
      });
    });
    return context;
  };
  return browser;
};

try {
  connection = await mongoose.createConnection(process.env.MONGO_CORE_URI || process.env.MONGO_URI, { autoIndex: false, autoCreate: false, maxPoolSize: 2, serverSelectionTimeoutMS: 15000 }).asPromise();
  const setting = await connection.db.collection("sitesettings").findOne({ key: "homepage" });
  const now = new Date();
  cookieRecord = await connection.db.collection("cookies").findOne({ isActive: { $ne: false }, status: { $ne: "disabled" }, $or: [{ cooldownUntil: { $exists: false } }, { cooldownUntil: null }, { cooldownUntil: { $lte: now } }] }, { sort: { updatedAt: -1 }, projection: { value: 1 } });
  if (!cookieRecord?.value) throw Object.assign(new Error("No usable database cookie"), { code: "NO_USABLE_COOKIE" });
  const cookie = decryptSecret(cookieRecord.value);
  cookieDigest = crypto.createHash("sha256").update(cookieRecord.value).digest("hex");
  const keys = new Set(cookie.split(";").map(v => v.trim().split("=")[0]));
  const mapping = { threed66ProxyEnabled: "THREED66_PROXY_ENABLED", threed66ProxyForApi: "THREED66_PROXY_FOR_API", threed66ProxyForPreview: "THREED66_PROXY_FOR_PREVIEW", threed66ProxyForBrowser: "THREED66_PROXY_FOR_BROWSER", threed66ProxyFailClosed: "THREED66_PROXY_FAIL_CLOSED", threed66BrowserAlways: "THREED66_BROWSER_ALWAYS", threed66DisableBrowserPageFallback: "THREED66_DISABLE_BROWSER_PAGE_FALLBACK" };
  for (const [field, name] of Object.entries(mapping)) if (setting?.[field] != null) process.env[name] = String(setting[field]);
  if (setting?.threed66ProxyUrl) process.env.THREED66_PROXY_URL = decryptSecret(setting.threed66ProxyUrl);
  Object.assign(process.env, { THREED66_MODEL_RESOLVE_MODE: "footprint", THREED66_MOCK: "false", THREED66_BROWSER_HEADLESS: "true", THREED66_TIMEOUT_MS: "15000", THREED66_BROWSER_NAV_RETRIES: "1", TELEGRAM_NOTIFICATIONS_ENABLED: "false" });
  result.settings = { mode: "footprint", headless: true, browserAlways: process.env.THREED66_BROWSER_ALWAYS === "true", hasLegacyLoginToken: keys.has("login_token"), hasSession: keys.has("PHPSESSID"), hasLoginSign: keys.has("login_sign"), cookieSource: "read-only active database cookie; no persistent browser profile imported" };
  legacyService = await import("/app/.legacy-readonly/backend/src/utils/3d66Service.js");
  legacyBrowser = await import("/app/.legacy-readonly/backend/src/utils/3d66BrowserService.js");
  const started = Date.now();
  try {
    const preview = await legacyService.fetch3D66Preview(source, cookie);
    result.cases.push({ kind: "exact-legacy-preview", ok: true, title: preview.title, productId: preview.productId, creditCost: preview.creditCost, priceKnown: Boolean(preview.priceKnown), hasImage: Boolean(preview.imageUrl), browserLaunches, elapsedMs: Date.now() - started });
  } catch (error) {
    result.cases.push({ kind: "exact-legacy-preview", ok: false, code: error.code || null, status: error.status || null, legacyCookieValidationBlocked: /cookie missing required keys/.test(error.message), elapsedMs: Date.now() - started });
  }
  if (!captchaSeen && browserLaunches === 0) {
    const opened = Date.now();
    try {
      const page = await legacyBrowser.fetch3D66PageWithBrowser(source, cookie);
      captchaSeen ||= categorizeHtml(page.html);
      result.cases.push({ kind: "legacy-headless-direct-page-read", ok: !captchaSeen, title: page.metadata?.title, productId: page.metadata?.productId, hasImage: Boolean(page.metadata?.imageUrl), captcha: captchaSeen, elapsedMs: Date.now() - opened });
    } catch (error) {
      result.cases.push({ kind: "legacy-headless-direct-page-read", ok: false, code: error.code || null, status: error.status || null, captcha: captchaSeen, elapsedMs: Date.now() - opened });
    }
  }
  result.captchaSeen = captchaSeen;
  result.browserLaunches = browserLaunches;
  result.requests = requests;
  result.blocked = blocked;
  const after = await connection.db.collection("cookies").findOne({ _id: cookieRecord._id }, { projection: { value: 1 } });
  result.cookieUnchanged = Boolean(after?.value && crypto.createHash("sha256").update(after.value).digest("hex") === cookieDigest);
  result.databaseWrites = 0;
  result.purchaseAndFileRequestsSent = 0;
} catch (error) {
  result.fatal = { code: error.code || error.name, status: error.status || null };
  process.exitCode = 1;
} finally {
  await legacyBrowser?.close3D66Browser().catch(() => {});
  await legacyService?.close3D66ProxyAgents().catch(() => {});
  await connection?.close();
  console.log("LEGACY_READ_ONLY_RESULT " + JSON.stringify(result));
}
