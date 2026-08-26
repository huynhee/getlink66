import crypto from "node:crypto";
import MarketplaceModel from "../models/MarketplaceModel.js";
import DailyImageSearchQuota from "../models/DailyImageSearchQuota.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { marketplaceAssetTypeFilter, marketplaceDownloadCost, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { isSafeId } from "../utils/validators.js";
import {
  createMarketplaceDownloadSession,
  finalizeMarketplaceDownloadBilling,
  getMarketplaceDownloadOptions,
  markMarketplaceDownloadRedeemed,
  nextVietnamReset,
  vietnamDayKey,
  verifyDownloadSession,
} from "../utils/marketplaceDownloadService.js";
import { isProActive } from "../utils/membershipService.js";
import {
  getStorageBrowserDownloadLink,
  openGoogleDriveFileStream,
  openStorageStream,
} from "../utils/storageProvider.js";
import { marketplaceTurnstileConfig, verifyMarketplaceTurnstile } from "../utils/turnstile.js";
import { searchMarketplaceImage } from "../utils/marketplaceImageSearchProvider.js";
import { marketplaceHomeRecommendations } from "../utils/marketplaceRecommendationService.js";
import { getMarketplaceRecommendationsV3 } from "../utils/marketplaceRecommendationV3.js";
import { marketplaceActorKeyFromRequest } from "../utils/marketplaceBehaviorService.js";
import {
  hydrateMarketplaceCategoryRefs,
  marketplaceCategorySnapshot,
  marketplaceFilterSnapshot,
} from "../utils/marketplaceTaxonomy.js";
import {
  marketplaceSortSelection,
  marketplaceSortSpec,
} from "../utils/marketplaceSort.js";
import {
  marketplaceCoverCachePublicUrl,
  openMarketplaceCoverCache,
} from "../utils/marketplaceCoverCache.js";
import {
  buildMarketplaceSearchDocument,
  marketplaceSearchCandidatePrefixes,
  marketplaceSearchMatches,
  marketplaceSearchQuery,
  marketplaceSearchScore,
  marketplaceSearchTokens,
} from "../utils/marketplaceSearch.js";
import { marketplacePublicDeletionQuery } from "../utils/marketplaceDeletionService.js";
import {
  marketplaceRankingMetadata,
  shouldPrioritizeMarketplaceModelPro,
} from "../utils/marketplaceAccessRanking.js";
import {
  marketplaceMeiliTrafficDecision,
  marketplaceMeiliSuggestions,
  marketplaceSearchQueryId,
  resolveMarketplaceMeiliCategoryKeys,
  searchMarketplaceMeili,
} from "../utils/marketplaceMeilisearch.js";
import {
  popularMarketplaceSearchSuggestions,
  recordMarketplaceSearchQuery,
} from "../utils/marketplaceSearchAnalytics.js";

const PAGE_SIZE = 60;
const IMAGE_SEARCH_FREE_LIMIT = 10;
const IMAGE_SEARCH_PRO_LIMIT = 150;
const MAX_IMAGE_SEARCH_BYTES = 512 * 1024;
const featuredRecommendationTasks = new Map();
const MARKETPLACE_PUBLIC_LIST_FIELDS = [
  "_id",
  "assetType",
  "title",
  "slug",
  "categorySourceId",
  "parentCategorySourceId",
  "coverImage",
  "previewImages",
  "coverCache",
  "styles",
  "renderers",
  "forms",
  "colors",
  "materials",
  "platforms",
  "renderer",
  "accessType",
  "fileStatus",
  "isPublished",
  "fileSize",
  "downloadCount",
  "createdAt",
  "updatedAt",
].join(" ");

export function sendMarketplaceJsonWithEtag(req, res, payload, options = {}) {
  const digest = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const etag = `"sha256:${digest}"`;
  res.setHeader?.("ETag", etag);
  res.setHeader?.(
    "Cache-Control",
    options.private ? "private, no-cache" : "public, max-age=60, must-revalidate",
  );
  if (String(req.headers?.["if-none-match"] || "") === etag) {
    return res.status(304).end();
  }
  return res.json(payload);
}

function requestAssetType(req) {
  return normalizeAssetType(req?.marketplaceAssetType || "model");
}

function assetRouteSegment(assetType) {
  return normalizeAssetType(assetType) === "scene" ? "scenes" : "models";
}

function assetLabel(assetType) {
  return normalizeAssetType(assetType) === "scene" ? "Scene" : "Model";
}

function imageVersion(model) {
  const updatedAt = model?.updatedAt ? new Date(model.updatedAt).getTime() : 0;
  return updatedAt && Number.isFinite(updatedAt) ? updatedAt.toString(36) : "";
}

function versionedImageUrl(path, model) {
  const version = imageVersion(model);
  return version ? `${path}?v=${version}` : path;
}

function previewUrl(model, index) {
  return versionedImageUrl(`/api/marketplace/${assetRouteSegment(model.assetType)}/${model._id}/preview/${index}`, model);
}

function coverUrl(model) {
  return versionedImageUrl(`/api/marketplace/${assetRouteSegment(model.assetType)}/${model._id}/cover`, model);
}

function publicImageRef(model, image, url) {
  if (!image?.driveFileId || !url) return null;
  return {
    url,
    alt: image.alt || model.title || "",
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    size: Number(image.size || 0),
  };
}

function publicCoverImage(model) {
  const image = model.coverImage?.driveFileId
    ? model.coverImage
    : (model.previewImages || []).find((item) => item?.driveFileId);
  if (!image) return null;
  const cachedUrl = marketplaceCoverCachePublicUrl(model);
  const result = publicImageRef(model, image, cachedUrl || coverUrl(model));
  if (cachedUrl && result) {
    result.width = Number(model.coverCache?.width || result.width || 0);
    result.height = Number(model.coverCache?.height || result.height || 0);
    result.size = Number(model.coverCache?.size || result.size || 0);
  }
  return result;
}

function publicPreviewImages(model) {
  return (model.previewImages || [])
    .map((image, index) => {
      return publicImageRef(model, image, previewUrl(model, index));
    })
    .filter(Boolean);
}

function publicCategoryRef(category) {
  if (!category || typeof category !== "object") return null;
  return {
    _id: category._id,
    title: category.title || "",
    titleEn: category.titleEn || category.title || "",
    slug: category.slug || "",
    sourceCategoryId: category.sourceCategoryId || "",
  };
}

function imageContentType(fileName = "", fallback = "") {
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  const error = new Error(`Unsupported marketplace image format${fallback ? ` (${fallback})` : ""}.`);
  error.status = 415;
  error.code = "MARKETPLACE_IMAGE_FORMAT_UNSUPPORTED";
  throw error;
}

function categorySort(a, b) {
  const parentA = a.parentId ? 1 : 0;
  const parentB = b.parentId ? 1 : 0;
  if (parentA !== parentB) return parentA - parentB;
  const byPos = Number(a.position || 0) - Number(b.position || 0);
  if (byPos !== 0) return byPos;
  return String(a.titleEn || a.title || "").localeCompare(String(b.titleEn || b.title || ""));
}

function buildCategoryTree(categories = []) {
  const docs = categories.map((item) => ({ ...item, children: [] }));
  const byId = new Map(docs.map((item) => [String(item._id), item]));
  const roots = [];
  docs.forEach((item) => {
    const parent = item.parentId ? byId.get(String(item.parentId?._id || item.parentId)) : null;
    if (parent) parent.children.push(item);
    else roots.push(item);
  });
  roots.sort(categorySort);
  roots.forEach((root) => root.children.sort(categorySort));
  return roots;
}

function publicModel(model, options = {}) {
  if (!model) return null;
  const includePreviews = options.includePreviews !== false;
  const previewLimit = Math.max(0, Number(options.previewLimit || 0));
  const previewImages = includePreviews ? publicPreviewImages(model) : [];
  return {
    _id: model._id,
    assetType: normalizeAssetType(model.assetType),
    title: model.title || "",
    slug: model.slug || "",
    // Stable taxonomy keys are safe across Atlas and the marketplace VPS.
    categoryId: model.categorySourceId || "",
    parentCategoryId: model.parentCategorySourceId || "",
    category: publicCategoryRef(model.category),
    parentCategory: publicCategoryRef(model.parentCategory),
    categorySourceId: model.categorySourceId || "",
    parentCategorySourceId: model.parentCategorySourceId || "",
    coverImage: publicCoverImage(model),
    previewImages: previewLimit > 0 ? previewImages.slice(0, previewLimit) : previewImages,
    styles: model.styles || [],
    renderers: model.renderers || [],
    forms: model.forms || [],
    colors: model.colors || [],
    materials: model.materials || [],
    platforms: model.platforms || [],
    renderer: model.renderer || "",
    accessType: model.accessType || "member",
    fileStatus: model.fileStatus || "missing",
    isPublished: Boolean(model.isPublished),
    fileSize: Number(model.fileSize || 0),
    downloadCount: Number(model.downloadCount || 0),
    quotaCost: marketplaceDownloadCost(model.assetType),
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

async function recommendedModelsFor(model, options = {}) {
  if (!model?._id) return { models: [], total: 0, engine: "catalog_behavior_v2" };
  const result = await getMarketplaceRecommendationsV3(model, options);
  return {
    models: result.models.map((item) => publicModel(item, { previewLimit: 1 })),
    total: result.total,
    engine: result.engine,
    cached: result.cached,
  };
}

export async function listMarketplaceHomeRecommendations(req, res, next) {
  try {
    const limit = Math.min(12, Math.max(1, Number(req.query.limit || 6)));
    const result = await marketplaceHomeRecommendations({
      userId: req.user?._id || null,
      actorKey: marketplaceActorKeyFromRequest(req),
      limit,
    });
    res.json({
      engine: result.engine,
      mode: result.mode,
      models: result.models.map((model) => publicModel(model, { includePreviews: false })),
      scenes: result.scenes.map((scene) => publicModel(scene, { includePreviews: false })),
    });
  } catch (error) {
    next(error);
  }
}

export async function listMarketplaceCategories(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const categories = await marketplaceCategorySnapshot(assetType);
    res.json({ categories: buildCategoryTree(categories), flat: categories.sort(categorySort) });
  } catch (error) {
    next(error);
  }
}

export async function listMarketplaceFilters(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const filters = await marketplaceFilterSnapshot(assetType);
    res.json({ assetType, filters });
  } catch (error) {
    next(error);
  }
}

async function categoryFilter(categoryValue, assetType = "model") {
  const value = String(categoryValue || "").trim();
  if (!value) return {};
  const categories = await marketplaceCategorySnapshot(assetType);
  const category = categories.find((item) => (
    String(item.slug || "").toLowerCase() === value.toLowerCase()
    || String(item.sourceCategoryId || "") === value
    || (isSafeId(value) && String(item._id) === value)
  ));
  if (!category) return { _id: { $exists: false } };
  const sourceCategoryId = String(category.sourceCategoryId || "");
  const byId = new Map(categories.map((item) => [String(item._id), item]));
  const descendants = [];
  const pending = [sourceCategoryId];
  const visited = new Set([sourceCategoryId]);
  while (pending.length) {
    const parentSourceId = pending.shift();
    const children = categories.filter((item) => {
      const resolvedParentSourceId = String(
        item.parentSourceCategoryId || byId.get(String(item.parentId || ""))?.sourceCategoryId || "",
      );
      return resolvedParentSourceId === parentSourceId;
    });
    children.forEach((child) => {
      const childSourceId = String(child.sourceCategoryId || "");
      if (!childSourceId || visited.has(childSourceId)) return;
      visited.add(childSourceId);
      descendants.push(child);
      pending.push(childSourceId);
    });
  }
  const descendantSourceIds = descendants.map((item) => String(item.sourceCategoryId || "")).filter(Boolean);
  const descendantObjectIds = descendants.map((item) => item._id).filter(Boolean);
  return descendants.length
    ? {
        $or: [
          { categorySourceId: { $in: descendantSourceIds } },
          // Read-only compatibility until the split-database migration has
          // backfilled and removed legacy category ObjectIds.
          { categoryId: { $in: descendantObjectIds } },
        ],
      }
    : { $or: [{ categorySourceId: sourceCategoryId }, { categoryId: category._id }] };
}

function accessTypeFilter(accessType) {
  const value = String(accessType || "").trim().toLowerCase();
  if (value === "free") return { accessType: "free" };
  if (value === "pro" || value === "member") return { accessType: "member" };
  return {};
}

function addNestedFilter(query, nestedFilter) {
  if (!nestedFilter || !Object.keys(nestedFilter).length) return;
  if (nestedFilter.$or || nestedFilter.$and) {
    query.$and = [...(query.$and || []), nestedFilter];
    return;
  }
  Object.assign(query, nestedFilter);
}

function normalizeFacetValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/v-ray/g, "vray")
    .replace(/^\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseFacetValues(value) {
  const rawItems = Array.isArray(value)
    ? value.flatMap((item) => String(item || "").split(","))
    : String(value || "").split(",");
  return [...new Set(rawItems.map(normalizeFacetValue).filter(Boolean))].slice(0, 24);
}

function addFacetFilter(query, field, values) {
  if (values.length) addNestedFilter(query, { [field]: { $in: values } });
}

function addLegacyFacetFilter(query, field, legacyField, values) {
  if (!values.length) return;
  const regexes = values.map((value) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  addNestedFilter(query, {
    $or: [
      { [field]: { $in: values } },
      ...regexes.map((regex) => ({ [legacyField]: regex })),
    ],
  });
}

function applyMarketplaceFacetFilters(query, source = {}, assetType = "model") {
  addFacetFilter(query, "styles", parseFacetValues(source.style || source.styles));
  addLegacyFacetFilter(query, "renderers", "renderer", parseFacetValues(source.render || source.renderers));
  if (normalizeAssetType(assetType) === "scene") {
    addFacetFilter(query, "platforms", parseFacetValues(source.platform || source.platforms));
    return;
  }
  addFacetFilter(query, "forms", parseFacetValues(source.form || source.forms));
  addFacetFilter(query, "colors", parseFacetValues(source.color || source.colors));
  addFacetFilter(query, "materials", parseFacetValues(source.material || source.materials));
}

function compareMarketplaceValue(left, right, field) {
  const a = left?.[field];
  const b = right?.[field];
  if (a === b) return 0;
  if (a === undefined || a === null || a === "") return -1;
  if (b === undefined || b === null || b === "") return 1;
  if (field.endsWith("At")) return new Date(a).getTime() - new Date(b).getTime();
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

function marketplaceAccessPriority(model) {
  return String(model?.accessType || "member") === "member" ? 1 : 0;
}

function sortMarketplaceDocuments(models, effectiveSort, search = "", prioritizePro = false) {
  const compareAccess = (left, right) => prioritizePro
    ? marketplaceAccessPriority(right) - marketplaceAccessPriority(left)
    : 0;
  if (effectiveSort === "relevance") {
    return [...models].sort((left, right) => (
      compareAccess(left, right)
      || marketplaceSearchScore(right, search) - marketplaceSearchScore(left, search)
      || Number(right.downloadCount || 0) - Number(left.downloadCount || 0)
      || new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
      || String(left._id).localeCompare(String(right._id))
    ));
  }
  const sortSpec = marketplaceSortSpec(effectiveSort);
  return [...models].sort((left, right) => {
    const accessCompared = compareAccess(left, right);
    if (accessCompared) return accessCompared;
    for (const [field, direction] of Object.entries(sortSpec)) {
      const compared = compareMarketplaceValue(left, right, field);
      if (compared) return direction < 0 ? -compared : compared;
    }
    return 0;
  });
}

function escapeSearchRegex(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMarketplaceCatalogSearch(value = "", assetType = "model") {
  const raw = String(value || "").trim().slice(0, 2_048);
  if (!/^https?:\/\//i.test(raw)) {
    return { search: raw.slice(0, 120), externalUrl: false };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { search: raw.slice(0, 120), externalUrl: false };
  }

  const allowedHosts = new Set(["3dipl.org", "www.3dipl.org"]);
  for (const configuredUrl of [process.env.PUBLIC_BASE_URL, process.env.CLIENT_URL]) {
    try {
      if (configuredUrl) allowedHosts.add(new URL(configuredUrl).hostname.toLowerCase());
    } catch {
      // Optional public URL configuration must not break catalog search.
    }
  }
  if (!allowedHosts.has(parsed.hostname.toLowerCase())) {
    return { search: "", externalUrl: true };
  }

  const route = normalizeAssetType(assetType) === "scene" ? "scenes" : "models";
  const match = parsed.pathname.match(new RegExp(`^/${route}/([^/]+)/?$`, "i"));
  if (!match) return { search: "", externalUrl: true };
  return {
    search: decodeURIComponent(match[1]).replace(/[-_]+/g, " ").trim().slice(0, 120),
    externalUrl: false,
  };
}

function marketplaceFallbackMaxTimeMs() {
  const configured = Number(process.env.MARKETPLACE_SEARCH_FALLBACK_MAX_TIME_MS || 1_000);
  const resolved = Number.isFinite(configured) ? configured : 1_000;
  return Math.min(5_000, Math.max(100, resolved));
}

function withMarketplaceFallbackBudget(query) {
  return isMemoryDb() ? query : query.maxTimeMS(marketplaceFallbackMaxTimeMs());
}

function exactSearchTokenFilter(search) {
  const tokens = marketplaceSearchTokens(search);
  if (!tokens.length) return {};
  return {
    $and: tokens.map((token) => {
      const boundary = new RegExp(`(^|\\s)${escapeSearchRegex(token)}(?=\\s|$)`, "i");
      return {
        $or: [
          { searchTokens: token },
          { searchTitle: boundary },
          { searchTaxonomy: boundary },
        ],
      };
    }),
  };
}

function fuzzySearchCandidateFilter(search, { broad = false } = {}) {
  const prefixes = marketplaceSearchCandidatePrefixes(search)
    .map((prefix) => broad ? prefix.slice(0, 1) : prefix)
    .filter(Boolean);
  if (!prefixes.length) return {};
  return {
    searchTokens: {
      $in: [...new Set(prefixes)].map((prefix) => new RegExp(`^${escapeSearchRegex(prefix)}`, "i")),
    },
  };
}

function searchCandidateLimit() {
  return Math.min(500, Math.max(100, Number(process.env.MARKETPLACE_SEARCH_FALLBACK_LIMIT || 240)));
}

async function fuzzyMarketplacePage({
  query,
  search,
  sortSelection,
  page,
  limit,
  prioritizePro = false,
}) {
  const candidateLimit = searchCandidateLimit();
  const loadCandidates = async (broad = false) => {
    const candidateQuery = { ...query };
    addNestedFilter(candidateQuery, fuzzySearchCandidateFilter(search, { broad }));
    return withMarketplaceFallbackBudget(MarketplaceModel.find(candidateQuery))
      .sort({ downloadCount: -1, createdAt: -1, _id: 1 })
      .limit(candidateLimit)
      .lean();
  };
  let candidates = await loadCandidates(false);
  if (!candidates.length) candidates = await loadCandidates(true);
  const queryTokens = marketplaceSearchTokens(search);
  const matched = candidates.filter((candidate) => {
    const candidateTokens = [...new Set([
      ...(candidate.searchTokens || []),
      ...marketplaceSearchTokens(candidate.searchTitle || candidate.title || ""),
      ...marketplaceSearchTokens(candidate.searchTaxonomy || ""),
    ])];
    return queryTokens.every((token) => candidateTokens.some((candidateToken) => (
      candidateToken === token || candidateToken.startsWith(token)
    )));
  });
  const sorted = sortMarketplaceDocuments(matched, sortSelection.effective, search, prioritizePro);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  return {
    models: sorted.slice((safePage - 1) * limit, safePage * limit),
    total,
    totalPages,
    safePage,
    engine: "mongo_fallback_v3",
    mode: matched.length ? "prefix" : "no_match",
    truncated: candidates.length >= candidateLimit,
  };
}

async function prioritizedMarketplaceBrowsePage({ query, sortSelection, page, limit }) {
  const memberQuery = { ...query, accessType: "member" };
  const freeQuery = { ...query, accessType: "free" };
  const [memberTotal, freeTotal] = await Promise.all([
    MarketplaceModel.countDocuments(memberQuery),
    MarketplaceModel.countDocuments(freeQuery),
  ]);
  const total = memberTotal + freeTotal;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const offset = (safePage - 1) * limit;
  const sortSpec = marketplaceSortSpec(sortSelection.effective);
  const memberTake = offset < memberTotal ? Math.min(limit, memberTotal - offset) : 0;
  const freeOffset = Math.max(0, offset - memberTotal);
  const freeTake = Math.min(limit - memberTake, Math.max(0, freeTotal - freeOffset));
  const memberPromise = memberTake
    ? MarketplaceModel.find(memberQuery)
      .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
      .sort(sortSpec)
      .skip(offset)
      .limit(memberTake)
      .lean()
    : Promise.resolve([]);
  const freePromise = freeTake
    ? MarketplaceModel.find(freeQuery)
      .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
      .sort(sortSpec)
      .skip(freeOffset)
      .limit(freeTake)
      .lean()
    : Promise.resolve([]);
  const [members, free] = await Promise.all([memberPromise, freePromise]);
  return {
    models: [...members, ...free],
    total,
    totalPages,
    safePage,
    engine: "catalog",
    mode: "browse",
    truncated: false,
  };
}

async function marketplaceBrowseSlice({ query, sortSpec, offset, limit, prioritizePro }) {
  if (limit <= 0) return [];
  if (!prioritizePro) {
    return MarketplaceModel.find(query)
      .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
      .sort(sortSpec)
      .skip(offset)
      .limit(limit)
      .lean();
  }

  const memberQuery = { ...query, accessType: "member" };
  const freeQuery = { ...query, accessType: "free" };
  const memberTotal = await MarketplaceModel.countDocuments(memberQuery);
  const memberTake = offset < memberTotal ? Math.min(limit, memberTotal - offset) : 0;
  const freeOffset = Math.max(0, offset - memberTotal);
  const freeTake = limit - memberTake;
  const [members, free] = await Promise.all([
    memberTake
      ? MarketplaceModel.find(memberQuery)
        .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
        .sort(sortSpec)
        .skip(offset)
        .limit(memberTake)
        .lean()
      : Promise.resolve([]),
    freeTake
      ? MarketplaceModel.find(freeQuery)
        .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
        .sort(sortSpec)
        .skip(freeOffset)
        .limit(freeTake)
        .lean()
      : Promise.resolve([]),
  ]);
  return [...members, ...free];
}

async function featuredMarketplaceBrowsePage({
  query,
  page,
  limit,
  prioritizePro,
  userId,
  actorKey,
}) {
  const recommendationKey = String(userId || actorKey || "guest");
  let recommendationTask = featuredRecommendationTasks.get(recommendationKey);
  if (!recommendationTask) {
    recommendationTask = marketplaceHomeRecommendations({ userId, actorKey, limit: 12 })
      .finally(() => {
        if (featuredRecommendationTasks.get(recommendationKey) === recommendationTask) {
          featuredRecommendationTasks.delete(recommendationKey);
        }
      });
    featuredRecommendationTasks.set(recommendationKey, recommendationTask);
  }
  const recommendationBudgetMs = isMemoryDb()
    ? 5_000
    : Math.min(1_000, Math.max(50, Number(process.env.MARKETPLACE_FEATURED_TIMEOUT_MS || 180)));
  let timeoutId;
  const recommendationsWithinBudget = Promise.race([
    recommendationTask.catch(() => null),
    new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve(null), recommendationBudgetMs);
      timeoutId.unref?.();
    }),
  ]).finally(() => clearTimeout(timeoutId));
  const [total, recommendations] = await Promise.all([
    MarketplaceModel.countDocuments(query),
    recommendationsWithinBudget,
  ]);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const recommendedIds = (recommendations?.models || []).map((model) => model._id).filter(Boolean);
  let pinned = [];
  if (recommendedIds.length) {
    const matching = await MarketplaceModel.find({
      $and: [query, { _id: { $in: recommendedIds } }],
    })
      .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
      .lean();
    const byId = new Map(matching.map((model) => [String(model._id), model]));
    pinned = recommendedIds.map((id) => byId.get(String(id))).filter(Boolean);
  }

  const offset = (safePage - 1) * limit;
  const pinnedPage = offset < pinned.length
    ? pinned.slice(offset, offset + limit)
    : [];
  const remaining = limit - pinnedPage.length;
  const globalOffset = Math.max(0, offset - pinned.length);
  const globalQuery = pinned.length
    ? { $and: [query, { _id: { $nin: pinned.map((model) => model._id) } }] }
    : query;
  const globalModels = await marketplaceBrowseSlice({
    query: globalQuery,
    sortSpec: marketplaceSortSpec("featured"),
    offset: globalOffset,
    limit: remaining,
    prioritizePro,
  });
  return {
    models: [...pinnedPage, ...globalModels],
    total,
    totalPages,
    safePage,
    engine: "catalog_behavior_v3",
    mode: pinned.length ? recommendations.mode : "trending",
    truncated: false,
  };
}

async function bilingualMarketplacePage({
  query,
  search,
  sortSelection,
  page,
  limit,
  prioritizePro = false,
  assetType = "model",
  userId = null,
  actorKey = "",
}) {
  if (!search) {
    if (normalizeAssetType(assetType) === "model" && sortSelection.effective === "featured") {
      return featuredMarketplaceBrowsePage({
        query,
        page,
        limit,
        prioritizePro,
        userId,
        actorKey,
      });
    }
    if (prioritizePro) {
      return prioritizedMarketplaceBrowsePage({ query, sortSelection, page, limit });
    }
    const totalPromise = MarketplaceModel.countDocuments(query);
    const requestedModelsPromise = MarketplaceModel.find(query)
      .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
      .sort(marketplaceSortSpec(sortSelection.effective))
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const [total, requestedModels] = await Promise.all([totalPromise, requestedModelsPromise]);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const models = safePage === page
      ? requestedModels
      : await MarketplaceModel.find(query)
        .select(MARKETPLACE_PUBLIC_LIST_FIELDS)
        .sort(marketplaceSortSpec(sortSelection.effective))
        .skip((safePage - 1) * limit)
        .limit(limit)
        .lean();
    return { models, total, totalPages, safePage, engine: "catalog", mode: "browse", truncated: false };
  }

  if (isMemoryDb()) {
    const candidates = await MarketplaceModel.find(query).lean();
    for (const candidate of candidates) {
      if (!candidate.searchTitle || !candidate.searchTaxonomy) {
        Object.assign(candidate, await buildMarketplaceSearchDocument(candidate));
      }
    }
    const exactMatches = candidates.filter((candidate) => marketplaceSearchMatches(candidate, search, { fuzzy: false }));
    const matched = exactMatches.length
      ? exactMatches
      : candidates.filter((candidate) => marketplaceSearchMatches(candidate, search, { fuzzy: true }));
    const sorted = sortMarketplaceDocuments(matched, sortSelection.effective, search, prioritizePro);
    const total = sorted.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    return {
      models: sorted.slice((safePage - 1) * limit, safePage * limit),
      total,
      totalPages,
      safePage,
      engine: "mongo_hybrid_v3",
      mode: exactMatches.length ? "exact" : "fuzzy",
      truncated: false,
    };
  }

  const enabled = String(process.env.MARKETPLACE_BILINGUAL_SEARCH_ENABLED || "false").toLowerCase() === "true";
  if (enabled) {
    try {
      const textQuery = { ...query, $text: { $search: marketplaceSearchQuery(search) } };
      addNestedFilter(textQuery, exactSearchTokenFilter(search));
      const total = await withMarketplaceFallbackBudget(MarketplaceModel.countDocuments(textQuery));
      if (total > 0) {
        const relevance = sortSelection.effective === "relevance";
        const projection = relevance ? { relevance: { $meta: "textScore" } } : undefined;
        const sortSpec = relevance
          ? { ...(prioritizePro ? { accessType: -1 } : {}), relevance: { $meta: "textScore" }, downloadCount: -1, createdAt: -1, _id: 1 }
          : { ...(prioritizePro ? { accessType: -1 } : {}), ...marketplaceSortSpec(sortSelection.effective) };
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const models = await withMarketplaceFallbackBudget(MarketplaceModel.find(textQuery, projection))
          .sort(sortSpec)
          .skip((safePage - 1) * limit)
          .limit(limit)
          .lean();
        return {
          models,
          total,
          totalPages,
          safePage,
          engine: "mongo_hybrid_v3",
          mode: "exact",
          truncated: false,
        };
      }
    } catch {
      // Token candidates keep the catalog usable while a deployment is rebuilding the text index.
    }
  }

  return fuzzyMarketplacePage({
    query,
    search,
    sortSelection,
    page,
    limit,
    prioritizePro,
  });
}

export async function listMarketplaceModels(req, res, next) {
  try {
    const startedAt = performance.now();
    const assetType = requestAssetType(req);
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit || PAGE_SIZE)));
    const searchInput = normalizeMarketplaceCatalogSearch(
      req.query.q || req.query.search || "",
      assetType,
    );
    const search = searchInput.search;
    const sortSelection = marketplaceSortSelection(
      req.query.sort,
      Boolean(search || searchInput.externalUrl),
    );
    const accessType = String(req.query.accessType || "").trim();
    const prioritizePro = shouldPrioritizeMarketplaceModelPro(assetType, accessType);
    if (searchInput.externalUrl) {
      const queryId = marketplaceSearchQueryId("external-url", {
        assetType,
        accessType,
        sort: sortSelection.effective,
      });
      const assets = [];
      return sendMarketplaceJsonWithEtag(req, res, {
        assetType,
        assets,
        ...(assetType === "scene" ? { scenes: assets } : { models: assets }),
        pagination: { page: 1, pageSize: limit, total: 0, totalPages: 1 },
        search: {
          engine: "input_guard_v1",
          mode: "external_url",
          truncated: false,
          queryId,
          timingMs: Math.round((performance.now() - startedAt) * 10) / 10,
          correctedQuery: "",
        },
        sort: sortSelection,
        ranking: marketplaceRankingMetadata({ applied: prioritizePro, accessType }),
      });
    }
    const fileStatus = String(req.query.fileStatus || "").trim();
    const query = { assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() };
    Object.assign(query, accessTypeFilter(accessType));
    applyMarketplaceFacetFilters(query, req.query, assetType);
    if (["missing", "pending_upload", "ready", "failed"].includes(fileStatus)) query.fileStatus = fileStatus;
    const categoryQuery = await categoryFilter(req.query.category, assetType);
    addNestedFilter(query, categoryQuery);
    const meiliAccessType = accessType.toLowerCase() === "free"
      ? "free"
      : (["pro", "member"].includes(accessType.toLowerCase()) ? "member" : "");
    const meiliFacets = {
      styles: parseFacetValues(req.query.style || req.query.styles),
      renderers: parseFacetValues(req.query.render || req.query.renderers),
      ...(assetType === "scene" ? {
        platforms: parseFacetValues(req.query.platform || req.query.platforms),
      } : {}),
      ...(assetType === "model" ? {
        forms: parseFacetValues(req.query.form || req.query.forms),
        colors: parseFacetValues(req.query.color || req.query.colors),
        materials: parseFacetValues(req.query.material || req.query.materials),
      } : {}),
    };
    const categoryKeys = await resolveMarketplaceMeiliCategoryKeys(req.query.category, assetType);
    const queryId = marketplaceSearchQueryId(search, {
      assetType,
      accessType: meiliAccessType,
      categoryKeys,
      facets: meiliFacets,
      sort: sortSelection.effective,
    });
    const meiliOptions = {
      assetType,
      q: search,
      accessType: meiliAccessType,
      categoryKeys,
      facets: meiliFacets,
      sort: sortSelection.effective,
      page,
      limit,
      prioritizePro,
    };
    const trafficSeed = marketplaceActorKeyFromRequest(req)
      || `${req.ip || ""}|${req.get?.("user-agent") || ""}|${queryId}`;
    const traffic = marketplaceMeiliTrafficDecision(trafficSeed);
    const personalizedFeatured = assetType === "model"
      && !search
      && sortSelection.effective === "featured";
    if (traffic.shadow && !personalizedFeatured) {
      searchMarketplaceMeili(meiliOptions).catch(() => {});
    }
    if (traffic.useMeili && !personalizedFeatured) {
      try {
        const meili = await searchMarketplaceMeili({
          ...meiliOptions,
        });
        if (meili) {
          if (search.length >= 2) {
            recordMarketplaceSearchQuery({
              assetType,
              query: search,
              resultCount: meili.total,
              timingMs: meili.timingMs,
              engine: meili.engine,
            }).catch(() => {});
          }
          return sendMarketplaceJsonWithEtag(req, res, {
            assetType,
            assets: meili.assets,
            ...(assetType === "scene" ? { scenes: meili.assets } : { models: meili.assets }),
            pagination: {
              page: meili.safePage,
              pageSize: limit,
              total: meili.total,
              totalPages: meili.totalPages,
            },
            search: {
              engine: meili.engine,
              mode: meili.mode,
              truncated: false,
              queryId,
              timingMs: meili.timingMs,
              processingTimeMs: meili.processingTimeMs,
              correctedQuery: meili.correctedQuery,
            },
            sort: sortSelection,
            ranking: marketplaceRankingMetadata({ applied: prioritizePro, accessType }),
          });
        }
      } catch {
        // The bounded Mongo path below keeps the catalog available while the
        // Meilisearch circuit breaker is open.
      }
    }
    const { models, total, totalPages, safePage, engine, mode, truncated } = await bilingualMarketplacePage({
      query,
      search,
      sortSelection,
      page,
      limit,
      prioritizePro,
      assetType,
      userId: req.user?._id || null,
      actorKey: marketplaceActorKeyFromRequest(req),
    });
    await hydrateMarketplaceCategoryRefs(models);
    const assets = models.map((model) => publicModel(model, { previewLimit: 1 }));
    const fallbackTimingMs = Math.round((performance.now() - startedAt) * 10) / 10;
    if (search.length >= 2) {
      recordMarketplaceSearchQuery({
        assetType,
        query: search,
        resultCount: total,
        timingMs: fallbackTimingMs,
        engine,
      }).catch(() => {});
    }
    return sendMarketplaceJsonWithEtag(req, res, {
      assetType,
      assets,
      ...(assetType === "scene" ? { scenes: assets } : { models: assets }),
      pagination: { page: safePage, pageSize: limit, total, totalPages },
      search: {
        engine,
        mode,
        truncated: Boolean(truncated),
        queryId,
        timingMs: fallbackTimingMs,
        correctedQuery: "",
      },
      sort: {
        ...sortSelection,
        ...(sortSelection.effective === "featured" ? { mode } : {}),
      },
      ranking: marketplaceRankingMetadata({ applied: prioritizePro, accessType }),
    }, { private: personalizedFeatured });
  } catch (error) {
    next(error);
  }
}

export async function listMarketplaceSearchSuggestions(req, res, next) {
  try {
    const assetType = normalizeAssetType(req.query.assetType || requestAssetType(req));
    const q = String(req.query.q || "").trim().slice(0, 120);
    const limit = Math.min(8, Math.max(1, Number(req.query.limit || 8)));
    if (q.length < 2) return res.json({ suggestions: [], engine: "none" });
    try {
      const [suggestions, popular] = await Promise.all([
        marketplaceMeiliSuggestions({ assetType, q, limit }),
        popularMarketplaceSearchSuggestions({ assetType, query: q, limit: 3 }),
      ]);
      if (suggestions) {
        const combined = [...popular, ...suggestions]
          .filter((item, index, items) => items.findIndex((entry) => entry.value.toLowerCase() === item.value.toLowerCase()) === index)
          .slice(0, limit);
        return res.json({ suggestions: combined, engine: "meilisearch_v3" });
      }
    } catch {
      // Continue with the small Mongo prefix fallback.
    }
    const normalized = marketplaceSearchQuery(q);
    const models = await MarketplaceModel.find({
      assetType: marketplaceAssetTypeFilter(assetType),
      isPublished: true,
      metadataStatus: "complete",
      fileStatus: "ready",
      ...marketplacePublicDeletionQuery(),
      $or: [
        { title: new RegExp(`^${escapeSearchRegex(q)}`, "i") },
        { searchTokens: new RegExp(`^${escapeSearchRegex(normalized)}`, "i") },
      ],
    })
      .select("title slug assetType")
      .sort({ downloadCount: -1, sourceAssetIdSort: -1 })
      .limit(limit)
      .lean();
    return res.json({
      engine: "mongo_prefix_fallback",
      suggestions: models.map((model) => ({
        type: "asset",
        value: model.title,
        label: model.title,
        slug: model.slug,
        assetType: normalizeAssetType(model.assetType),
      })),
    });
  } catch (error) {
    return next(error);
  }
}

function imageSearchTier(req) {
  if (req.user?.role === "admin") return "admin";
  if (!req.user) {
    const error = new Error("Login is required to search by image.");
    error.status = 401;
    throw error;
  }
  return isProActive(req.user) ? "member" : "free";
}

function imageSearchLimit(tier) {
  if (tier === "admin") return Number.MAX_SAFE_INTEGER;
  return tier === "member" ? IMAGE_SEARCH_PRO_LIMIT : IMAGE_SEARCH_FREE_LIMIT;
}

function parseImageSearchPayload(body = {}) {
  const imageData = String(body.imageData || "");
  const match = imageData.match(/^data:image\/(png|jpe?g|webp);base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) {
    const error = new Error("Invalid image payload.");
    error.status = 400;
    throw error;
  }
  const imageBuffer = Buffer.from(match[2], "base64");
  if (!imageBuffer.length || imageBuffer.length > MAX_IMAGE_SEARCH_BYTES) {
    const error = new Error("Image search file is too large.");
    error.status = 413;
    throw error;
  }
  return {
    mimeType: `image/${match[1] === "jpg" ? "jpeg" : match[1]}`,
    byteLength: imageBuffer.length,
    imageHash: crypto.createHash("sha256").update(imageBuffer).digest("hex"),
    imageData,
  };
}

async function assertImageSearchQuotaAvailable(req, tier) {
  const limit = imageSearchLimit(tier);
  if (tier === "admin") return;
  const current = await DailyImageSearchQuota.findOne({
    dayKey: vietnamDayKey(),
    userId: req.user._id,
    tier,
  });
  if (current && Number(current.count || 0) >= limit) {
    const error = new Error(`Daily image search quota exceeded for ${tier}.`);
    error.status = 429;
    error.details = { limit, resetAt: nextVietnamReset() };
    throw error;
  }
}

async function chargeImageSearchQuota(req, tier, imageHash) {
  const limit = imageSearchLimit(tier);
  if (tier === "admin") return { limit, remaining: limit, resetAt: nextVietnamReset() };

  const dayKey = vietnamDayKey();
  const resetAt = nextVietnamReset();
  const query = { dayKey, userId: req.user._id, tier };
  const current = await DailyImageSearchQuota.findOne(query);
  if (current && Number(current.count || 0) >= limit) {
    const error = new Error(`Daily image search quota exceeded for ${tier}.`);
    error.status = 429;
    error.details = { limit, resetAt };
    throw error;
  }

  const quota = await DailyImageSearchQuota.findOneAndUpdate(
    query,
    {
      $setOnInsert: { ...query, resetAt },
      $set: { lastImageHash: imageHash },
      $inc: { count: 1 },
    },
    { upsert: true, new: true },
  );

  if (!quota || Number(quota.count || 0) > limit) {
    if (quota?._id && Number(quota.count || 0) > limit) {
      await DailyImageSearchQuota.findByIdAndUpdate(quota._id, { $inc: { count: -1 } }).catch(() => {});
    }
    const error = new Error(`Daily image search quota exceeded for ${tier}.`);
    error.status = 429;
    error.details = { limit, resetAt };
    throw error;
  }

  return {
    limit,
    remaining: Math.max(0, limit - Number(quota.count || 0)),
    resetAt,
  };
}

export async function searchMarketplaceByImage(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const tier = imageSearchTier(req);
    const image = parseImageSearchPayload(req.body);
    const requestedLimit = Number(req.body.limit || PAGE_SIZE);
    const limit = Math.min(60, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : PAGE_SIZE));
    const accessType = String(req.body.accessType || "").trim();
    const prioritizePro = shouldPrioritizeMarketplaceModelPro(assetType, accessType);
    const providerLimit = prioritizePro ? Math.min(300, Math.max(limit, limit * 3)) : limit;
    await assertImageSearchQuotaAvailable(req, tier);
    const searchResult = await searchMarketplaceImage({
      imageData: image.imageData,
      imageHash: image.imageHash,
      limit: providerLimit,
      assetType,
    });
    const matchedIds = searchResult.matches.map((match) => match.modelId);
    const query = { assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() };

    Object.assign(query, accessTypeFilter(accessType));
    applyMarketplaceFacetFilters(query, req.body, assetType);
    addNestedFilter(query, await categoryFilter(req.body.category, assetType));
    if (matchedIds.length) {
      const identityFilters = [
        { "source.modelId": { $in: matchedIds } },
        { "source.assetId": { $in: matchedIds } },
        { slug: { $in: matchedIds } },
      ];
      const databaseIds = matchedIds.filter((id) => isSafeId(id));
      if (databaseIds.length) identityFilters.push({ _id: { $in: databaseIds } });
      query.$and = [...(query.$and || []), { $or: identityFilters }];
    }

    const models = matchedIds.length
      ? await MarketplaceModel.find(query)
          .limit(providerLimit)
          .lean()
      : [];
    await hydrateMarketplaceCategoryRefs(models);
    const ranks = new Map(searchResult.matches.map((match, index) => [match.modelId, { index, score: match.score }]));
    function modelRank(model) {
      const candidates = [String(model?.source?.assetId || ""), String(model?.source?.modelId || ""), String(model?.slug || ""), String(model?._id || "")];
      for (const candidate of candidates) {
        if (ranks.has(candidate)) return ranks.get(candidate);
      }
      return { index: Number.MAX_SAFE_INTEGER, score: 0 };
    }
    models.sort((left, right) => (
      (prioritizePro ? marketplaceAccessPriority(right) - marketplaceAccessPriority(left) : 0)
      || modelRank(left).index - modelRank(right).index
    ));
    const visibleModels = models.slice(0, limit);
    const quota = await chargeImageSearchQuota(req, tier, image.imageHash);

    const assets = visibleModels.map((model) => ({
        ...publicModel(model, { previewLimit: 1 }),
        imageSearchScore: modelRank(model).score,
      }));
    res.json({
      assetType,
      assets,
      ...(assetType === "scene" ? { scenes: assets } : { models: assets }),
      pagination: { page: 1, pageSize: limit, total: visibleModels.length, totalPages: 1 },
      ranking: marketplaceRankingMetadata({ applied: prioritizePro, accessType }),
      imageSearch: {
        tier: tier === "member" ? "pro" : tier,
        limit: quota.limit,
        remaining: quota.remaining,
        resetAt: quota.resetAt,
        imageHash: image.imageHash.slice(0, 12),
        byteLength: image.byteLength,
        mode: searchResult.provider,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getMarketplaceModel(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const slugOrId = String(req.params.slug || "").trim();
    const assetFilter = marketplaceAssetTypeFilter(assetType);
    const lookup = [{ assetType: assetFilter, slug: slugOrId.toLowerCase(), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() }];
    if (isSafeId(slugOrId)) lookup.push({ assetType: assetFilter, _id: slugOrId, isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() });
    const model = await MarketplaceModel.findOne({ $or: lookup }).lean();
    if (!model) return res.status(404).json({ message: `${assetLabel(assetType)} not found` });
    await hydrateMarketplaceCategoryRefs(model);
    const includeRecommendations = String(req.query?.includeRecommendations ?? "true").toLowerCase() !== "false";
    const recommendations = includeRecommendations
      ? await recommendedModelsFor(model, { limit: 6, userId: req.user?._id || null })
      : null;
    return sendMarketplaceJsonWithEtag(req, res, {
      asset: publicModel(model),
      ...(assetType === "scene" ? { scene: publicModel(model) } : { model: publicModel(model) }),
      downloadProtection: marketplaceTurnstileConfig(),
      recommendedModels: recommendations?.models || [],
      recommendations: {
        total: recommendations?.total || 0,
        hasMore: recommendations ? recommendations.total > recommendations.models.length : false,
        engine: recommendations?.engine || "catalog_behavior_v2",
        deferred: !includeRecommendations,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function listMarketplaceModelRecommendations(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const slugOrId = String(req.params.slug || "").trim();
    const assetFilter = marketplaceAssetTypeFilter(assetType);
    const lookup = [{ assetType: assetFilter, slug: slugOrId.toLowerCase(), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() }];
    if (isSafeId(slugOrId)) lookup.push({ assetType: assetFilter, _id: slugOrId, isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() });
    const model = await MarketplaceModel.findOne({ $or: lookup }).lean();
    if (!model) return res.status(404).json({ message: `${assetLabel(assetType)} not found` });
    const offset = Math.min(59, Math.max(0, Number(req.query.offset || 6)));
    const limit = Math.min(54, Math.max(1, Number(req.query.limit || 54)));
    const recommendations = await recommendedModelsFor(model, {
      offset,
      limit,
      userId: req.user?._id || null,
    });
    return sendMarketplaceJsonWithEtag(req, res, {
      assets: recommendations.models,
      ...(assetType === "scene" ? { scenes: recommendations.models } : { models: recommendations.models }),
      pagination: {
        offset,
        limit,
        total: recommendations.total,
        hasMore: offset + recommendations.models.length < recommendations.total,
      },
      discovery: { engine: recommendations.engine },
    });
  } catch (error) {
    next(error);
  }
}

function streamImageRef(res, next, image, defaultFileName) {
  let contentType;
  try {
    contentType = imageContentType(image.fileName || defaultFileName);
  } catch (error) {
    return Promise.reject(error).catch(next);
  }
  const openStream = openGoogleDriveFileStream(image.driveFileId, image.fileName || defaultFileName);
  return openStream.then((file) => {
    const etag = crypto.createHash("sha1").update(String(image.driveFileId || "")).digest("hex");
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("etag", `"${etag}"`);
    res.setHeader("cross-origin-resource-policy", "cross-origin");
    res.setHeader("content-type", contentType);
    if (file.contentLength || image.size) res.setHeader("content-length", file.contentLength || image.size);
    file.stream.on("error", next);
    file.stream.pipe(res);
  });
}

export async function streamMarketplaceCover(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: `Invalid ${assetLabel(assetType).toLowerCase()} id` });
    }
    const model = await MarketplaceModel.findOne({ _id: req.params.id, assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() })
      .select("title coverImage previewImages coverCache")
      .lean();
    if (!model) return res.status(404).json({ message: "Model not found" });
    const cover = model.coverImage?.driveFileId
      ? model.coverImage
      : (model.previewImages || []).find((image) => image?.driveFileId);
    if (!cover?.driveFileId) return res.status(404).json({ message: "Cover not found" });
    const cached = await openMarketplaceCoverCache(model);
    if (cached) {
      const etag = crypto.createHash("sha1").update(String(model.coverCache?.key || "")).digest("hex");
      res.setHeader("cache-control", "public, max-age=31536000, immutable");
      res.setHeader("etag", `"${etag}"`);
      res.setHeader("cross-origin-resource-policy", "cross-origin");
      res.setHeader("content-type", cached.contentType);
      if (cached.contentLength) res.setHeader("content-length", cached.contentLength);
      cached.stream.on("error", next);
      return cached.stream.pipe(res);
    }
    await streamImageRef(res, next, cover, "cover.jpg");
  } catch (error) {
    next(error);
  }
}

export async function streamMarketplacePreview(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: `Invalid ${assetLabel(assetType).toLowerCase()} id` });
    }
    const index = Number(req.params.index || 0);
    if (!Number.isInteger(index) || index < 0 || index > 50) {
      return res.status(400).json({ message: "Invalid preview index" });
    }
    const model = await MarketplaceModel.findOne({ _id: req.params.id, assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() })
      .select("title previewImages")
      .lean();
    if (!model) return res.status(404).json({ message: "Model not found" });
    const preview = model.previewImages?.[index];
    if (!preview?.driveFileId) return res.status(404).json({ message: "Preview not found" });
    await streamImageRef(res, next, preview, `preview-${index + 1}.jpg`);
  } catch (error) {
    next(error);
  }
}

export async function createDownloadSession(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: `Invalid ${assetLabel(assetType).toLowerCase()} id` });
    }
    const clientType = String(req.originalUrl || "").includes("/api/plugin/") ? "plugin" : "web";
    if (clientType === "web") {
      await verifyMarketplaceTurnstile({
        token: req.body?.turnstileToken || req.body?.["cf-turnstile-response"],
        remoteIp: req.get?.("cf-connecting-ip") || req.ip || "",
        expectedCData: req.params.id,
      });
    }
    const result = await createMarketplaceDownloadSession({
      req,
      modelId: req.params.id,
      clientType,
        expectedAssetType: assetType,
    });
    res.json({
      session: {
        _id: result.session._id,
        expiresAt: result.session.expiresAt,
        fileName: result.session.fileName,
         fileSize: result.session.fileSize,
         sha256: result.session.sha256,
         assetRevision: result.session.assetRevision || "",
         mainMaxFile: result.session.mainMaxFile || "",
         archiveFormat: result.session.archiveFormat || "zip",
       },
      downloadUrl: result.downloadUrl,
      remaining: result.remaining,
      quotaCost: result.quotaCost,
      resetAt: result.resetAt,
      paymentMethod: result.paymentMethod,
      billingStatus: result.billingStatus,
      creditCost: result.creditCost,
      creditEntitlementUntil: result.creditEntitlementUntil,
    });
  } catch (error) {
    next(error);
  }
}

export async function getDownloadOptions(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: `Invalid ${assetLabel(assetType).toLowerCase()} id` });
    }
    const options = await getMarketplaceDownloadOptions({
      req,
      modelId: req.params.id,
      expectedAssetType: assetType,
    });
    res.json(options);
  } catch (error) {
    next(error);
  }
}

export async function downloadSessionFile(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }
    const session = await verifyDownloadSession(
      req.params.id,
      req.query.t,
      req.user?._id,
    );
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-accel-buffering", "no");

    const redirectUrl = await getStorageBrowserDownloadLink(session).catch((error) => {
      if (String(process.env.MARKETPLACE_DOWNLOAD_REDIRECT_FALLBACK_PROXY || "true").toLowerCase() === "true") {
        return "";
      }
      throw error;
    });
    if (redirectUrl) {
      const billedSession = await finalizeMarketplaceDownloadBilling(session);
      await markMarketplaceDownloadRedeemed(billedSession);
      return res.redirect(302, redirectUrl);
    }

    const file = await openStorageStream(session, { range: req.get("range") || "" });
    let billedSession;
    try {
      billedSession = await finalizeMarketplaceDownloadBilling(session);
    } catch (error) {
      file.stream?.destroy?.();
      throw error;
    }
    await markMarketplaceDownloadRedeemed(billedSession);
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${String(file.fileName || "model.zip").replace(/"/g, "")}"`,
    );
    res.setHeader("accept-ranges", file.acceptRanges || "bytes");
    if (file.contentRange) res.setHeader("content-range", file.contentRange);
    if (file.contentLength) res.setHeader("content-length", file.contentLength);
    res.status(file.statusCode === 206 ? 206 : 200);
    file.stream.on("error", next);
    file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
