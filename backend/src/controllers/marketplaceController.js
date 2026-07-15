import crypto from "node:crypto";
import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import DownloadSession from "../models/DownloadSession.js";
import DailyImageSearchQuota from "../models/DailyImageSearchQuota.js";
import { marketplaceAssetTypeFilter, marketplaceDownloadCost, marketplaceFiltersFor, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { isSafeId } from "../utils/validators.js";
import {
  createMarketplaceDownloadSession,
  nextVietnamReset,
  vietnamDayKey,
  verifyDownloadSession,
} from "../utils/marketplaceDownloadService.js";
import { isProActive } from "../utils/membershipService.js";
import {
  getStorageBrowserDownloadLink,
  openDemoMarketplaceImageStream,
  openGoogleDriveFileStream,
  openStorageStream,
} from "../utils/storageProvider.js";
import { marketplaceTurnstileConfig, verifyMarketplaceTurnstile } from "../utils/turnstile.js";
import { searchMarketplaceImage } from "../utils/marketplaceImageSearchProvider.js";
import {
  discoveryIdentityQuery,
  rankMarketplaceRecommendations,
  semanticRecommendations,
  semanticTextSearch,
  sortByDiscoveryMatches,
} from "../utils/marketplaceDiscovery.js";

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

function refId(value) {
  return value?._id || value;
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
    categoryId: refId(model.categoryId),
    parentCategoryId: refId(model.parentCategoryId),
    category: publicCategoryRef(model.categoryId),
    parentCategory: publicCategoryRef(model.parentCategoryId),
    categorySourceId: model.categorySourceId || "",
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
    isDemo: model.source?.provider === "demo",
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
}

function recommendationSignals(model) {
  const signals = [];
  const categoryId = refId(model.categoryId);
  const parentCategoryId = refId(model.parentCategoryId);
  if (categoryId) signals.push({ categoryId });
  if (parentCategoryId) signals.push({ parentCategoryId });
  if (model.renderer) signals.push({ renderer: model.renderer });
  if (model.styles?.length) signals.push({ styles: { $in: model.styles } });
  if (model.renderers?.length) signals.push({ renderers: { $in: model.renderers } });
  if (model.forms?.length) signals.push({ forms: { $in: model.forms } });
  if (model.colors?.length) signals.push({ colors: { $in: model.colors } });
  if (model.materials?.length) signals.push({ materials: { $in: model.materials } });
  return signals;
}

async function recommendedModelsFor(model, options = {}) {
  if (!model?._id) return { models: [], total: 0, engine: "local_hybrid" };
  const offset = Math.max(0, Number(options.offset || 0));
  const limit = Math.min(60, Math.max(1, Number(options.limit || 6)));
  const desiredCount = Math.min(60, offset + limit);
  const semantic = await semanticRecommendations(model, 180);
  const signals = recommendationSignals(model);
  const query = {
    assetType: marketplaceAssetTypeFilter(model.assetType),
    _id: { $ne: model._id },
    isPublished: true,
    metadataStatus: "complete",
    fileStatus: "ready",
    ...(signals.length ? { $or: signals } : {}),
  };
  const candidates = await MarketplaceModel.find(query)
    .sort({ downloadCount: -1, createdAt: -1 })
    .limit(720)
    .populate("categoryId", "title titleEn slug sourceCategoryId")
    .populate("parentCategoryId", "title titleEn slug sourceCategoryId")
    .lean();

  const semanticQuery = discoveryIdentityQuery(semantic.matches);
  if (semanticQuery) {
    const semanticCandidates = await MarketplaceModel.find({
      assetType: marketplaceAssetTypeFilter(model.assetType),
      isPublished: true,
      metadataStatus: "complete",
      fileStatus: "ready",
      _id: { $ne: model._id },
      ...semanticQuery,
    })
      .limit(180)
      .populate("categoryId", "title titleEn slug sourceCategoryId")
      .populate("parentCategoryId", "title titleEn slug sourceCategoryId")
      .lean();
    const seen = new Set(candidates.map((candidate) => String(candidate._id)));
    semanticCandidates.forEach((candidate) => {
      if (!seen.has(String(candidate._id))) candidates.push(candidate);
    });
  }

  const ranked = rankMarketplaceRecommendations(model, candidates, {
    semanticMatches: semantic.matches,
    limit: Math.max(desiredCount, 60),
  });
  return {
    models: ranked.slice(offset, offset + limit).map((item) => publicModel(item, { includePreviews: false })),
    total: Math.min(60, ranked.length),
    engine: semantic.matches.length ? semantic.provider : "local_hybrid",
  };
}

export async function listMarketplaceCategories(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const categories = await MarketplaceCategory.find({ assetType: marketplaceAssetTypeFilter(assetType), isActive: true })
      .sort({ position: 1 })
      .lean();
    res.json({ categories: buildCategoryTree(categories), flat: categories.sort(categorySort) });
  } catch (error) {
    next(error);
  }
}

export function listMarketplaceFilters(req, res) {
  const assetType = requestAssetType(req);
  res.json({ assetType, filters: marketplaceFiltersFor(assetType) });
}

async function categoryFilter(categoryValue, assetType = "model") {
  const value = String(categoryValue || "").trim();
  if (!value) return {};
  const category = await MarketplaceCategory.findOne({
    assetType: marketplaceAssetTypeFilter(assetType),
    $or: [
      { slug: value.toLowerCase() },
      { sourceCategoryId: value },
      ...(isSafeId(value) ? [{ _id: value }] : []),
    ],
  });
  if (!category) return { _id: { $exists: false } };
  return { $or: [{ categoryId: category._id }, { parentCategoryId: category._id }] };
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

export async function listMarketplaceModels(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const limit = Math.min(60, Math.max(1, Number(req.query.limit || PAGE_SIZE)));
    const search = String(req.query.q || req.query.search || "").trim().slice(0, 120);
    const accessType = String(req.query.accessType || "").trim();
    const fileStatus = String(req.query.fileStatus || "").trim();
    const query = { assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready" };
    Object.assign(query, accessTypeFilter(accessType));
    applyMarketplaceFacetFilters(query, req.query, assetType);
    if (["missing", "pending_upload", "ready", "failed"].includes(fileStatus)) query.fileStatus = fileStatus;
    const categoryQuery = await categoryFilter(req.query.category, assetType);
    addNestedFilter(query, categoryQuery);
    const semanticSearch = search ? await semanticTextSearch(search, 1_000, assetType) : { matches: [], provider: "catalog" };
    const semanticQuery = discoveryIdentityQuery(semanticSearch.matches);
    if (semanticQuery) {
      addNestedFilter(query, semanticQuery);
    } else if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      const searchQuery = {
        $or: [
          { title: regex },
          { slug: regex },
        ],
      };
      addNestedFilter(query, searchQuery);
    }

    const total = await MarketplaceModel.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    let models = await MarketplaceModel.find(query)
      .sort({ createdAt: -1 })
      .skip(semanticQuery ? 0 : (safePage - 1) * limit)
      .limit(semanticQuery ? Math.min(1_000, total) : limit)
      .populate("categoryId", "title titleEn slug sourceCategoryId")
      .populate("parentCategoryId", "title titleEn slug sourceCategoryId")
      .lean();
    if (semanticQuery) {
      models = sortByDiscoveryMatches(models, semanticSearch.matches).slice((safePage - 1) * limit, safePage * limit);
    }
    const assets = models.map((model) => publicModel(model, { includePreviews: false }));
    res.json({
      assetType,
      assets,
      ...(assetType === "scene" ? { scenes: assets } : { models: assets }),
      pagination: { page: safePage, pageSize: limit, total, totalPages },
      search: { engine: semanticQuery ? semanticSearch.provider : "catalog" },
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
    const query = { assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready" };

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
          .populate("categoryId", "title titleEn slug sourceCategoryId")
          .populate("parentCategoryId", "title titleEn slug sourceCategoryId")
          .lean()
      : [];
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
    const lookup = [{ assetType: assetFilter, slug: slugOrId.toLowerCase(), isPublished: true, metadataStatus: "complete", fileStatus: "ready" }];
    if (isSafeId(slugOrId)) lookup.push({ assetType: assetFilter, _id: slugOrId, isPublished: true, metadataStatus: "complete", fileStatus: "ready" });
    const model = await MarketplaceModel.findOne({ $or: lookup })
      .populate("categoryId", "title titleEn slug sourceCategoryId")
      .populate("parentCategoryId", "title titleEn slug sourceCategoryId")
      .lean();
    if (!model) return res.status(404).json({ message: `${assetLabel(assetType)} not found` });
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
    const lookup = [{ assetType: assetFilter, slug: slugOrId.toLowerCase(), isPublished: true, metadataStatus: "complete", fileStatus: "ready" }];
    if (isSafeId(slugOrId)) lookup.push({ assetType: assetFilter, _id: slugOrId, isPublished: true, metadataStatus: "complete", fileStatus: "ready" });
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
  const openStream = String(image.driveFileId || "").startsWith("demo:")
    ? Promise.resolve(openDemoMarketplaceImageStream())
    : openGoogleDriveFileStream(image.driveFileId, image.fileName || defaultFileName);
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
    const model = await MarketplaceModel.findOne({ _id: req.params.id, assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready" })
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
    const model = await MarketplaceModel.findOne({ _id: req.params.id, assetType: marketplaceAssetTypeFilter(assetType), isPublished: true, metadataStatus: "complete", fileStatus: "ready" })
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
    await DownloadSession.findByIdAndUpdate(session._id, { status: "used" });
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");

    const redirectUrl = await getStorageBrowserDownloadLink(session).catch((error) => {
      if (String(process.env.MARKETPLACE_DOWNLOAD_REDIRECT_FALLBACK_PROXY || "true").toLowerCase() === "true") {
        return "";
      }
      throw error;
    });
    if (redirectUrl) return res.redirect(302, redirectUrl);

    const file = await openStorageStream(session);
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
