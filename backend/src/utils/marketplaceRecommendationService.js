import MarketplaceModel from "../models/MarketplaceModel.js";
import ModelDownload from "../models/ModelDownload.js";
import MarketplaceInterestProfile from "../models/MarketplaceInterestProfile.js";
import { hydrateMarketplaceCategoryRefs } from "./marketplaceTaxonomy.js";
import { normalizeMarketplaceSearchText } from "./marketplaceSearch.js";
import { marketplaceSourceIdNumber } from "./marketplaceSort.js";
import { marketplacePublicDeletionQuery } from "./marketplaceDeletionService.js";

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_USERS = 2_000;
const HISTORY_DAYS = 180;
const HISTORY_LIMIT = 30;
const HALF_LIFE_DAYS = 30;
const DAILY_POPULAR_CACHE_TTL_MS = 60 * 1000;
const cache = new Map();
let dailyPopularCache = null;

function cacheKey(userId) {
  return String(userId || "guest");
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_USERS) cache.delete(cache.keys().next().value);
}

export function invalidateMarketplaceHomeRecommendations(userId) {
  cache.delete(cacheKey(userId));
  cache.delete("guest");
  dailyPopularCache = null;
}

function values(value) {
  return [...new Set((Array.isArray(value) ? value : [value])
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean))];
}

function increment(map, key, amount) {
  const normalized = String(key || "").trim().toLowerCase();
  if (normalized) map.set(normalized, (map.get(normalized) || 0) + amount);
}

function preferenceProfile(historyModels, downloads) {
  const byId = new Map(historyModels.map((model) => [String(model._id), model]));
  const profile = {
    category: new Map(),
    parent: new Map(),
    renderer: new Map(),
    style: new Map(),
    render: new Map(),
    form: new Map(),
    color: new Map(),
    material: new Map(),
  };
  const now = Date.now();
  downloads.forEach((download) => {
    const model = byId.get(String(download.modelId?._id || download.modelId));
    if (!model) return;
    const timestamp = new Date(download.downloadedAt || download.createdAt || 0).getTime();
    const ageDays = Math.max(0, (now - timestamp) / 86_400_000);
    const weight = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
    increment(profile.category, model.categorySourceId, weight * 3);
    increment(profile.parent, model.parentCategorySourceId, weight * 1.5);
    increment(profile.renderer, model.renderer, weight);
    values(model.styles).forEach((value) => increment(profile.style, value, weight));
    values(model.renderers).forEach((value) => increment(profile.render, value, weight));
    values(model.forms).forEach((value) => increment(profile.form, value, weight));
    values(model.colors).forEach((value) => increment(profile.color, value, weight));
    values(model.materials).forEach((value) => increment(profile.material, value, weight));
  });
  return profile;
}

function profileScore(profile, model) {
  let score = 0;
  score += profile.category.get(String(model.categorySourceId || "").toLowerCase()) || 0;
  score += profile.parent.get(String(model.parentCategorySourceId || "").toLowerCase()) || 0;
  score += profile.renderer.get(String(model.renderer || "").toLowerCase()) || 0;
  const facetFields = [
    ["style", model.styles],
    ["render", model.renderers],
    ["form", model.forms],
    ["color", model.colors],
    ["material", model.materials],
  ];
  facetFields.forEach(([facet, assigned]) => {
    values(assigned).forEach((value) => { score += profile[facet].get(value) || 0; });
  });
  return score;
}

function recency(model, now = Date.now()) {
  const created = new Date(model.createdAt || 0).getTime();
  if (!Number.isFinite(created) || created <= 0) return 0;
  return Math.exp(-Math.max(0, (now - created) / 86_400_000) / 180);
}

function candidateSimilarity(left, right) {
  if (String(left.categorySourceId || "") === String(right.categorySourceId || "")) return 1;
  const leftTerms = new Set(values([
    ...values(left.styles),
    ...values(left.renderers),
    ...normalizeMarketplaceSearchText(left.title).split(" "),
  ]));
  const rightTerms = new Set(values([
    ...values(right.styles),
    ...values(right.renderers),
    ...normalizeMarketplaceSearchText(right.title).split(" "),
  ]));
  if (!leftTerms.size || !rightTerms.size) return 0;
  let shared = 0;
  leftTerms.forEach((term) => { if (rightTerms.has(term)) shared += 1; });
  return shared / new Set([...leftTerms, ...rightTerms]).size;
}

function diversify(scored, limit) {
  const selected = [];
  const remaining = [...scored];
  const maxScore = Math.max(...remaining.map((item) => item.score), 1);
  while (selected.length < limit && remaining.length) {
    let bestIndex = 0;
    let bestValue = -Infinity;
    remaining.forEach((item, index) => {
      const duplicate = selected.length
        ? Math.max(...selected.map((chosen) => candidateSimilarity(chosen.model, item.model)))
        : 0;
      const value = (item.score / maxScore) * 0.86 - duplicate * 0.14;
      if (value > bestValue) {
        bestValue = value;
        bestIndex = index;
      }
    });
    selected.push(remaining.splice(bestIndex, 1)[0]);
  }
  return selected.map((item) => item.model);
}

function rankHomeCandidates(candidates, profile, hasHistory, limit, dailyRanking = []) {
  const maxDownloads = Math.max(...candidates.map((model) => Math.log2(Number(model.downloadCount || 0) + 1)), 1);
  const dailyRank = new Map(dailyRanking.map((model, index) => [String(model._id), 1 - index / Math.max(1, dailyRanking.length)]));
  const preferenceScores = candidates.map((model) => profileScore(profile, model));
  const maxPreference = Math.max(...preferenceScores, 1);
  const scored = candidates.map((model, index) => {
    const preference = preferenceScores[index] / maxPreference;
    const popularity = Math.log2(Number(model.downloadCount || 0) + 1) / maxDownloads;
    const interactions = Number(model.behaviorMetrics?.clicks || 0)
      + Number(model.behaviorMetrics?.detailViews || 0);
    const conversions = Number(model.behaviorMetrics?.downloads || 0);
    const quality = Math.min(1, (conversions + 1) / (interactions + 8));
    const freshness = recency(model);
    return {
      model,
      score: hasHistory
        ? preference * 55
          + Number(dailyRank.get(String(model._id)) || 0) * 25
          + quality * 10
          + freshness * 10
        : popularity * 65 + freshness * 35,
    };
  }).sort((left, right) => right.score - left.score || String(left.model._id).localeCompare(String(right.model._id)));
  return diversify(scored, limit);
}

async function candidatesFor(assetType, excludedIds) {
  const models = await MarketplaceModel.find({
    assetType,
    ...(assetType === "model" ? { accessType: "member" } : {}),
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    ...marketplacePublicDeletionQuery(),
    ...(excludedIds.size ? { _id: { $nin: [...excludedIds] } } : {}),
  })
    .sort(assetType === "model"
      ? { sourceAssetIdSort: -1, createdAt: -1, _id: -1 }
      : { downloadCount: -1, createdAt: -1 })
    .limit(240)
    .lean();
  await hydrateMarketplaceCategoryRefs(models);
  return models;
}

function latestSourceIdModels(candidates, limit) {
  return [...candidates]
    .sort((left, right) => (
      Number(right.sourceAssetIdSort || marketplaceSourceIdNumber(
        right.source?.assetId || right.metadataSourceModelId || right.source?.modelId,
      ))
      - Number(left.sourceAssetIdSort || marketplaceSourceIdNumber(
        left.source?.assetId || left.metadataSourceModelId || left.source?.modelId,
      ))
      || new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
      || String(right._id).localeCompare(String(left._id))
    ))
    .slice(0, limit);
}

function vietnamDayRange(now = new Date()) {
  const offsetMs = 7 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const start = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  ) - offsetMs);
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

async function popularModelsToday(excludedIds, limit) {
  const { start, end } = vietnamDayRange();
  const dayKey = start.toISOString();
  if (
    !dailyPopularCache
    || dailyPopularCache.dayKey !== dayKey
    || dailyPopularCache.expiresAt <= Date.now()
  ) {
    const downloads = await ModelDownload.find({
      assetType: "model",
      status: "downloaded",
      downloadedAt: { $gte: start, $lt: end },
    })
      .select("modelId")
      .lean();
    const counts = new Map();
    downloads.forEach((download) => {
      const modelId = String(download.modelId?._id || download.modelId || "");
      if (!modelId) return;
      counts.set(modelId, (counts.get(modelId) || 0) + 1);
    });
    dailyPopularCache = {
      dayKey,
      expiresAt: Date.now() + DAILY_POPULAR_CACHE_TTL_MS,
      ranking: [...counts]
        .sort((left, right) => right[1] - left[1] || right[0].localeCompare(left[0])),
    };
  }
  const ranking = dailyPopularCache.ranking
    .filter(([modelId]) => !excludedIds.has(modelId));
  const counts = new Map(ranking);
  const rankedIds = ranking
    .slice(0, Math.max(limit * 20, 120))
    .map(([modelId]) => modelId);
  if (!rankedIds.length) return [];

  const models = await MarketplaceModel.find({
    _id: { $in: rankedIds },
    assetType: "model",
    accessType: "member",
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    ...marketplacePublicDeletionQuery(),
  }).lean();
  await hydrateMarketplaceCategoryRefs(models);
  return models.sort((left, right) => (
    (counts.get(String(right._id)) || 0) - (counts.get(String(left._id)) || 0)
    || Number(right.sourceAssetIdSort || 0) - Number(left.sourceAssetIdSort || 0)
    || String(right._id).localeCompare(String(left._id))
  ));
}

function mergeHomeModels(popular, latest, limit) {
  const seen = new Set();
  return [...popular, ...latest].filter((model) => {
    const id = String(model._id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, limit);
}

function mergeBehaviorProfile(profile, storedProfile) {
  for (const [key, amount] of Object.entries(storedProfile?.weights || {})) {
    const [facet, ...valueParts] = String(key).split(":");
    const value = valueParts.join(":");
    if (!profile[facet] || !value) continue;
    increment(profile[facet], value, Number(amount || 0));
  }
  return profile;
}

function profileHasSignals(profile) {
  return Object.values(profile).some((weights) => weights instanceof Map && weights.size > 0);
}

export async function marketplaceHomeRecommendations({ userId = null, actorKey = "", limit = 6 } = {}) {
  const safeLimit = Math.min(12, Math.max(1, Number(limit || 6)));
  const key = cacheKey(userId || actorKey);
  const cached = cache.get(key);
  if (cached?.expiresAt > Date.now() && cached.limit >= safeLimit) {
    return {
      ...cached.value,
      models: cached.value.models.slice(0, safeLimit),
      scenes: cached.value.scenes.slice(0, safeLimit),
    };
  }

  let downloads = [];
  if (userId) {
    downloads = await ModelDownload.find({
      userId,
      status: "downloaded",
      downloadedAt: { $gte: new Date(Date.now() - HISTORY_DAYS * 86_400_000) },
    })
      .sort({ downloadedAt: -1 })
      .limit(HISTORY_LIMIT)
      .lean();
  }
  const storedProfile = actorKey
    ? await MarketplaceInterestProfile.findOne({ actorKey }).lean()
    : null;
  const downloadedIds = new Set(
    downloads.map((item) => String(item.modelId?._id || item.modelId)).filter(Boolean),
  );
  const historyIds = new Set([
    ...downloadedIds,
    ...(storedProfile?.recentAssetIds || []).map(String),
  ]);
  const historyModels = historyIds.size
    ? await MarketplaceModel.find({ _id: { $in: [...historyIds] } }).lean()
    : [];
  const profile = mergeBehaviorProfile(preferenceProfile(historyModels, downloads), storedProfile);
  const hasHistory = historyModels.length > 0 || Number(storedProfile?.eventCount || 0) > 0;
  const hasPreference = hasHistory && profileHasSignals(profile);
  const noModelExclusions = new Set();
  const [modelCandidates, sceneCandidates, popularModels] = await Promise.all([
    candidatesFor("model", noModelExclusions),
    candidatesFor("scene", downloadedIds),
    popularModelsToday(noModelExclusions, safeLimit),
  ]);
  const value = {
    engine: "catalog_behavior_v3",
    mode: hasPreference ? "personalized" : "trending",
    models: hasPreference
      ? rankHomeCandidates(modelCandidates, profile, true, safeLimit, popularModels)
      : mergeHomeModels(
        popularModels,
        latestSourceIdModels(modelCandidates, safeLimit),
        safeLimit,
      ),
    scenes: rankHomeCandidates(sceneCandidates, profile, hasPreference, safeLimit),
  };
  cache.delete(key);
  cache.set(key, { value, limit: safeLimit, expiresAt: Date.now() + CACHE_TTL_MS });
  pruneCache();
  return value;
}
