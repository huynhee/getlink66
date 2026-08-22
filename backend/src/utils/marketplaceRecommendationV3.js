import MarketplaceBehaviorEvent from "../models/MarketplaceBehaviorEvent.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import ModelDownload from "../models/ModelDownload.js";
import MarketplaceRecommendationCache from "../models/MarketplaceRecommendationCache.js";
import { marketplaceAssetTypeFilter, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { marketplaceContentScore } from "./marketplaceDiscovery.js";
import { hydrateMarketplaceCategoryRefs } from "./marketplaceTaxonomy.js";
import { marketplacePublicDeletionQuery } from "./marketplaceDeletionService.js";
import { searchMarketplaceMeili } from "./marketplaceMeilisearch.js";
import logger from "./logger.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const RECENT_DOWNLOAD_DAYS = 180;
const pending = new Set();
let timer = null;
let running = false;

function values(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean))];
}

function overlap(left, right) {
  const a = new Set(values(left));
  const b = new Set(values(right));
  if (!a.size || !b.size) return 0;
  let shared = 0;
  a.forEach((item) => { if (b.has(item)) shared += 1; });
  return shared / new Set([...a, ...b]).size;
}

function similarity(left, right) {
  if (String(left.categorySourceId || "") === String(right.categorySourceId || "")) return 1;
  const title = overlap(
    String(left.title || "").toLowerCase().split(/[^a-z0-9]+/),
    String(right.title || "").toLowerCase().split(/[^a-z0-9]+/),
  );
  return Math.max(title, overlap(left.styles, right.styles), overlap(left.materials, right.materials));
}

function diversify(scored, limit = 60) {
  const selected = [];
  const remaining = [...scored];
  const maxScore = Math.max(...remaining.map((item) => item.score), 1);
  while (selected.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    remaining.forEach((item, index) => {
      const duplication = selected.length
        ? Math.max(...selected.map((selectedItem) => similarity(selectedItem.model, item.model)))
        : 0;
      const value = (item.score / maxScore) * 0.86 - duplication * 0.14;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected.map((item) => item.model);
}

function publicQuery(model, extra = {}) {
  const assetType = normalizeAssetType(model.assetType);
  return {
    assetType: marketplaceAssetTypeFilter(assetType),
    ...(assetType === "model" ? { accessType: "member" } : {}),
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    ...marketplacePublicDeletionQuery(),
    ...extra,
  };
}

function relatedQuery(model) {
  const related = [];
  if (model.categorySourceId) related.push({ categorySourceId: model.categorySourceId });
  if (model.parentCategorySourceId) related.push({ parentCategorySourceId: model.parentCategorySourceId });
  if (model.renderer) related.push({ renderer: model.renderer });
  if (model.styles?.length) related.push({ styles: { $in: model.styles } });
  if (model.renderers?.length) related.push({ renderers: { $in: model.renderers } });
  if (model.platforms?.length) related.push({ platforms: { $in: model.platforms } });
  if (normalizeAssetType(model.assetType) === "model") {
    if (model.materials?.length) related.push({ materials: { $in: model.materials } });
    if (model.forms?.length) related.push({ forms: { $in: model.forms } });
  }
  return related.length ? { $or: related } : {};
}

async function behaviorScores(model) {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const sourceEvents = await MarketplaceBehaviorEvent.find({
    modelId: model._id,
    occurredAt: { $gte: since },
  })
    .select("actorKey")
    .sort({ occurredAt: -1 })
    .limit(300)
    .lean();
  const actorKeys = [...new Set(sourceEvents.map((event) => event.actorKey).filter(Boolean))];
  if (!actorKeys.length) return new Map();
  const relatedEvents = await MarketplaceBehaviorEvent.find({
    actorKey: { $in: actorKeys },
    assetType: normalizeAssetType(model.assetType),
    modelId: { $ne: model._id },
    eventType: { $in: ["click", "detail_view", "download"] },
    occurredAt: { $gte: since },
  })
    .select("modelId eventType occurredAt")
    .sort({ occurredAt: -1 })
    .limit(2_000)
    .lean();
  const scores = new Map();
  const weights = { detail_view: 1, click: 3, download: 8 };
  relatedEvents.forEach((event) => {
    const id = String(event.modelId || "");
    if (!id) return;
    const ageDays = Math.max(0, (Date.now() - new Date(event.occurredAt || 0).getTime()) / 86_400_000);
    const score = Number(weights[event.eventType] || 0) * Math.pow(0.5, ageDays / 30);
    scores.set(id, Number(scores.get(id) || 0) + score);
  });
  return scores;
}

async function semanticCandidates(model) {
  try {
    const result = await searchMarketplaceMeili({
      assetType: model.assetType,
      q: [model.title, model.categorySourceId, model.renderer, ...(model.styles || [])].filter(Boolean).join(" "),
      accessType: normalizeAssetType(model.assetType) === "model" ? "member" : "",
      categoryKeys: [],
      facets: {},
      sort: "relevance",
      page: 1,
      limit: 60,
      prioritizePro: false,
    });
    return result?.assets || [];
  } catch {
    return [];
  }
}

async function buildRecommendationCache(model) {
  const [localCandidates, semantic, behavior] = await Promise.all([
    MarketplaceModel.find(publicQuery(model, {
      _id: { $ne: model._id },
      ...relatedQuery(model),
    }))
      .sort({ downloadCount: -1, sourceAssetIdSort: -1, createdAt: -1 })
      .limit(240)
      .lean(),
    semanticCandidates(model),
    behaviorScores(model),
  ]);
  const byId = new Map(localCandidates.map((candidate) => [String(candidate._id), candidate]));
  const semanticScore = new Map();
  semantic.forEach((candidate, index) => {
    const id = String(candidate._id || "");
    if (!id || id === String(model._id)) return;
    semanticScore.set(id, Number(candidate._searchScore || (semantic.length - index) / semantic.length));
  });
  const missingIds = [...semanticScore.keys()].filter((id) => !byId.has(id));
  if (missingIds.length) {
    const extra = await MarketplaceModel.find(publicQuery(model, { _id: { $in: missingIds } }))
      .limit(60)
      .lean();
    extra.forEach((candidate) => byId.set(String(candidate._id), candidate));
  }
  const candidates = [...byId.values()].filter((candidate) => String(candidate._id) !== String(model._id));
  const maxContent = Math.max(...candidates.map((candidate) => marketplaceContentScore(model, candidate)), 1);
  const maxBehavior = Math.max(...candidates.map((candidate) => Number(behavior.get(String(candidate._id)) || 0)), 1);
  const maxDownloads = Math.max(...candidates.map((candidate) => Math.log2(Number(candidate.downloadCount || 0) + 1)), 1);
  const scored = candidates.map((candidate) => {
    const createdAt = new Date(candidate.createdAt || 0).getTime();
    const freshness = createdAt > 0
      ? Math.exp(-Math.max(0, (Date.now() - createdAt) / 86_400_000) / 180)
      : 0;
    return {
      model: candidate,
      score:
        (marketplaceContentScore(model, candidate) / maxContent) * 45
        + Number(semanticScore.get(String(candidate._id)) || 0) * 35
        + (Number(behavior.get(String(candidate._id)) || 0) / maxBehavior) * 10
        + (Math.log2(Number(candidate.downloadCount || 0) + 1) / maxDownloads) * 5
        + freshness * 5,
    };
  }).sort((left, right) => right.score - left.score || String(left.model._id).localeCompare(String(right.model._id)));
  const ranked = diversify(scored, 60);
  await MarketplaceRecommendationCache.findOneAndUpdate(
    { modelId: model._id },
    {
      $set: {
        modelId: model._id,
        assetType: normalizeAssetType(model.assetType),
        candidateIds: ranked.map((candidate) => candidate._id),
        engine: "catalog_behavior_v3",
        sourceUpdatedAt: model.updatedAt || new Date(),
        generatedAt: new Date(),
        expiresAt: new Date(Date.now() + CACHE_TTL_MS),
        error: "",
      },
    },
    { upsert: true, new: true },
  );
  return ranked;
}

async function recentDownloads(userId) {
  if (!userId) return [];
  const rows = await ModelDownload.find({
    userId,
    status: "downloaded",
    downloadedAt: { $gte: new Date(Date.now() - RECENT_DOWNLOAD_DAYS * 86_400_000) },
  })
    .select("modelId")
    .sort({ downloadedAt: -1 })
    .limit(60)
    .lean();
  return rows.map((row) => String(row.modelId?._id || row.modelId || "")).filter(Boolean);
}

async function modelsForIds(model, candidateIds, excludedIds = []) {
  const exclusions = new Set([String(model._id), ...excludedIds.map(String)]);
  const ids = candidateIds.map(String).filter((id) => !exclusions.has(id));
  if (!ids.length) return [];
  const models = await MarketplaceModel.find(publicQuery(model, { _id: { $in: ids } })).lean();
  const byId = new Map(models.map((candidate) => [String(candidate._id), candidate]));
  const ordered = ids.map((id) => byId.get(id)).filter(Boolean);
  await hydrateMarketplaceCategoryRefs(ordered);
  return ordered;
}

async function fastFallback(model, excludedIds = []) {
  const exclusions = [model._id, ...excludedIds];
  let candidates = await MarketplaceModel.find(publicQuery(model, {
    _id: { $nin: exclusions },
    ...relatedQuery(model),
  }))
    .sort({ downloadCount: -1, sourceAssetIdSort: -1, createdAt: -1 })
    .limit(90)
    .lean();
  if (candidates.length < 60) {
    const seen = new Set([String(model._id), ...excludedIds.map(String), ...candidates.map((item) => String(item._id))]);
    const fill = await MarketplaceModel.find(publicQuery(model, { _id: { $nin: [...seen] } }))
      .sort({ downloadCount: -1, sourceAssetIdSort: -1, createdAt: -1 })
      .limit(60 - candidates.length)
      .lean();
    candidates = [...candidates, ...fill];
  }
  const ranked = candidates
    .map((candidate) => ({ model: candidate, score: marketplaceContentScore(model, candidate) }))
    .sort((left, right) => right.score - left.score);
  const models = diversify(ranked, 60);
  await hydrateMarketplaceCategoryRefs(models);
  return models;
}

export function enqueueMarketplaceRecommendationRefresh(modelId) {
  if (modelId) pending.add(String(modelId));
}

export async function getMarketplaceRecommendationsV3(model, options = {}) {
  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.min(60, Math.max(1, Number(options.limit || 6)));
  const excluded = await recentDownloads(options.userId);
  const cache = await MarketplaceRecommendationCache.findOne({ modelId: model._id }).lean();
  const valid = cache
    && new Date(cache.expiresAt || 0) > new Date()
    && new Date(cache.sourceUpdatedAt || 0) >= new Date(model.updatedAt || 0);
  if (valid) {
    const models = await modelsForIds(model, cache.candidateIds || [], excluded);
    return {
      models: models.slice(offset, offset + limit),
      total: models.length,
      engine: cache.engine || "catalog_behavior_v3",
      cached: true,
    };
  }
  enqueueMarketplaceRecommendationRefresh(model._id);
  const fallback = await fastFallback(model, excluded);
  return {
    models: fallback.slice(offset, offset + limit),
    total: fallback.length,
    engine: "catalog_fast_fallback_v3",
    cached: false,
  };
}

async function runOne() {
  if (running || !pending.size) return;
  running = true;
  const modelId = pending.values().next().value;
  pending.delete(modelId);
  try {
    const model = await MarketplaceModel.findById(modelId).lean();
    if (model) await buildRecommendationCache(model);
  } catch (error) {
    logger.warn({ err: error, modelId }, "Marketplace recommendation cache build failed");
  } finally {
    running = false;
  }
}

export function startMarketplaceRecommendationJob() {
  if (timer || String(process.env.MARKETPLACE_RECOMMENDATION_WORKER_ENABLED || "true").toLowerCase() !== "true") return;
  const intervalMs = Math.max(1_000, Number(process.env.MARKETPLACE_RECOMMENDATION_WORKER_INTERVAL_MS || 2_000));
  timer = setInterval(() => runOne().catch(() => {}), intervalMs);
  timer.unref?.();
}

export function stopMarketplaceRecommendationJob() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function marketplaceRecommendationCacheStats() {
  const [ready, stale] = await Promise.all([
    MarketplaceRecommendationCache.countDocuments({ expiresAt: { $gt: new Date() } }),
    MarketplaceRecommendationCache.countDocuments({ expiresAt: { $lte: new Date() } }),
  ]);
  return { ready, stale, queued: pending.size, running };
}
