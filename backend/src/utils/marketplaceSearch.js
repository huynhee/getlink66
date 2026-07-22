import crypto from "node:crypto";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { marketplaceAssetTypeFilter, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { marketplaceCategoryLabelVi } from "../data/marketplaceCategoryLabelsVi.js";
import { marketplaceCategorySnapshot, marketplaceFilterSnapshot } from "./marketplaceTaxonomy.js";

export const MARKETPLACE_SEARCH_DOCUMENT_VERSION = 3;

const FACET_FIELDS = {
  styles: "style",
  renderers: "render",
  forms: "form",
  colors: "color",
  materials: "material",
};

const SEARCH_STOP_WORDS = new Set([
  "3d",
  "model",
  "models",
  "scene",
  "scenes",
]);

export function normalizeMarketplaceSearchText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u0111\u0110]/g, "d")
    .replace(/[đĐ]/g, "d")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function rawMarketplaceSearchTokens(value = "") {
  return normalizeMarketplaceSearchText(value).split(" ").filter(Boolean);
}

export function marketplaceSearchTokens(value = "") {
  const raw = rawMarketplaceSearchTokens(value);
  const meaningful = raw.filter((token) => !SEARCH_STOP_WORDS.has(token));
  return [...new Set(meaningful.length ? meaningful : raw)].slice(0, 16);
}

function appendSearchTokens(target, values) {
  for (const value of Array.isArray(values) ? values : [values]) {
    const normalized = normalizeMarketplaceSearchText(value);
    if (!normalized) continue;
    const tokens = rawMarketplaceSearchTokens(normalized);
    tokens.forEach((token) => target.add(token));
    if (tokens.length > 1 && tokens.length <= 5) target.add(tokens.join(""));
  }
}

function appendTerms(target, values) {
  for (const value of Array.isArray(values) ? values : [values]) {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    target.add(raw);
    const normalized = normalizeMarketplaceSearchText(raw);
    if (normalized) target.add(normalized);
  }
}

function categoryParentKey(category, categories) {
  if (category?.parentSourceCategoryId) return String(category.parentSourceCategoryId);
  if (!category?.parentId) return "";
  return String(categories.find((item) => String(item._id) === String(category.parentId))?.sourceCategoryId || "");
}

export async function buildMarketplaceSearchDocument(model = {}) {
  const assetType = normalizeAssetType(model.assetType);
  const [categories, filters] = await Promise.all([
    marketplaceCategorySnapshot(assetType, { includeInactive: true }),
    marketplaceFilterSnapshot(assetType, { includeInactive: true }),
  ]);
  const categoryByKey = new Map(categories.map((item) => [String(item.sourceCategoryId), item]));
  const titleTerms = new Set();
  const taxonomyTerms = new Set();
  appendTerms(titleTerms, [model.title, model.slug]);

  const categoryKeys = new Set([
    String(model.categorySourceId || ""),
    String(model.parentCategorySourceId || ""),
  ].filter(Boolean));
  const selectedCategory = categoryByKey.get(String(model.categorySourceId || ""));
  const inferredParentKey = categoryParentKey(selectedCategory, categories);
  if (inferredParentKey) categoryKeys.add(inferredParentKey);
  for (const key of categoryKeys) {
    const category = categoryByKey.get(key);
    appendTerms(taxonomyTerms, [
      key,
      category?.slug,
      category?.title,
      category?.titleEn,
      marketplaceCategoryLabelVi(category?.titleEn || category?.title),
      ...(category?.aliasesVi || []),
      ...(category?.aliasesEn || []),
    ]);
  }

  for (const [field, facet] of Object.entries(FACET_FIELDS)) {
    if (assetType === "scene" && ["forms", "colors", "materials"].includes(field)) continue;
    const optionByValue = new Map((filters[facet] || []).map((item) => [String(item.value), item]));
    for (const value of model[field] || []) {
      const option = optionByValue.get(String(value));
      appendTerms(taxonomyTerms, [
        value,
        option?.labelVi,
        option?.labelEn,
        ...(option?.aliasesVi || []),
        ...(option?.aliasesEn || []),
      ]);
    }
  }
  appendTerms(taxonomyTerms, [model.renderer]);

  const searchTitle = [...titleTerms].sort().join(" ");
  const searchTaxonomy = [...taxonomyTerms].sort().join(" ");
  const tokenTerms = new Set();
  appendSearchTokens(tokenTerms, [...titleTerms, ...taxonomyTerms]);
  const searchTokens = [...tokenTerms].filter((token) => token.length <= 80).sort();
  const searchDocumentHash = crypto
    .createHash("sha256")
    .update(JSON.stringify({ searchTitle, searchTaxonomy, searchTokens }))
    .digest("hex");
  return {
    searchVersion: MARKETPLACE_SEARCH_DOCUMENT_VERSION,
    searchTitle,
    searchTaxonomy,
    searchTokens,
    searchDocumentHash,
  };
}

export function marketplaceSearchQuery(value = "") {
  return marketplaceSearchTokens(String(value || "").replace(/["\\]/g, " ")).join(" ");
}

function documentTokens(value = "") {
  return [...new Set(rawMarketplaceSearchTokens(value))];
}

function editDistanceWithin(left, right, maximum) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previousPrevious = null;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1);
      let value = Math.min(previous[column] + 1, current[column - 1] + 1, substitution);
      if (
        previousPrevious
        && row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, previousPrevious[column - 2] + 1);
      }
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previousPrevious = previous;
    previous = current;
  }
  return previous[right.length];
}

function fuzzyDistanceLimit(token) {
  if (token.length >= 8) return 2;
  if (token.length >= 4) return 1;
  return 0;
}

function tokenMatchScore(queryToken, candidateToken, { fuzzy = true, title = false } = {}) {
  const weight = title ? 1.5 : 1;
  if (queryToken === candidateToken) return 10 * weight;
  if (!fuzzy) return 0;
  if (
    Math.min(queryToken.length, candidateToken.length) >= 3
    && (candidateToken.startsWith(queryToken) || queryToken.startsWith(candidateToken))
  ) return 7 * weight;
  const limit = fuzzyDistanceLimit(queryToken);
  if (!limit || editDistanceWithin(queryToken, candidateToken, limit) > limit) return 0;
  return (limit === 1 ? 5 : 4) * weight;
}

function marketplaceSearchMatchDetails(model = {}, query = "", { fuzzy = true } = {}) {
  const queryTokens = marketplaceSearchTokens(query);
  if (!queryTokens.length) return { matches: true, score: 0, fuzzy: false };
  const normalizedTitle = normalizeMarketplaceSearchText([model.title, model.slug, model.searchTitle].join(" "));
  const normalizedTaxonomy = normalizeMarketplaceSearchText(model.searchTaxonomy || "");
  const titleTokens = documentTokens(normalizedTitle);
  const taxonomyTokens = [...new Set([
    ...(Array.isArray(model.searchTokens) ? model.searchTokens : []),
    ...documentTokens(normalizedTaxonomy),
  ].map(normalizeMarketplaceSearchText).filter(Boolean))];
  let score = 0;
  let fuzzyMatch = false;

  for (const queryToken of queryTokens) {
    let best = 0;
    let exact = false;
    for (const token of titleTokens) {
      const candidateScore = tokenMatchScore(queryToken, token, { fuzzy, title: true });
      if (candidateScore > best) {
        best = candidateScore;
        exact = queryToken === token;
      }
    }
    for (const token of taxonomyTokens) {
      const candidateScore = tokenMatchScore(queryToken, token, { fuzzy });
      if (candidateScore > best) {
        best = candidateScore;
        exact = queryToken === token;
      }
    }
    if (!best) return { matches: false, score: 0, fuzzy: false };
    score += best;
    if (!exact) fuzzyMatch = true;
  }

  const normalizedQuery = normalizeMarketplaceSearchText(query);
  if (normalizedQuery && normalizedTitle === normalizedQuery) score += 40;
  else if (normalizedQuery && normalizedTitle.includes(normalizedQuery)) score += 24;
  if (queryTokens.every((token) => titleTokens.includes(token))) score += 14;
  return { matches: true, score, fuzzy: fuzzyMatch };
}

export function marketplaceSearchCandidatePrefixes(query = "") {
  return marketplaceSearchTokens(query).map((token) => {
    if (token.length >= 6) return token.slice(0, 3);
    if (token.length >= 3) return token.slice(0, 2);
    return token;
  });
}

export function marketplaceSearchMatches(model = {}, query = "", options = {}) {
  return marketplaceSearchMatchDetails(model, query, options).matches;
}

export function marketplaceSearchScore(model = {}, query = "", options = {}) {
  return marketplaceSearchMatchDetails(model, query, options).score;
}

export function marketplaceSearchUsesFuzzyMatch(model = {}, query = "") {
  const details = marketplaceSearchMatchDetails(model, query, { fuzzy: true });
  return details.matches && details.fuzzy;
}

export async function indexMarketplaceSearchDocument(modelOrId) {
  const model = typeof modelOrId === "object" && modelOrId?._id
    ? modelOrId
    : await MarketplaceModel.findById(modelOrId).lean();
  if (!model?._id) return null;
  try {
    const document = await buildMarketplaceSearchDocument(model);
    await MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: {
        ...document,
        searchStatus: "indexed",
        searchIndexedAt: new Date(),
        searchError: "",
      },
    });
    return document;
  } catch (error) {
    await MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: {
        searchStatus: "error",
        searchError: String(error?.message || "Search indexing failed").slice(0, 500),
      },
    });
    throw error;
  }
}

export async function markMarketplaceSearchPendingForTaxonomy({ assetType, type, key }) {
  const normalizedType = normalizeAssetType(assetType);
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey) return 0;
  const query = { assetType: marketplaceAssetTypeFilter(normalizedType) };
  if (type === "category") {
    query.$or = [
      { categorySourceId: normalizedKey },
      { parentCategorySourceId: normalizedKey },
    ];
  } else {
    const field = Object.entries(FACET_FIELDS).find(([, facet]) => facet === type)?.[0];
    if (!field) return 0;
    query[field] = normalizedKey;
  }
  if (!isMemoryDb()) {
    const result = await MarketplaceModel.updateMany(query, {
      $set: { searchStatus: "pending", searchError: "" },
    });
    return Number(result.modifiedCount || 0);
  }
  const models = await MarketplaceModel.find(query).select("_id").lean();
  await Promise.all(models.map((model) => MarketplaceModel.findByIdAndUpdate(model._id, {
    $set: { searchStatus: "pending", searchError: "" },
  })));
  return models.length;
}

export async function runMarketplaceSearchIndexBatch(limit = 100) {
  const safeLimit = Math.min(500, Math.max(1, Number(limit || 100)));
  const models = await MarketplaceModel.find({
    $or: [
      { searchStatus: { $in: ["pending", "error"] } },
      { searchStatus: { $exists: false } },
      { searchTokens: { $exists: false } },
      { searchVersion: { $ne: MARKETPLACE_SEARCH_DOCUMENT_VERSION } },
    ],
  })
    .sort({ updatedAt: 1 })
    .limit(safeLimit)
    .lean();
  let indexed = 0;
  let failed = 0;
  for (const model of models) {
    try {
      await indexMarketplaceSearchDocument(model);
      indexed += 1;
    } catch {
      failed += 1;
    }
  }
  return { processed: models.length, indexed, failed };
}
