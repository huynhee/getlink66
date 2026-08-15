import crypto from "node:crypto";
import MarketplaceSearchQueryStat from "../models/MarketplaceSearchQueryStat.js";
import MarketplaceBehaviorEvent from "../models/MarketplaceBehaviorEvent.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { normalizeMarketplaceSearchText } from "./marketplaceSearch.js";

const QUERY_TTL_MS = 90 * 86_400_000;

export async function recordMarketplaceSearchQuery({
  assetType = "model",
  query = "",
  resultCount = 0,
  timingMs = 0,
  engine = "",
} = {}) {
  const displayQuery = String(query || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const normalizedQuery = normalizeMarketplaceSearchText(displayQuery);
  if (normalizedQuery.length < 2) return;
  const type = normalizeAssetType(assetType);
  const now = new Date();
  const timeBucket = now.toISOString().slice(0, 13);
  const queryKey = crypto.createHash("sha256").update(`${type}:${normalizedQuery}:${timeBucket}`).digest("hex");
  const safeResultCount = Math.max(0, Number(resultCount || 0));
  const safeTimingMs = Math.max(0, Number(timingMs || 0));
  await MarketplaceSearchQueryStat.findOneAndUpdate(
    { queryKey },
    {
      $set: {
        queryKey,
        assetType: type,
        normalizedQuery,
        displayQuery,
        timeBucket,
        lastLatencyMs: safeTimingMs,
        lastEngine: String(engine || "").slice(0, 80),
        lastSearchedAt: now,
        expiresAt: new Date(now.getTime() + QUERY_TTL_MS),
      },
      $inc: {
        count: 1,
        zeroResultCount: safeResultCount === 0 ? 1 : 0,
        resultCountTotal: safeResultCount,
        totalLatencyMs: safeTimingMs,
      },
    },
    { upsert: true, new: true },
  );
}

export async function popularMarketplaceSearchSuggestions({ assetType = "model", query = "", limit = 3 } = {}) {
  const normalized = normalizeMarketplaceSearchText(query);
  if (normalized.length < 2) return [];
  const rows = await MarketplaceSearchQueryStat.find({
    assetType: normalizeAssetType(assetType),
    timeBucket: { $exists: true },
    normalizedQuery: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i"),
  })
    .sort({ count: -1, lastSearchedAt: -1 })
    .limit(80)
    .lean();
  const grouped = new Map();
  for (const row of rows) {
    const key = String(row.normalizedQuery || "");
    const current = grouped.get(key) || { ...row, count: 0 };
    current.count += Number(row.count || 0);
    if (!current.lastSearchedAt || new Date(row.lastSearchedAt) > new Date(current.lastSearchedAt)) {
      current.displayQuery = row.displayQuery;
      current.lastSearchedAt = row.lastSearchedAt;
    }
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort((left, right) => right.count - left.count || new Date(right.lastSearchedAt) - new Date(left.lastSearchedAt))
    .slice(0, Math.max(1, Math.min(8, Number(limit || 3))))
    .map((row) => ({
      type: "popular_query",
      value: row.displayQuery,
      label: row.displayQuery,
      assetType: normalizeAssetType(assetType),
    }));
}

export async function marketplaceSearchAnalyticsSnapshot({ hours = 24 } = {}) {
  const since = new Date(Date.now() - Math.max(1, Number(hours || 24)) * 3_600_000);
  const [queries, events] = await Promise.all([
    MarketplaceSearchQueryStat.find({
      timeBucket: { $exists: true },
      lastSearchedAt: { $gte: since },
    }).lean(),
    MarketplaceBehaviorEvent.find({
      occurredAt: { $gte: since },
      eventType: { $in: ["click", "download"] },
    }).select("eventType source").lean(),
  ]);
  const requests = queries.reduce((total, row) => total + Number(row.count || 0), 0);
  const zeroResults = queries.reduce((total, row) => total + Number(row.zeroResultCount || 0), 0);
  const totalLatencyMs = queries.reduce((total, row) => total + Number(row.totalLatencyMs || 0), 0);
  const searchClicks = events.filter((event) => event.eventType === "click" && event.source === "search").length;
  const downloads = events.filter((event) => event.eventType === "download").length;
  const percentage = (value) => requests > 0 ? Math.round((value / requests) * 10_000) / 100 : 0;
  return {
    hours: Math.max(1, Number(hours || 24)),
    requests,
    zeroResults,
    zeroResultRate: percentage(zeroResults),
    averageLatencyMs: requests > 0 ? Math.round((totalLatencyMs / requests) * 10) / 10 : 0,
    searchClicks,
    clickThroughRate: percentage(searchClicks),
    downloads,
    downloadPerSearchRate: percentage(downloads),
  };
}
