import crypto from "node:crypto";
import MarketplaceModel from "../models/MarketplaceModel.js";
import DailyImageSearchQuota from "../models/DailyImageSearchQuota.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { marketplaceAssetTypeFilter, marketplaceDownloadCost, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { isSafeId } from "../utils/validators.js";
import {
  createMarketplaceDownloadSession,
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
import {
  rankMarketplaceRecommendations,
} from "../utils/marketplaceDiscovery.js";
import { marketplaceHomeRecommendations } from "../utils/marketplaceRecommendationService.js";
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
  buildMarketplaceSearchDocument,
  marketplaceSearchCandidatePrefixes,
  marketplaceSearchMatches,
  marketplaceSearchQuery,
  marketplaceSearchScore,
  marketplaceSearchTokens,
  marketplaceSearchUsesFuzzyMatch,
} from "../utils/marketplaceSearch.js";
import { marketplacePublicDeletionQuery } from "../utils/marketplaceDeletionService.js";

const PAGE_SIZE = 60;
const IMAGE_SEARCH_FREE_LIMIT = 10;
const IMAGE_SEARCH_PRO_LIMIT = 150;
const MAX_IMAGE_SEARCH_BYTES = 512 * 1024;

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
  const firstPreview = (model.previewImages || []).find((image) => image?.driveFileId);
  if (firstPreview) return publicImageRef(model, firstPreview, coverUrl(model));
  return model.coverImage?.driveFileId ? publicImageRef(model, model.coverImage, coverUrl(model)) : null;
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
  const value = String(fallback || "").toLowerCase();
  if (value.startsWith("image/")) return value;
  const name = String(fileName || "").toLowerCase();
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".webp")) return "image/webp";
  if (name.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
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
    previewImages: includePreviews ? publicPreviewImages(model) : [],
    styles: model.styles || [],
    renderers: model.renderers || [],
    forms: model.forms || [],
    colors: model.colors || [],
    materials: model.materials || [],
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
  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.min(60, Math.max(1, Number(options.limit || 6)));
  const desiredCount = Math.min(60, offset + limit);
  const query = {
    assetType: marketplaceAssetTypeFilter(model.assetType),
    _id: { $ne: model._id },
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    ...marketplacePublicDeletionQuery(),
  };
  const candidates = await MarketplaceModel.find(query)
    .sort({ downloadCount: -1, createdAt: -1 })
    .limit(720)
    .lean();

  await hydrateMarketplaceCategoryRefs(candidates);
  const ranked = rankMarketplaceRecommendations(model, candidates, {
    limit: Math.max(desiredCount, 60),
  });
  return {
    models: ranked.slice(offset, offset + limit).map((item) => publicModel(item, { includePreviews: false })),
    total: Math.min(60, ranked.length),
    engine: "catalog_behavior_v2",
  };
}

export async function listMarketplaceHomeRecommendations(req, res, next) {
  try {
    const limit = Math.min(12, Math.max(1, Number(req.query.limit || 6)));
    const result = await marketplaceHomeRecommendations({ userId: req.user?._id || null, limit });
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
  if (normalizeAssetType(assetType) === "scene") return;
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

function sortMarketplaceDocuments(models, effectiveSort, search = "") {
  if (effectiveSort === "relevance") {
    return [...models].sort((left, right) => (
      marketplaceSearchScore(right, search) - marketplaceSearchScore(left, search)
      || Number(right.downloadCount || 0) - Number(left.downloadCount || 0)
      || new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime()
      || String(left._id).localeCompare(String(right._id))
    ));
  }
  const sortSpec = marketplaceSortSpec(effectiveSort);
  return [...models].sort((left, right) => {
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
  return Math.min(5_000, Math.max(200, Number(process.env.MARKETPLACE_SEARCH_CANDIDATE_LIMIT || 2_000)));
}

async function fuzzyMarketplacePage({ query, search, sortSelection, page, limit }) {
  const candidateLimit = searchCandidateLimit();
  const loadCandidates = async (broad = false) => {
    const candidateQuery = { ...query };
    addNestedFilter(candidateQuery, fuzzySearchCandidateFilter(search, { broad }));
    return MarketplaceModel.find(candidateQuery)
      .sort({ downloadCount: -1, createdAt: -1, _id: 1 })
      .limit(candidateLimit)
      .lean();
  };
  let candidates = await loadCandidates(false);
  if (!candidates.length) candidates = await loadCandidates(true);
  const matched = candidates.filter((candidate) => marketplaceSearchMatches(candidate, search, { fuzzy: true }));
  const sorted = sortMarketplaceDocuments(matched, sortSelection.effective, search);
  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  return {
    models: sorted.slice((safePage - 1) * limit, safePage * limit),
    total,
    totalPages,
    safePage,
    engine: "mongo_hybrid_v3",
    mode: matched.some((candidate) => marketplaceSearchUsesFuzzyMatch(candidate, search)) ? "fuzzy" : "token",
    truncated: candidates.length >= candidateLimit,
  };
}

async function bilingualMarketplacePage({ query, search, sortSelection, page, limit }) {
  if (!search) {
    const total = await MarketplaceModel.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const models = await MarketplaceModel.find(query)
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
    const sorted = sortMarketplaceDocuments(matched, sortSelection.effective, search);
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
      const total = await MarketplaceModel.countDocuments(textQuery);
      if (total > 0) {
        const totalPages = Math.max(1, Math.ceil(total / limit));
        const safePage = Math.min(page, totalPages);
        const relevance = sortSelection.effective === "relevance";
        const models = await MarketplaceModel.find(
          textQuery,
          relevance ? { relevance: { $meta: "textScore" } } : undefined,
        )
          .sort(relevance
            ? { relevance: { $meta: "textScore" }, downloadCount: -1, createdAt: -1, _id: 1 }
            : marketplaceSortSpec(sortSelection.effective))
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

  return fuzzyMarketplacePage({ query, search, sortSelection, page, limit });
}

export async function listMarketplaceModels(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit || PAGE_SIZE)));
    const search = String(req.query.q || req.query.search || "").trim().slice(0, 120);
    const sortSelection = marketplaceSortSelection(req.query.sort, Boolean(search));
    const accessType = String(req.query.accessType || "").trim();
    const fileStatus = String(req.query.fileStatus || "").trim();
    const query = { assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() };
    Object.assign(query, accessTypeFilter(accessType));
    applyMarketplaceFacetFilters(query, req.query, assetType);
    if (["missing", "pending_upload", "ready", "failed"].includes(fileStatus)) query.fileStatus = fileStatus;
    const categoryQuery = await categoryFilter(req.query.category, assetType);
    addNestedFilter(query, categoryQuery);
    const { models, total, totalPages, safePage, engine, mode, truncated } = await bilingualMarketplacePage({
      query,
      search,
      sortSelection,
      page,
      limit,
    });
    await hydrateMarketplaceCategoryRefs(models);
    const assets = models.map((model) => publicModel(model, { includePreviews: false }));
    res.json({
      assetType,
      assets,
      ...(assetType === "scene" ? { scenes: assets } : { models: assets }),
      pagination: { page: safePage, pageSize: limit, total, totalPages },
      search: { engine, mode, truncated: Boolean(truncated) },
      sort: sortSelection,
    });
  } catch (error) {
    next(error);
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
    await assertImageSearchQuotaAvailable(req, tier);
    const searchResult = await searchMarketplaceImage({
      imageData: image.imageData,
      imageHash: image.imageHash,
      limit,
      assetType,
    });
    const matchedIds = searchResult.matches.map((match) => match.modelId);
    const query = { assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready", ...marketplacePublicDeletionQuery() };

    Object.assign(query, accessTypeFilter(req.body.accessType));
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
          .limit(limit)
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
    models.sort((left, right) => modelRank(left).index - modelRank(right).index);
    const quota = await chargeImageSearchQuota(req, tier, image.imageHash);

    const assets = models.map((model) => ({
        ...publicModel(model, { includePreviews: false }),
        imageSearchScore: modelRank(model).score,
      }));
    res.json({
      assetType,
      assets,
      ...(assetType === "scene" ? { scenes: assets } : { models: assets }),
      pagination: { page: 1, pageSize: limit, total: models.length, totalPages: 1 },
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
    const recommendations = await recommendedModelsFor(model, { limit: 6 });
    res.json({
      asset: publicModel(model),
      ...(assetType === "scene" ? { scene: publicModel(model) } : { model: publicModel(model) }),
      downloadProtection: marketplaceTurnstileConfig(),
      recommendedModels: recommendations.models,
      recommendations: {
        total: recommendations.total,
        hasMore: recommendations.total > recommendations.models.length,
        engine: recommendations.engine,
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
    const recommendations = await recommendedModelsFor(model, { offset, limit });
    res.json({
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
  const openStream = openGoogleDriveFileStream(image.driveFileId, image.fileName || defaultFileName);
  return openStream.then((file) => {
    const etag = crypto.createHash("sha1").update(String(image.driveFileId || "")).digest("hex");
    res.setHeader("cache-control", "public, max-age=31536000, immutable");
    res.setHeader("etag", `"${etag}"`);
    res.setHeader("cross-origin-resource-policy", "cross-origin");
    res.setHeader("content-type", imageContentType(image.fileName, file.contentType));
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
      .select("title coverImage previewImages")
      .lean();
    if (!model) return res.status(404).json({ message: "Model not found" });
    const cover = (model.previewImages || []).find((image) => image?.driveFileId)
      || (model.coverImage?.driveFileId ? model.coverImage : null);
    if (!cover?.driveFileId) return res.status(404).json({ message: "Cover not found" });
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
      },
      downloadUrl: result.downloadUrl,
      remaining: result.remaining,
      quotaCost: result.quotaCost,
      resetAt: result.resetAt,
    });
  } catch (error) {
    next(error);
  }
}

export async function downloadSessionFile(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid session id" });
    }
    const session = await verifyDownloadSession(req.params.id, req.query.t);
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");

    const redirectUrl = await getStorageBrowserDownloadLink(session).catch((error) => {
      if (String(process.env.MARKETPLACE_DOWNLOAD_REDIRECT_FALLBACK_PROXY || "true").toLowerCase() === "true") {
        return "";
      }
      throw error;
    });
    if (redirectUrl) {
      await markMarketplaceDownloadRedeemed(session);
      return res.redirect(302, redirectUrl);
    }

    const file = await openStorageStream(session);
    await markMarketplaceDownloadRedeemed(session);
    res.setHeader("content-type", "application/octet-stream");
    res.setHeader(
      "content-disposition",
      `attachment; filename="${String(file.fileName || "model.zip").replace(/"/g, "")}"`,
    );
    if (file.contentLength) res.setHeader("content-length", file.contentLength);
    file.stream.on("error", next);
    file.stream.pipe(res);
  } catch (error) {
    next(error);
  }
}
