import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const backendPort = Number(process.env.QA_BACKEND_PORT || 5511);
const frontendPort = Number(process.env.QA_FRONTEND_PORT || 5512);
const backendOrigin = `http://127.0.0.1:${backendPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
const buildRoot = path.resolve(process.argv[2] || "../qa-report/test-results/release-dist");
const screenshotRoot = path.resolve(process.argv[3] || "../qa-report/screenshots");
const resultPath = path.resolve(process.argv[4] || "../qa-report/performance-results/smoke.json");
const routeSet = ["/", "/models", "/scenes", "/guide", "/privacy", "/terms"];
const systemBrowsers = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];

function browserLaunchOptions() {
  const bundled = chromium.executablePath();
  if (bundled && fs.existsSync(bundled)) return { headless: true };
  const executablePath = systemBrowsers.find((candidate) => fs.existsSync(candidate));
  if (!executablePath) {
    throw new Error("No Playwright Chromium or supported system browser is installed.");
  }
  return { headless: true, executablePath };
}

function isExpectedClientAbort(request) {
  const errorText = String(request.failure()?.errorText || "");
  return !request.isNavigationRequest()
    && errorText.includes("net::ERR_ABORTED");
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  }[extension] || "application/octet-stream";
}

function proxyApi(req, res) {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: backendPort,
    method: req.method,
    path: req.url,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${backendPort}`,
      "x-forwarded-host": `127.0.0.1:${frontendPort}`,
      "x-forwarded-proto": "http",
    },
  }, (upstreamResponse) => {
    res.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(res);
  });
  upstream.on("error", (error) => {
    if (res.headersSent || res.writableEnded) {
      res.destroy(error);
      return;
    }
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: error.message }));
  });
  req.pipe(upstream);
}

function staticServer() {
  return http.createServer((req, res) => {
    if (String(req.url || "").startsWith("/api/")) {
      proxyApi(req, res);
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url || "/", frontendOrigin).pathname);
    const requested = path.resolve(buildRoot, `.${pathname}`);
    const insideBuild = requested === buildRoot || requested.startsWith(`${buildRoot}${path.sep}`);
    let file = insideBuild && fs.existsSync(requested) && fs.statSync(requested).isFile()
      ? requested
      : path.join(buildRoot, "index.html");
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end("Missing frontend build");
      return;
    }
    res.writeHead(200, {
      "cache-control": file.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable",
      "content-type": contentType(file),
    });
    fs.createReadStream(file).pipe(res);
  });
}

async function waitForBackend(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${backendOrigin}/ready`);
      if (response.ok) return response.json();
    } catch {
      // Startup has not completed yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Backend readiness timeout");
}

async function backendMemory(child, collectGarbage = true) {
  const requestId = `${Date.now()}-${Math.random()}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.off("message", onMessage);
      reject(new Error("Backend memory diagnostic timed out"));
    }, 5_000);
    function onMessage(message) {
      if (message?.type !== "qa:memory" || message.requestId !== requestId) return;
      clearTimeout(timeout);
      child.off("message", onMessage);
      resolve(message.memory);
    }
    child.on("message", onMessage);
    child.send({ type: "qa:memory", requestId, collectGarbage });
  });
}

async function catalogLoad({ total = 300, concurrency = 20 } = {}) {
  const durations = [];
  let index = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= total) return;
      const startedAt = performance.now();
      const response = await fetch(
        `${backendOrigin}/api/marketplace/models?page=1&limit=60&sort=newest`,
      );
      if (!response.ok) {
        throw new Error(`Catalog load request returned HTTP ${response.status}`);
      }
      await response.arrayBuffer();
      durations.push(performance.now() - startedAt);
    }
  });
  await Promise.all(workers);
  durations.sort((left, right) => left - right);
  const percentile = (value) => durations[Math.min(
    durations.length - 1,
    Math.floor(durations.length * value),
  )];
  return {
    total,
    concurrency,
    medianMs: Math.round(percentile(0.5) * 100) / 100,
    p95Ms: Math.round(percentile(0.95) * 100) / 100,
    maximumMs: Math.round(durations.at(-1) * 100) / 100,
  };
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function main() {
  if (!fs.existsSync(path.join(buildRoot, "index.html"))) {
    throw new Error(`Build is missing: ${buildRoot}`);
  }
  fs.mkdirSync(screenshotRoot, { recursive: true });

  const backend = spawn(process.execPath, ["--expose-gc", "server.js"], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(backendPort),
      CLIENT_URL: frontendOrigin,
      PUBLIC_BASE_URL: backendOrigin,
      CORS_ORIGINS: frontendOrigin,
      MONGO_URI: "",
      MONGO_CORE_URI: "",
      MONGO_MARKETPLACE_URI: "",
      MARKETPLACE_DB_TARGET: "core",
      MONGO_MARKETPLACE_TRANSACTIONS_REQUIRED: "false",
      ALLOW_MEMORY_DB: "true",
      ALLOW_DEV_LOGIN: "true",
      ALLOW_DEV_ADMIN_LOGIN: "true",
      ADMIN_EMAILS: "dev@local.test",
      ADMIN_2FA_REQUIRED: "false",
      DEV_LOGIN_ROLE: "user",
      DEV_LOGIN_PRO: "false",
      THREED66_MOCK: "true",
      SEPAY_ENABLED: "false",
      TURNSTILE_ENABLED: "false",
      GETLINK_JOB_ENABLED: "false",
      HISTORY_RETENTION_JOB_ENABLED: "false",
      MARKETPLACE_QUOTA_GRANT_JOB_ENABLED: "false",
      MARKETPLACE_DRIVE_CHANGES_ENABLED: "false",
      MARKETPLACE_DRIVE_WRITE_ENABLED: "false",
      MARKETPLACE_BILINGUAL_SEARCH_ENABLED: "false",
      PLUGIN_API_ENABLED: "true",
      PLUGIN_JWT_SECRET: "qa-only-plugin-secret-with-more-than-32-characters",
      QA_DIAGNOSTICS_ENABLED: "true",
      LOG_LEVEL: "warn",
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const backendLogs = [];
  backend.stdout.on("data", (chunk) => backendLogs.push(chunk.toString()));
  backend.stderr.on("data", (chunk) => backendLogs.push(chunk.toString()));

  const frontend = staticServer();
  await new Promise((resolve, reject) => {
    frontend.once("error", reject);
    frontend.listen(frontendPort, "127.0.0.1", resolve);
  });

  let browser;
  try {
    const readiness = await waitForBackend();
    if (!readiness.ready) throw new Error("Backend reported not ready");

    for (const endpoint of ["/health", "/ready", "/api/marketplace/categories", "/api/marketplace/filters"]) {
      const response = await fetch(`${backendOrigin}${endpoint}`);
      if (!response.ok) throw new Error(`${endpoint} returned HTTP ${response.status}`);
    }
    const headerResponse = await fetch(`${backendOrigin}/health`, {
      headers: { origin: frontendOrigin },
    });
    if (headerResponse.headers.get("x-powered-by")) {
      throw new Error("Backend leaked the Express x-powered-by header");
    }
    if (headerResponse.headers.get("x-content-type-options") !== "nosniff") {
      throw new Error("Backend is missing X-Content-Type-Options");
    }
    if (!headerResponse.headers.get("permissions-policy")?.includes("camera=()")) {
      throw new Error("Backend is missing the restrictive Permissions-Policy");
    }
    if (headerResponse.headers.get("access-control-allow-origin") !== frontendOrigin) {
      throw new Error("Backend did not allow the configured frontend origin");
    }
    const deniedOrigin = await fetch(`${backendOrigin}/health`, {
      headers: { origin: "https://untrusted.example.test" },
    });
    if (deniedOrigin.status !== 403) {
      throw new Error(`Untrusted CORS origin returned HTTP ${deniedOrigin.status}`);
    }
    const missingCsrf = await fetch(`${backendOrigin}/api/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    if (missingCsrf.status !== 403) {
      throw new Error(`Mutation without CSRF returned HTTP ${missingCsrf.status}`);
    }
    const unsafePayload = await fetch(`${backendOrigin}/api/auth/logout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ $where: "return true" }),
    });
    if (unsafePayload.status !== 400) {
      throw new Error(`Unsafe Mongo-style payload returned HTTP ${unsafePayload.status}`);
    }
    const pluginStart = await fetch(`${backendOrigin}/api/plugin/auth/device/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deviceName: "QA-WORKSTATION",
        pluginVersion: "0.1.0",
        maxVersion: "2026",
      }),
    });
    if (pluginStart.status !== 201) {
      throw new Error(`Plugin device start returned HTTP ${pluginStart.status}`);
    }

    const memoryBefore = await backendMemory(backend);
    const load = await catalogLoad();
    const memoryAfter = await backendMemory(backend);
    const heapDeltaBytes = Number(memoryAfter.heapUsed || 0) - Number(memoryBefore.heapUsed || 0);
    if (load.p95Ms > 500) {
      throw new Error(`Catalog load p95 exceeded 500ms: ${load.p95Ms}ms`);
    }
    if (heapDeltaBytes > 20 * 1024 * 1024) {
      throw new Error(`Backend heap grew more than 20 MiB after load: ${heapDeltaBytes}`);
    }

    browser = await chromium.launch(browserLaunchOptions());
    const errors = [];
    const externalFailures = [];
    const slowest = [];

    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      page.on("console", (message) => {
        if (
          message.type() === "error"
          && !message.text().includes("Failed to load resource")
        ) {
          errors.push(`${viewport.name}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => errors.push(`${viewport.name}: ${error.message}`));
      page.on("requestfailed", (request) => {
        if (isExpectedClientAbort(request)) return;
        const url = request.url();
        const item = `${viewport.name}: ${request.failure()?.errorText || "request failed"} ${url}`;
        if (url.startsWith(frontendOrigin) || url.startsWith(backendOrigin)) {
          errors.push(item);
        } else {
          externalFailures.push(item);
        }
      });
      page.on("response", (response) => {
        if (response.status() >= 500) errors.push(`${viewport.name}: HTTP ${response.status()} ${response.url()}`);
      });

      for (const route of routeSet) {
        const startedAt = Date.now();
        const response = await page.goto(`${frontendOrigin}${route}`, {
          waitUntil: "domcontentloaded",
          timeout: 15_000,
        });
        if (!response?.ok()) throw new Error(`${viewport.name} ${route} returned HTTP ${response?.status()}`);
        await page.waitForSelector("#root", { state: "visible" });
        const text = (await page.locator("#root").innerText()).trim();
        if (!text) throw new Error(`${viewport.name} ${route} rendered an empty root`);
        slowest.push({ viewport: viewport.name, route, durationMs: Date.now() - startedAt });
      }

      await page.goto(`${frontendOrigin}/models`, { waitUntil: "domcontentloaded" });
      await page.screenshot({
        path: path.join(screenshotRoot, `${viewport.name}-models.png`),
        fullPage: true,
      });

      await page.goto(
        `${frontendOrigin}/api/auth/dev-login?role=admin&pro=true&returnTo=%2Fadmin`,
        { waitUntil: "domcontentloaded" },
      );
      await page.waitForURL(`${frontendOrigin}/admin`);
      await page.waitForSelector("#root", { state: "visible" });
      const adminText = (await page.locator("#root").innerText()).trim();
      if (!adminText) throw new Error(`${viewport.name} admin rendered an empty root after dev login`);
      await page.screenshot({
        path: path.join(screenshotRoot, `${viewport.name}-admin.png`),
        fullPage: true,
      });
      await context.close();
    }

    if (errors.length) {
      throw new Error(`Browser smoke errors:\n${errors.slice(0, 20).join("\n")}`);
    }
    slowest.sort((left, right) => right.durationMs - left.durationMs);
    const summary = {
      ok: true,
      routes: routeSet.length,
      viewports: 2,
      externalFailures: externalFailures.length,
      externalFailureSamples: externalFailures.slice(0, 10),
      load,
      memory: {
        beforeHeapBytes: memoryBefore.heapUsed,
        afterHeapBytes: memoryAfter.heapUsed,
        heapDeltaBytes,
        beforeRssBytes: memoryBefore.rss,
        afterRssBytes: memoryAfter.rss,
      },
      slowest: slowest.slice(0, 5),
    };
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    await new Promise((resolve) => frontend.close(resolve));
    await stopChild(backend);
    if (backend.exitCode && backend.exitCode !== 0) {
      console.error(backendLogs.join("").slice(-4_000));
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
