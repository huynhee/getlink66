import crypto from "node:crypto";
import mongoose from "mongoose";
import { chromium } from "playwright";
import { decryptSecret } from "./src/utils/secretBox.js";
import { manual3D66RequestAllowed } from "./src/utils/3d66VerificationGuard.js";

const source = "https://3d.3d66.com/reshtmla/model/items/N6/N6p4kD39mSde8gE8sEqV.html?sof=AJI896357712130659&sign=e1f896e7b4ab7cb6&ab=0&algorithm_type=0&algorithm_version=1.0&request_id=006bc09902fa4e7e8a182e1133a25fc4&position=5&action_id=79eb93fba7c817433982f3e8b5ea8166&click_res_source=28&source_alg=1303&lss=12&llt=3";
const target = new URL(source);
const productId = target.searchParams.get("sof");
const client = new mongoose.mongo.MongoClient(process.env.MONGO_CORE_URI || process.env.MONGO_URI, {
  maxPoolSize: 1, serverSelectionTimeoutMS: 10000, socketTimeoutMS: 15000,
});
let marketplace;
let browser;
let stage = "read-config";
const safe = value => String(value || "").replace(/https?:\/\/\S+/g, "[url]")
  .replace(/(?:sign|token|cookie|password)\s*[:=]\s*[^\s,;]+/gi, "[redacted]").slice(0, 220);
try {
  await client.connect();
  const db = client.db();
  const settings = await db.collection("sitesettings").findOne({ key: "homepage" });
  const stored = await db.collection("cookies").find({ isActive: { $ne: false }, status: { $ne: "disabled" } })
    .sort({ updatedAt: -1 }).limit(1).next();
  if (!stored) throw new Error("NO_SOURCE_COOKIE");
  const digest = crypto.createHash("sha256").update(stored.value).digest("hex");
  const cookieValue = decryptSecret(stored.value);
  console.log("CONFIG", JSON.stringify({ mode: settings?.threed66ModelResolveMode, headless: process.env.THREED66_BROWSER_HEADLESS !== "false",
    blockAssets: process.env.THREED66_BROWSER_BLOCK_ASSETS !== "false", cookieStatus: stored.status,
    lastTestOk: stored.lastTestOk, failureCount: stored.failureCount, lastError: safe(stored.lastErrorMessage) }));
  if (process.env.MONGO_MARKETPLACE_URI) {
    marketplace = new mongoose.mongo.MongoClient(process.env.MONGO_MARKETPLACE_URI, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
    await marketplace.connect();
  }
  const logs = await (marketplace || client).db().collection("systemlogs").find({ type: "getlink", level: "error" })
    .sort({ createdAt: -1 }).limit(8).toArray();
  for (const log of logs) console.log("RECENT_ERROR", JSON.stringify({ at: log.createdAt, status: log.status,
    stage: log.details?.stage, reason: log.details?.reason, code: log.details?.code,
    matchesTarget: JSON.stringify(log.details || {}).includes(productId), message: safe(log.message) }));
  const proxyEnabled = settings?.threed66ProxyEnabled ?? (process.env.THREED66_PROXY_ENABLED === "true");
  const proxyBrowser = settings?.threed66ProxyForBrowser ?? (process.env.THREED66_PROXY_FOR_BROWSER === "true");
  let proxy;
  if (proxyEnabled && proxyBrowser) {
    const raw = settings?.threed66ProxyUrl ? decryptSecret(settings.threed66ProxyUrl) : process.env.THREED66_PROXY_URL;
    const parsed = new URL(raw);
    proxy = { server: `${parsed.protocol}//${parsed.hostname}${parsed.port ? ":" + parsed.port : ""}`,
      ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
      ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}) };
  }
  stage = "open-model";
  browser = await chromium.launch({ headless: process.env.THREED66_BROWSER_HEADLESS !== "false" });
  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
    locale: "zh-CN", viewport: { width: 1440, height: 900 }, serviceWorkers: "block", ...(proxy ? { proxy } : {}),
  });
  const cookies = cookieValue.split(";").flatMap(part => {
    const index = part.indexOf("=");
    return index > 0 ? [{ name: part.slice(0, index).trim(), value: part.slice(index + 1).trim() }] : [];
  });
  await context.addCookies([target.origin, "https://www.3d66.com", "https://3d66.com", "https://user.3d66.com"]
    .flatMap(url => cookies.map(cookie => ({ ...cookie, url }))));
  const blocked = { unsafe: 0, asset: 0 };
  const failures = new Map();
  await context.route("**/*", route => {
    const request = route.request();
    if (!manual3D66RequestAllowed(request, { productId, initialUrl: source, mode: "direct", modelPage: target.origin + target.pathname })) {
      blocked.unsafe++; return route.abort("blockedbyclient");
    }
    if (process.env.THREED66_BROWSER_BLOCK_ASSETS !== "false" && ["image", "font", "media"].includes(request.resourceType())) {
      blocked.asset++; return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("requestfailed", request => {
    const host = new URL(request.url()).hostname;
    const key = host + " " + request.failure()?.errorText;
    failures.set(key, (failures.get(key) || 0) + 1);
  });
  const response = await page.goto(source, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000);
  const title = await page.title();
  const body = await page.locator("body").innerText({ timeout: 5000 });
  const final = new URL(page.url());
  const screenshot = "/tmp/getlink-direct-N6-20261103.png";
  await page.screenshot({ path: screenshot, timeout: 5000 });
  console.log("MODEL_RESULT", JSON.stringify({ http: response?.status(), title,
    finalPage: final.origin + final.pathname, sofMatches: final.searchParams.get("sof") === productId,
    challengeTitle: /^(?:滑动验证(?:页面)?|安全验证|访问验证|captcha|security verification|verification required)$/i.test(title.trim()),
    challengeHeading: await page.getByText("访问验证", { exact: true }).count(),
    verificationFailed: /验证失败/.test(body), modelHeading: await page.locator("h1.model-name").count(),
    modelData: await page.locator("#detail_data").count(), formats: await page.locator(".tp-multi-format-card").count(),
    bodyExcerpt: safe(body.slice(0, 240)), blocked, failures: [...failures].slice(0, 12),
    proxy: Boolean(proxy), screenshot, databaseWrites: 0 }));
  const after = await db.collection("cookies").findOne({ _id: stored._id }, { projection: { value: 1 } });
  console.log("COOKIE_UNCHANGED", digest === crypto.createHash("sha256").update(after.value).digest("hex"));
} catch (error) {
  console.error(JSON.stringify({ stage, failed: true, code: error.code || error.name, message: safe(error.message) }));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await marketplace?.close().catch(() => {});
  await client.close().catch(() => {});
}
