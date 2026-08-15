import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceSearchQueryStat } = await import("../src/models/MarketplaceSearchQueryStat.js");
const {
  marketplaceSearchAnalyticsSnapshot,
  popularMarketplaceSearchSuggestions,
  recordMarketplaceSearchQuery,
} = await import("../src/utils/marketplaceSearchAnalytics.js");

test("search analytics records requests in an hourly bucket", async () => {
  await recordMarketplaceSearchQuery({
    assetType: "model",
    query: "ghế bành",
    resultCount: 12,
    timingMs: 80,
    engine: "meilisearch_hybrid_v3",
  });
  await recordMarketplaceSearchQuery({
    assetType: "model",
    query: "ghế bành",
    resultCount: 0,
    timingMs: 120,
    engine: "meilisearch_hybrid_v3",
  });

  const rows = await MarketplaceSearchQueryStat.find({ normalizedQuery: "ghe banh" }).lean();
  const snapshot = await marketplaceSearchAnalyticsSnapshot({ hours: 24 });

  assert.equal(rows.length, 1);
  assert.match(rows[0].timeBucket, /^\d{4}-\d{2}-\d{2}T\d{2}$/);
  assert.equal(rows[0].count, 2);
  assert.equal(snapshot.requests, 2);
  assert.equal(snapshot.zeroResults, 1);
  assert.equal(snapshot.averageLatencyMs, 100);
});

test("popular suggestions merge the same query across hourly buckets", async () => {
  const now = new Date();
  await MarketplaceSearchQueryStat.create({
    queryKey: "hour-one",
    assetType: "scene",
    normalizedQuery: "phong khach",
    displayQuery: "phòng khách",
    timeBucket: "2026-08-15T10",
    count: 2,
    lastSearchedAt: new Date(now.getTime() - 3_600_000),
    expiresAt: new Date(now.getTime() + 86_400_000),
  });
  await MarketplaceSearchQueryStat.create({
    queryKey: "hour-two",
    assetType: "scene",
    normalizedQuery: "phong khach",
    displayQuery: "phong khach",
    timeBucket: "2026-08-15T11",
    count: 4,
    lastSearchedAt: now,
    expiresAt: new Date(now.getTime() + 86_400_000),
  });

  const suggestions = await popularMarketplaceSearchSuggestions({
    assetType: "scene",
    query: "phong",
    limit: 8,
  });

  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].value, "phong khach");
});
