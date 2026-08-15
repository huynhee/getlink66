import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

const BUILTIN_CASES = [
  ["model", "ghế bành", "vi"],
  ["model", "bàn ăn", "vi"],
  ["model", "đèn sàn", "vi"],
  ["model", "cây cảnh", "vi"],
  ["model", "ghế sofa", "vi"],
  ["model", "tủ trang trí", "vi"],
  ["model", "bàn trà", "vi"],
  ["model", "giường ngủ", "vi"],
  ["model", "ghe banh", "vi_unaccented"],
  ["model", "ban an", "vi_unaccented"],
  ["model", "den san", "vi_unaccented"],
  ["model", "cay canh", "vi_unaccented"],
  ["model", "ghe sofa", "vi_unaccented"],
  ["model", "tu trang tri", "vi_unaccented"],
  ["model", "arm chair", "en"],
  ["model", "dining table", "en"],
  ["model", "floor lamp", "en"],
  ["model", "indoor plant", "en"],
  ["model", "modular sofa", "en"],
  ["model", "coffee table", "en"],
  ["model", "ghe bamh", "typo"],
  ["model", "dinning tabel", "typo"],
  ["model", "flor lmap", "typo"],
  ["model", "modulr soffa", "typo"],
  ["model", "ghế hiện đại bọc vải", "natural"],
  ["model", "bàn ăn gỗ phong cách hiện đại", "natural"],
  ["model", "đèn trang trí phòng khách", "natural"],
  ["model", "modern fabric lounge chair", "natural"],
  ["scene", "phòng khách", "vi"],
  ["scene", "phòng ngủ", "vi"],
  ["scene", "nhà hàng", "vi"],
  ["scene", "văn phòng", "vi"],
  ["scene", "phong khach", "vi_unaccented"],
  ["scene", "phong ngu", "vi_unaccented"],
  ["scene", "nha hang", "vi_unaccented"],
  ["scene", "living room", "en"],
  ["scene", "bedroom", "en"],
  ["scene", "restaurant", "en"],
  ["scene", "office", "en"],
  ["scene", "livng rom", "typo"],
  ["scene", "bedrom interor", "typo"],
  ["scene", "phòng khách hiện đại ánh sáng ấm", "natural"],
  ["scene", "modern luxury hotel lobby", "natural"],
].map(([assetType, q, group]) => ({ assetType, q, group }));

function args(argv = process.argv.slice(2)) {
  const values = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const [key, ...rest] = item.slice(2).split("=");
    values[key] = rest.length ? rest.join("=") : true;
  }
  return values;
}

function numberArg(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, Math.floor(parsed))) : fallback;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

async function loadCases(fileName) {
  if (!fileName) return BUILTIN_CASES;
  const source = JSON.parse(await fs.readFile(path.resolve(fileName), "utf8"));
  if (!Array.isArray(source) || !source.length) throw new Error("Query file must contain a non-empty JSON array");
  return source.map((item, index) => {
    const value = typeof item === "string" ? { q: item } : item;
    const q = String(value?.q || "").trim();
    if (q.length < 2) throw new Error(`Query case ${index + 1} must contain at least two characters`);
    return {
      assetType: value.assetType === "scene" ? "scene" : "model",
      q,
      group: String(value.group || "custom"),
      expectedIds: Array.isArray(value.expectedIds) ? value.expectedIds.map(String) : [],
      minResults: Math.max(0, Number(value.minResults || 0)),
    };
  });
}

async function runRequest({ baseUrl, testCase, sequence, timeoutMs }) {
  const segment = testCase.assetType === "scene" ? "scenes" : "models";
  const url = new URL(`/api/marketplace/${segment}`, baseUrl);
  url.searchParams.set("q", testCase.q);
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("limit", "12");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "3dipl-search-v3-evaluator/1.0",
        "x-marketplace-session-id": `evaluation-${sequence % 50}`,
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    const latencyMs = Math.round((performance.now() - startedAt) * 10) / 10;
    const assets = payload.assets || payload.models || payload.scenes || [];
    const assetIds = assets.flatMap((asset) => [asset._id, asset.id, asset.sourceAssetId]).filter(Boolean).map(String);
    const expectedMatched = !testCase.expectedIds?.length
      || testCase.expectedIds.some((id) => assetIds.includes(id));
    return {
      sequence,
      assetType: testCase.assetType,
      q: testCase.q,
      group: testCase.group,
      ok: response.ok,
      status: response.status,
      latencyMs,
      resultCount: Number(payload.pagination?.total ?? assets.length ?? 0),
      engine: String(payload.search?.engine || "unknown"),
      mode: String(payload.search?.mode || "unknown"),
      timingMs: Number(payload.search?.timingMs || 0),
      correctedQuery: String(payload.search?.correctedQuery || ""),
      qualityPassed: expectedMatched && Number(payload.pagination?.total ?? assets.length ?? 0) >= (testCase.minResults || 0),
      error: response.ok ? "" : String(payload.message || payload.error || `HTTP ${response.status}`).slice(0, 300),
    };
  } catch (error) {
    return {
      sequence,
      assetType: testCase.assetType,
      q: testCase.q,
      group: testCase.group,
      ok: false,
      status: 0,
      latencyMs: Math.round((performance.now() - startedAt) * 10) / 10,
      resultCount: 0,
      engine: "request_error",
      mode: "error",
      timingMs: 0,
      correctedQuery: "",
      qualityPassed: false,
      error: String(error?.message || error).slice(0, 300),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function countBy(results, field) {
  return Object.fromEntries([...results.reduce((map, item) => {
    const key = String(item[field] || "unknown");
    map.set(key, (map.get(key) || 0) + 1);
    return map;
  }, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));
}

const options = args();
const baseUrl = String(options["base-url"] || process.env.MARKETPLACE_EVALUATION_BASE_URL || "http://127.0.0.1:5000");
const requestCount = numberArg(options.requests, 200, 1, 10_000);
const concurrency = numberArg(options.concurrency, 50, 1, 50);
const timeoutMs = numberArg(options["timeout-ms"], 5_000, 300, 60_000);
const maxP95Ms = numberArg(options["max-p95-ms"], 300, 1, 60_000);
const maxErrorRate = Math.min(100, Math.max(0, Number(options["max-error-rate"] || 0)));
const cases = await loadCases(options.queries);
const requests = Array.from({ length: requestCount }, (_, index) => cases[index % cases.length]);
const startedAt = new Date();
const results = await runPool(requests, concurrency, (testCase, sequence) => runRequest({
  baseUrl,
  testCase,
  sequence,
  timeoutMs,
}));
const successful = results.filter((item) => item.ok);
const latencies = successful.map((item) => item.latencyMs);
const failures = results.filter((item) => !item.ok);
const zeroResults = successful.filter((item) => item.resultCount === 0);
const qualityFailures = results.filter((item) => !item.qualityPassed);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  startedAt: startedAt.toISOString(),
  baseUrl,
  configuration: { requestCount, concurrency, timeoutMs, maxP95Ms, maxErrorRate },
  summary: {
    requests: results.length,
    successful: successful.length,
    errors: failures.length,
    errorRate: Math.round((failures.length / Math.max(1, results.length)) * 10_000) / 100,
    zeroResults: zeroResults.length,
    zeroResultRate: Math.round((zeroResults.length / Math.max(1, successful.length)) * 10_000) / 100,
    qualityFailures: qualityFailures.length,
    p50Ms: percentile(latencies, 0.5),
    p95Ms: percentile(latencies, 0.95),
    p99Ms: percentile(latencies, 0.99),
    maxMs: latencies.length ? Math.max(...latencies) : 0,
    engines: countBy(results, "engine"),
    groups: countBy(results, "group"),
  },
  failures: failures.slice(0, 50),
  qualityFailures: qualityFailures.slice(0, 50),
  results: options.verbose ? results : undefined,
};

if (options.output) {
  const outputPath = path.resolve(String(options.output));
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

console.log(JSON.stringify(report, null, 2));

if (options.assert) {
  const reasons = [];
  if (report.summary.p95Ms > maxP95Ms) reasons.push(`p95 ${report.summary.p95Ms} ms exceeds ${maxP95Ms} ms`);
  if (report.summary.errorRate > maxErrorRate) reasons.push(`error rate ${report.summary.errorRate}% exceeds ${maxErrorRate}%`);
  if (qualityFailures.length) reasons.push(`${qualityFailures.length} query quality checks failed`);
  if (reasons.length) {
    console.error(`Search V3 evaluation failed: ${reasons.join("; ")}`);
    process.exitCode = 1;
  }
}
