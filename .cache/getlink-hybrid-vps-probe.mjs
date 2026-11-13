import crypto from "node:crypto";
import fs from "node:fs";
import { chromium } from "playwright";
import { connectDb, closeDbConnections } from "./src/config/db.js";
import { decryptSecret } from "./src/utils/secretBox.js";

const source = "https://3d.3d66.com/reshtmla/model/items/zm/zmO4AZgFk84WE9fR78Wg.html?sof=BJI010779713376927&sign=0d139133b20aaf51";
let browserService;
let closeAgents;
if (process.env.THREED66_BROWSER_HEADLESS === "false" && !process.env.DISPLAY) {
  process.env.DISPLAY = ":99";
  const auth = fs.readdirSync("/tmp").filter(name => name.startsWith("3dipl-xauth."))
    .sort((a, b) => fs.statSync(`/tmp/${b}`).mtimeMs - fs.statSync(`/tmp/${a}`).mtimeMs)[0];
  if (auth) process.env.XAUTHORITY = `/tmp/${auth}`;
}
await connectDb();
try {
  const { default: Setting } = await import("./src/models/SiteSetting.js");
  const { default: Cookie } = await import("./src/models/Cookie.js");
  const setting = await Setting.findOne({ key: "homepage" }).lean();
  const mapping = {
    threed66RequiredAccountMarker: "THREED66_REQUIRED_ACCOUNT_MARKER",
    threed66BrowserAlways: "THREED66_BROWSER_ALWAYS",
    threed66ProxyEnabled: "THREED66_PROXY_ENABLED",
    threed66ProxyForApi: "THREED66_PROXY_FOR_API",
    threed66ProxyForPreview: "THREED66_PROXY_FOR_PREVIEW",
    threed66ProxyForBrowser: "THREED66_PROXY_FOR_BROWSER",
    threed66ProxyFailClosed: "THREED66_PROXY_FAIL_CLOSED",
    threed66TimeoutMs: "THREED66_TIMEOUT_MS",
  };
  for (const [field, env] of Object.entries(mapping)) {
    if (setting?.[field] != null) process.env[env] = String(setting[field]);
  }
  if (setting?.threed66ProxyUrl) process.env.THREED66_PROXY_URL = decryptSecret(setting.threed66ProxyUrl);
  // Only this diagnostic process opts in. No database setting or production env is changed.
  process.env.THREED66_MODEL_RESOLVE_MODE = "hybrid";
  const { getUsable3D66Cookies } = await import("./src/utils/3d66CookiePool.js");
  const [cookie] = await getUsable3D66Cookies();
  if (!cookie) throw Object.assign(new Error(), { code: "NO_USABLE_COOKIE" });
  const digest = crypto.createHash("sha256").update(cookie.storedValue).digest("hex");
  const fetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!url.hostname.endsWith(".3d66.com") || url.pathname !== "/api/v1/download/pop"
      || options.method !== "POST") throw Object.assign(new Error(), { code: "PROBE_WRITE_BLOCKED" });
    const response = await fetch(input, options);
    requests.push({ http: response.status });
    return response;
  };
  let launches = 0;
  let navigations = 0;
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async options => {
    launches++;
    const browser = await launch(options);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      context.on("page", page => {
        page.on("framenavigated", frame => { if (frame === page.mainFrame()) navigations++; });
      });
      return context;
    };
    return browser;
  };
  const { fetch3D66Preview, close3D66ProxyAgents } = await import("./src/utils/3d66Service.js");
  closeAgents = close3D66ProxyAgents;
  browserService = await import("./src/utils/3d66BrowserService.js");
  for (const stage of ["metadata", "prepare", "cached-prepare"]) {
    const started = Date.now();
    const previousLaunches = launches;
    const previousNavigations = navigations;
    const previousRequests = requests.length;
    try {
      const result = await fetch3D66Preview(source, cookie.value, {
        progressive: stage === "metadata", includeFormatOptions: stage !== "metadata",
      });
      const clean = result.resolvedSourceUrl ? new URL(result.resolvedSourceUrl) : null;
      console.log("HYBRID_PROBE", JSON.stringify({ stage, ok: true, elapsedMs: Date.now() - started,
        hasTitle: Boolean(result.title), hasImage: Boolean(result.imageUrl), priceKnown: result.priceKnown,
        formats: result.formatOptions?.length || 0, status: result.preparationStatus, route: result.resolutionRoute,
        sofCount: clean?.searchParams.getAll("sof").length, signCount: clean?.searchParams.getAll("sign").length,
        browserLaunches: launches - previousLaunches, navigations: navigations - previousNavigations,
        apiRequests: requests.slice(previousRequests) }));
    } catch (error) {
      console.log("HYBRID_PROBE", JSON.stringify({ stage, ok: false, elapsedMs: Date.now() - started,
        code: error.code, status: error.status, reason: error.details?.reason }));
      break;
    }
  }
  const after = await Cookie.findById(cookie._id).select("value").lean();
  console.log("COOKIE_UNCHANGED", digest === crypto.createHash("sha256").update(after.value).digest("hex"));
  console.log("SOURCE_PURCHASES", 0);
} catch (error) {
  console.log("PROBE_FAILED", error.code || error.name);
  process.exitCode = 1;
} finally {
  await browserService?.close3D66Browser().catch(() => {});
  await closeAgents?.();
  await closeDbConnections();
}
