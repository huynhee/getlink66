import crypto from "node:crypto";
import { chromium } from "playwright";
import { connectDb, closeDbConnections } from "./src/config/db.js";
import { decryptSecret } from "./src/utils/secretBox.js";

const source = "https://3d.3d66.com/reshtmla/model/items/N6/N6p4kD39mSde8gE8sEqV.html?sof=AJI896357712130659&sign=e1f896e7b4ab7cb6&ab=0&algorithm_type=0&algorithm_version=1.0&request_id=006bc09902fa4e7e8a182e1133a25fc4&position=5&action_id=79eb93fba7c817433982f3e8b5ea8166&click_res_source=28&source_alg=1303&lss=12&llt=3";
let browserService;
await connectDb();
try {
  const { default: Setting } = await import("./src/models/SiteSetting.js");
  const { default: Cookie } = await import("./src/models/Cookie.js");
  const setting = await Setting.findOne({ key: "homepage" }).lean();
  const mapping = { threed66ModelResolveMode: "THREED66_MODEL_RESOLVE_MODE",
    threed66RequiredAccountMarker: "THREED66_REQUIRED_ACCOUNT_MARKER",
    threed66BrowserAlways: "THREED66_BROWSER_ALWAYS", threed66DisableBrowserPageFallback: "THREED66_DISABLE_BROWSER_PAGE_FALLBACK",
    threed66ProxyEnabled: "THREED66_PROXY_ENABLED", threed66ProxyForApi: "THREED66_PROXY_FOR_API",
    threed66ProxyForPreview: "THREED66_PROXY_FOR_PREVIEW", threed66ProxyForBrowser: "THREED66_PROXY_FOR_BROWSER",
    threed66ProxyFailClosed: "THREED66_PROXY_FAIL_CLOSED", threed66TimeoutMs: "THREED66_TIMEOUT_MS" };
  for (const [field, env] of Object.entries(mapping)) if (setting[field] != null) process.env[env] = String(setting[field]);
  if (setting.threed66ProxyUrl) process.env.THREED66_PROXY_URL = decryptSecret(setting.threed66ProxyUrl);
  process.env.THREED66_ACCOUNT_MARKER = process.env.THREED66_REQUIRED_ACCOUNT_MARKER;
  const { getUsable3D66Cookies } = await import("./src/utils/3d66CookiePool.js");
  const [cookie] = await getUsable3D66Cookies();
  if (!cookie) throw new Error("NO_USABLE_COOKIE");
  const digest = crypto.createHash("sha256").update(cookie.storedValue).digest("hex");
  const fetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = String(options.method || "GET").toUpperCase();
    if (!url.hostname.endsWith(".3d66.com") || (!['GET', 'HEAD'].includes(method) && url.pathname !== "/api/v1/download/pop")) {
      throw new Error("DIAGNOSTIC_BLOCKED_NON_READ_OPERATION");
    }
    const response = await fetch(input, options);
    requests.push({ method, path: url.pathname, http: response.status });
    return response;
  };
  let launches = 0;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async options => { launches++; return launch(options); };
  const { fetch3D66Preview, close3D66ProxyAgents } = await import("./src/utils/3d66Service.js");
  browserService = await import("./src/utils/3d66BrowserService.js");
  console.log("CONFIG", JSON.stringify({ mode: process.env.THREED66_MODEL_RESOLVE_MODE,
    mock: process.env.THREED66_MOCK, browserAlways: process.env.THREED66_BROWSER_ALWAYS,
    headless: process.env.THREED66_BROWSER_HEADLESS !== "false" }));
  for (const includeFormatOptions of [false, true]) {
    const started = Date.now();
    const before = launches;
    const requestStart = requests.length;
    try {
      const result = await fetch3D66Preview(source, cookie.value, { includeFormatOptions });
      console.log("CASE", JSON.stringify({ includeFormatOptions, ok: true, title: result.title,
        productId: result.productId, hasImage: Boolean(result.imageUrl), priceKnown: result.priceKnown,
        creditCost: result.creditCost, formats: result.formatOptions?.length || 0,
        browserLaunches: launches - before, requests: requests.slice(requestStart), elapsedMs: Date.now() - started }));
    } catch (error) {
      console.log("CASE", JSON.stringify({ includeFormatOptions, ok: false, status: error.status, code: error.code,
        stage: error.details?.stage, reason: error.details?.reason,
        message: String(error.message || "").replace(/https?:\/\/\S+/g, "[url]").slice(0, 240),
        browserLaunches: launches - before, requests: requests.slice(requestStart), elapsedMs: Date.now() - started }));
    }
  }
  const after = await Cookie.findById(cookie._id).select("value").lean();
  console.log("COOKIE_UNCHANGED", digest === crypto.createHash("sha256").update(after.value).digest("hex"));
  console.log("DATABASE_WRITES", 0);
  await close3D66ProxyAgents();
} catch (error) {
  console.error("DIAG_ERROR", error.code || error.name, String(error.message).slice(0, 160));
  process.exitCode = 1;
} finally {
  await browserService?.close3D66Browser().catch(() => {});
  await closeDbConnections();
}
