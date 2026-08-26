import crypto from "node:crypto";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { marketplaceCoverCachePublicUrl } from "./marketplaceCoverCache.js";
import {
  marketplaceCategorySnapshot,
  marketplaceFilterSnapshot,
} from "./marketplaceTaxonomy.js";

const DEFAULT_TIMEOUT_MS = 400;
const DEFAULT_CIRCUIT_MS = 30_000;
const INDEX_SETTINGS_VERSION = 6;
let circuitOpenUntil = 0;
let lastFailure = "";
let settingsPromise = null;

function config() {
  const baseUrl = String(process.env.MEILISEARCH_URL || "").trim().replace(/\/+$/, "");
  const rolloutPercent = Math.min(100, Math.max(0, Number(
    process.env.MARKETPLACE_MEILI_ROLLOUT_PERCENT || 100,
  )));
  return {
    enabled: String(process.env.MARKETPLACE_SEARCH_ENGINE || "mongo").toLowerCase() === "meilisearch",
    baseUrl,
    apiKey: String(process.env.MEILI_MASTER_KEY || process.env.MEILISEARCH_MASTER_KEY || "").trim(),
    timeoutMs: Math.max(100, Number(process.env.MARKETPLACE_MEILI_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)),
    circuitMs: Math.max(5_000, Number(process.env.MARKETPLACE_MEILI_CIRCUIT_BREAKER_MS || DEFAULT_CIRCUIT_MS)),
    semanticEnabled: String(process.env.MARKETPLACE_SEARCH_SEMANTIC_ENABLED || "false").toLowerCase() === "true",
    rolloutPercent,
    shadowEnabled: String(process.env.MARKETPLACE_MEILI_SHADOW_ENABLED || "false").toLowerCase() === "true",
    modelIndex: String(process.env.MARKETPLACE_MEILI_MODEL_INDEX || "marketplace_models_v3").trim(),
    sceneIndex: String(process.env.MARKETPLACE_MEILI_SCENE_INDEX || "marketplace_scenes_v3").trim(),
  };
}

function indexName(assetType) {
  const current = config();
  return normalizeAssetType(assetType) === "scene" ? current.sceneIndex : current.modelIndex;
}

export function marketplaceMeilisearchConfigured() {
  const current = config();
  return Boolean(current.enabled && current.baseUrl && current.apiKey);
}

export function marketplaceMeilisearchCircuitState() {
  const current = config();
  return {
    configured: marketplaceMeilisearchConfigured(),
    open: circuitOpenUntil > Date.now(),
    openUntil: circuitOpenUntil ? new Date(circuitOpenUntil) : null,
    lastFailure,
    rolloutPercent: current.rolloutPercent,
    shadowEnabled: current.shadowEnabled,
  };
}

export function marketplaceMeiliTrafficDecision(seed = "") {
  const current = config();
  if (!marketplaceMeilisearchConfigured()) {
    return { useMeili: false, shadow: false, bucket: null, rolloutPercent: current.rolloutPercent };
  }
  const digest = crypto.createHash("sha256").update(String(seed || "marketplace-anonymous")).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  const useMeili = current.rolloutPercent >= 100 || bucket < current.rolloutPercent;
  return {
    useMeili,
    shadow: !useMeili && current.shadowEnabled,
    bucket,
    rolloutPercent: current.rolloutPercent,
  };
}

function markFailure(error, useCircuit) {
  lastFailure = String(error?.message || error || "Meilisearch request failed").slice(0, 500);
  if (useCircuit) circuitOpenUntil = Date.now() + config().circuitMs;
}

async function meiliRequest(path, options = {}) {
  const current = config();
  if (!current.enabled || !current.baseUrl || !current.apiKey) {
    const error = new Error("Meilisearch is not configured");
    error.code = "MEILISEARCH_NOT_CONFIGURED";
    throw error;
  }
  const useCircuit = options.useCircuit !== false;
  if (useCircuit && circuitOpenUntil > Date.now()) {
    const error = new Error("Meilisearch circuit breaker is open");
    error.code = "MEILISEARCH_CIRCUIT_OPEN";
    throw error;
  }
  const controller = new AbortController();
  const timeoutMs = Math.max(100, Number(options.timeoutMs || current.timeoutMs));
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${current.baseUrl}${path}`, {
      method: options.method || "GET",
      headers: {
        authorization: `Bearer ${current.apiKey}`,
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.message || `Meilisearch returned HTTP ${response.status}`);
      error.status = response.status;
      error.details = data;
      throw error;
    }
    if (useCircuit) {
      circuitOpenUntil = 0;
      lastFailure = "";
    }
    return data;
  } catch (error) {
    const normalized = error?.name === "AbortError"
      ? new Error(`Meilisearch timed out after ${timeoutMs} ms`)
      : error;
    markFailure(normalized, useCircuit);
    throw normalized;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForTask(taskUid, timeoutMs = 120_000) {
  if (taskUid === undefined || taskUid === null) return null;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = await meiliRequest(`/tasks/${taskUid}`, {
      timeoutMs: 5_000,
      useCircuit: false,
    });
    if (task.status === "succeeded") return task;
    if (["failed", "canceled"].includes(task.status)) {
      throw new Error(task.error?.message || `Meilisearch task ${taskUid} ${task.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Meilisearch task ${taskUid} timed out`);
}

function normalizeText(value = "") {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.flatMap((value) => Array.isArray(value) ? value : [value])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function publicCategory(category) {
  if (!category) return null;
  return {
    title: category.title || "",
    titleEn: category.titleEn || category.title || "",
    slug: category.slug || "",
    sourceCategoryId: category.sourceCategoryId || "",
  };
}

function publicCover(model) {
  const image = model.coverImage?.driveFileId
    ? model.coverImage
    : (model.previewImages || []).find((item) => item?.driveFileId);
  if (!image) return null;
  const segment = normalizeAssetType(model.assetType) === "scene" ? "scenes" : "models";
  const version = model.updatedAt ? new Date(model.updatedAt).getTime().toString(36) : "";
  return {
    url: marketplaceCoverCachePublicUrl(model)
      || `/api/marketplace/${segment}/${model._id}/cover${version ? `?v=${version}` : ""}`,
    alt: image.alt || model.title || "",
    width: Number(model.coverCache?.width || image.width || 0),
    height: Number(model.coverCache?.height || image.height || 0),
    size: Number(model.coverCache?.size || image.size || 0),
  };
}

async function taxonomyContext(assetType) {
  const [categories, filters] = await Promise.all([
    marketplaceCategorySnapshot(assetType, { includeInactive: true }),
    marketplaceFilterSnapshot(assetType, { includeInactive: true }),
  ]);
  const categoryByKey = new Map(categories.map((item) => [String(item.sourceCategoryId || ""), item]));
  const filterByFacet = {};
  for (const [facet, items] of Object.entries(filters)) {
    filterByFacet[facet] = new Map((items || []).map((item) => [String(item.value || ""), item]));
  }
  return { categories, categoryByKey, filterByFacet };
}

export async function buildMarketplaceMeiliDocument(model, searchDocument = {}, suppliedContext = null) {
  const assetType = normalizeAssetType(model.assetType);
  const context = suppliedContext || await taxonomyContext(assetType);
  const category = context.categoryByKey.get(String(model.categorySourceId || ""));
  const parentCategory = context.categoryByKey.get(String(model.parentCategorySourceId || ""));
  const categoryTerms = uniqueStrings([
    model.categorySourceId,
    model.parentCategorySourceId,
    category?.slug,
    category?.title,
    category?.titleEn,
    category?.aliasesVi,
    category?.aliasesEn,
    parentCategory?.slug,
    parentCategory?.title,
    parentCategory?.titleEn,
    parentCategory?.aliasesVi,
    parentCategory?.aliasesEn,
  ]);
  const facetMap = {
    styles: "style",
    renderers: "render",
    forms: "form",
    colors: "color",
    materials: "material",
    platforms: "platform",
  };
  const facetTerms = [];
  for (const [field, facet] of Object.entries(facetMap)) {
    for (const value of model[field] || []) {
      const option = context.filterByFacet[facet]?.get(String(value));
      facetTerms.push(value, option?.labelVi, option?.labelEn, option?.aliasesVi, option?.aliasesEn);
    }
  }
  const sourceAssetId = String(model.source?.assetId || model.source?.modelId || "");
  const behaviorInteractions = Number(model.behaviorMetrics?.clicks || 0)
    + Number(model.behaviorMetrics?.detailViews || 0);
  const qualityScore = Math.min(
    1,
    (Number(model.behaviorMetrics?.downloads || 0) + 1) / (behaviorInteractions + 8),
  );
  const card = {
    _id: String(model._id),
    assetType,
    title: model.title || "",
    slug: model.slug || "",
    categoryId: model.categorySourceId || "",
    parentCategoryId: model.parentCategorySourceId || "",
    category: publicCategory(category),
    parentCategory: publicCategory(parentCategory),
    categorySourceId: model.categorySourceId || "",
    parentCategorySourceId: model.parentCategorySourceId || "",
    coverImage: publicCover(model),
    previewImages: [],
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
    quotaCost: assetType === "scene" ? 5 : 1,
    createdAt: model.createdAt,
    updatedAt: model.updatedAt,
  };
  return {
    id: String(model._id),
    assetType,
    sourceAssetId,
    sourceAssetIdSort: Number(model.sourceAssetIdSort || 0),
    title: model.title || "",
    titleNormalized: model.titleSort || normalizeText(model.title),
    slug: model.slug || "",
    searchTitle: searchDocument.searchTitle || model.searchTitle || "",
    searchTaxonomy: searchDocument.searchTaxonomy || model.searchTaxonomy || "",
    categoryTerms,
    facetTerms: uniqueStrings(facetTerms),
    renderer: model.renderer || "",
    styles: model.styles || [],
    renderers: model.renderers || [],
    forms: model.forms || [],
    colors: model.colors || [],
    materials: model.materials || [],
    platforms: model.platforms || [],
    accessType: model.accessType || "member",
    categorySourceId: model.categorySourceId || "",
    parentCategorySourceId: model.parentCategorySourceId || "",
    categoryKeys: uniqueStrings([model.categorySourceId, model.parentCategorySourceId]),
    isPublished: Boolean(model.isPublished),
    metadataStatus: model.metadataStatus || "incomplete",
    fileStatus: model.fileStatus || "missing",
    deletionStatus: model.deletionStatus || "active",
    downloadCount: Number(model.downloadCount || 0),
    popularity24h: Number(model.popularity24h || 0),
    qualityScore,
    createdAtEpoch: new Date(model.createdAt || 0).getTime() || 0,
    updatedAtEpoch: new Date(model.updatedAt || 0).getTime() || 0,
    semanticText: uniqueStrings([
      model.title,
      categoryTerms,
      facetTerms,
      model.renderer,
    ]).join(" "),
    card,
  };
}

function isPublicDocument(model) {
  return Boolean(
    model?.isPublished
    && model?.metadataStatus === "complete"
    && model?.fileStatus === "ready"
    && !["deleting", "trashed", "purging", "purged"].includes(model?.deletionStatus),
  );
}

export async function syncMarketplaceSearchDocuments(records = []) {
  if (!marketplaceMeilisearchConfigured() || !records.length) return { configured: false, upserted: 0, deleted: 0 };
  await ensureMarketplaceMeiliIndexes();
  const grouped = { model: { upserts: [], deletes: [] }, scene: { upserts: [], deletes: [] } };
  const publicTypes = [...new Set(records
    .map((record) => record?.model || record)
    .filter((model) => model?._id && isPublicDocument(model))
    .map((model) => normalizeAssetType(model.assetType)))];
  const contexts = new Map(await Promise.all(publicTypes.map(async (assetType) => (
    [assetType, await taxonomyContext(assetType)]
  ))));
  for (const record of records) {
    const model = record?.model || record;
    if (!model?._id) continue;
    const type = normalizeAssetType(model.assetType);
    if (isPublicDocument(model)) {
      grouped[type].upserts.push(await buildMarketplaceMeiliDocument(
        model,
        record.searchDocument,
        contexts.get(type),
      ));
    } else {
      grouped[type].deletes.push(String(model._id));
    }
  }
  let upserted = 0;
  let deleted = 0;
  for (const assetType of ["model", "scene"]) {
    const index = encodeURIComponent(indexName(assetType));
    if (grouped[assetType].upserts.length) {
      const task = await meiliRequest(`/indexes/${index}/documents?primaryKey=id`, {
        method: "POST",
        body: grouped[assetType].upserts,
        timeoutMs: 30_000,
        useCircuit: false,
      });
      await waitForTask(task.taskUid);
      upserted += grouped[assetType].upserts.length;
    }
    if (grouped[assetType].deletes.length) {
      const task = await meiliRequest(`/indexes/${index}/documents/delete-batch`, {
        method: "POST",
        body: grouped[assetType].deletes,
        timeoutMs: 30_000,
        useCircuit: false,
      });
      await waitForTask(task.taskUid);
      deleted += grouped[assetType].deletes.length;
    }
  }
  return { configured: true, upserted, deleted };
}

function synonymsForContext(context) {
  const synonyms = {};
  const add = (values) => {
    const terms = uniqueStrings(values).map(normalizeText).filter((value) => value.length >= 2);
    for (const term of terms) synonyms[term] = uniqueStrings([...(synonyms[term] || []), ...terms.filter((item) => item !== term)]);
  };
  context.categories.forEach((item) => add([
    item.title,
    item.titleEn,
    item.aliasesVi,
    item.aliasesEn,
  ]));
  Object.values(context.filterByFacet).forEach((items) => {
    for (const item of items.values()) add([item.value, item.labelVi, item.labelEn, item.aliasesVi, item.aliasesEn]);
  });
  return synonyms;
}

async function ensureIndex(assetType) {
  const current = config();
  const uid = indexName(assetType);
  try {
    await meiliRequest(`/indexes/${encodeURIComponent(uid)}`, { timeoutMs: 5_000, useCircuit: false });
  } catch (error) {
    if (error.status !== 404) throw error;
    const task = await meiliRequest("/indexes", {
      method: "POST",
      body: { uid, primaryKey: "id" },
      timeoutMs: 5_000,
      useCircuit: false,
    });
    await waitForTask(task.taskUid);
  }
  const context = await taxonomyContext(assetType);
  const settings = {
    searchableAttributes: [
      "sourceAssetId",
      "title",
      "slug",
      "searchTitle",
      "categoryTerms",
      "facetTerms",
      "renderer",
      "styles",
      "renderers",
      "forms",
      "colors",
      "materials",
      "platforms",
      "searchTaxonomy",
    ],
    displayedAttributes: [
      "id",
      "assetType",
      "accessType",
      "sourceAssetIdSort",
      "downloadCount",
      "popularity24h",
      "qualityScore",
      "createdAtEpoch",
      "card",
    ],
    filterableAttributes: [
      "assetType",
      "accessType",
      "categorySourceId",
      "parentCategorySourceId",
      "categoryKeys",
      "styles",
      "renderers",
      "forms",
      "colors",
      "materials",
      "platforms",
      "isPublished",
      "metadataStatus",
      "fileStatus",
      "deletionStatus",
    ],
    sortableAttributes: [
      "sourceAssetIdSort",
      "createdAtEpoch",
      "downloadCount",
      "titleNormalized",
      "popularity24h",
      "qualityScore",
    ],
    rankingRules: [
      "words",
      "exactness",
      "attributeRank",
      "wordPosition",
      "typo",
      "proximity",
      "sort",
      "qualityScore:desc",
      "popularity24h:desc",
      "downloadCount:desc",
      "sourceAssetIdSort:desc",
    ],
    searchCutoffMs: 300,
    pagination: { maxTotalHits: 250_000 },
    typoTolerance: {
      enabled: true,
      minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },
      disableOnAttributes: ["sourceAssetId"],
    },
    synonyms: synonymsForContext(context),
  };
  if (current.semanticEnabled) {
    settings.embedders = {
      multilingual: {
        source: "huggingFace",
        model: "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        documentTemplate: "{{doc.semanticText}}",
        pooling: "useModel",
      },
    };
  }
  const task = await meiliRequest(`/indexes/${encodeURIComponent(uid)}/settings`, {
    method: "PATCH",
    body: settings,
    timeoutMs: 30_000,
    useCircuit: false,
  });
  await waitForTask(task.taskUid, 10 * 60_000);
  return { uid, settingsVersion: INDEX_SETTINGS_VERSION };
}

export function ensureMarketplaceMeiliIndexes() {
  if (!marketplaceMeilisearchConfigured()) return Promise.resolve({ configured: false });
  if (!settingsPromise) {
    settingsPromise = Promise.all([ensureIndex("model"), ensureIndex("scene")])
      .then((indexes) => ({ configured: true, indexes }))
      .catch((error) => {
        settingsPromise = null;
        throw error;
      });
  }
  return settingsPromise;
}

function quoted(value) {
  return JSON.stringify(String(value || ""));
}

function searchFilters({ assetType, accessType, categoryKeys = [], facets = {} }) {
  const filters = [
    `assetType = ${quoted(normalizeAssetType(assetType))}`,
    "isPublished = true",
    `metadataStatus = ${quoted("complete")}`,
    `fileStatus = ${quoted("ready")}`,
    `deletionStatus = ${quoted("active")}`,
  ];
  if (["free", "member"].includes(accessType)) filters.push(`accessType = ${quoted(accessType)}`);
  if (categoryKeys.length) filters.push(`categoryKeys IN [${categoryKeys.map(quoted).join(",")}]`);
  for (const [field, values] of Object.entries(facets)) {
    if (values?.length) filters.push(`${field} IN [${values.map(quoted).join(",")}]`);
  }
  return filters;
}

function semanticRatio(query) {
  const normalized = normalizeText(query);
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return 0;
  if (/^\d+$/.test(normalized) || tokens.length <= 2) return 0.15;
  return 0.35;
}

function meiliSort(sort) {
  const map = {
    featured: ["popularity24h:desc", "qualityScore:desc", "downloadCount:desc", "sourceAssetIdSort:desc"],
    newest: ["sourceAssetIdSort:desc", "createdAtEpoch:desc"],
    popular: ["popularity24h:desc", "downloadCount:desc", "sourceAssetIdSort:desc"],
  };
  return map[sort] || [];
}

async function rawSearch(options, accessType, offset, limit, ratioOverride = null) {
  const current = config();
  const ratio = ratioOverride ?? semanticRatio(options.q);
  const body = {
    q: String(options.q || ""),
    offset,
    limit,
    filter: searchFilters({ ...options, accessType }),
    attributesToRetrieve: ["id", "card", "accessType", "sourceAssetIdSort", "downloadCount", "popularity24h", "qualityScore", "createdAtEpoch"],
    showRankingScore: true,
  };
  const sort = meiliSort(options.sort);
  if (sort.length) body.sort = sort;
  if (current.semanticEnabled && ratio > 0) {
    body.hybrid = { embedder: "multilingual", semanticRatio: ratio };
  }
  const hybridRequested = Boolean(body.hybrid);
  try {
    return await meiliRequest(`/indexes/${encodeURIComponent(indexName(options.assetType))}/search`, {
      method: "POST",
      body,
      // A semantic embedder can be temporarily unavailable while Meilisearch
      // is indexing. Let the lexical retry decide whether the service itself
      // is unhealthy instead of opening the circuit on the hybrid attempt.
      useCircuit: !hybridRequested,
    });
  } catch (error) {
    if (!body.hybrid) throw error;
    delete body.hybrid;
    return meiliRequest(`/indexes/${encodeURIComponent(indexName(options.assetType))}/search`, {
      method: "POST",
      body,
    });
  }
}

function totalHits(result) {
  return Number(result?.totalHits ?? result?.estimatedTotalHits ?? result?.hits?.length ?? 0);
}

function cards(result) {
  return (result?.hits || []).map((hit) => ({
    ...hit.card,
    _searchScore: Number(hit._rankingScore || 0),
  }));
}

export async function searchMarketplaceMeili(options = {}) {
  if (!marketplaceMeilisearchConfigured()) return null;
  const page = Math.max(1, Number(options.page || 1));
  const limit = Math.min(60, Math.max(1, Number(options.limit || 60)));
  const startedAt = performance.now();
  const explicitAccess = options.accessType === "free" || options.accessType === "member";
  let results = [];
  let total = 0;
  let processingTimeMs = 0;
  if (options.prioritizePro && !explicitAccess) {
    const globalOffset = (page - 1) * limit;
    let mode = config().semanticEnabled && options.q ? "hybrid" : "lexical";
    let [memberPage, freeCount] = await Promise.all([
      rawSearch(options, "member", globalOffset, limit),
      rawSearch(options, "free", 0, 0),
    ]);
    let memberTotal = totalHits(memberPage);
    let freeTotal = totalHits(freeCount);
    if (!memberTotal && !freeTotal && config().semanticEnabled && options.q) {
      [memberPage, freeCount] = await Promise.all([
        rawSearch(options, "member", 0, limit, 0.65),
        rawSearch(options, "free", 0, 0, 0.65),
      ]);
      memberTotal = totalHits(memberPage);
      freeTotal = totalHits(freeCount);
      mode = "semantic_retry";
    }
    total = memberTotal + freeTotal;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;
    const memberTake = offset < memberTotal ? Math.min(limit, memberTotal - offset) : 0;
    const freeOffset = Math.max(0, offset - memberTotal);
    const freeTake = Math.min(limit - memberTake, Math.max(0, freeTotal - freeOffset));
    const members = memberTake && safePage === page
      ? memberPage
      : (memberTake
        ? await rawSearch(options, "member", offset, memberTake)
        : { hits: [] });
    const free = freeTake
      ? await rawSearch(options, "free", freeOffset, freeTake)
      : { hits: [] };
    results = [
      ...cards(members).slice(0, memberTake),
      ...cards(free).slice(0, freeTake),
    ];
    processingTimeMs = Number(members.processingTimeMs || 0) + Number(free.processingTimeMs || 0);
    return {
      assets: results,
      total,
      totalPages,
      safePage,
      engine: "meilisearch_v3",
      mode,
      timingMs: Math.round((performance.now() - startedAt) * 10) / 10,
      processingTimeMs,
      correctedQuery: "",
    };
  }
  const access = options.accessType || "";
  let result = await rawSearch(options, access, (page - 1) * limit, limit);
  total = totalHits(result);
  let mode = config().semanticEnabled && options.q ? "hybrid" : "lexical";
  if (!total && config().semanticEnabled && options.q) {
    result = await rawSearch(options, access, 0, limit, 0.65);
    total = totalHits(result);
    mode = "semantic_retry";
  }
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  if (safePage !== page && total > 0) {
    result = await rawSearch(options, access, (safePage - 1) * limit, limit);
  }
  return {
    assets: cards(result),
    total,
    totalPages,
    safePage,
    engine: "meilisearch_v3",
    mode,
    timingMs: Math.round((performance.now() - startedAt) * 10) / 10,
    processingTimeMs: Number(result.processingTimeMs || 0),
    correctedQuery: "",
  };
}

export async function resolveMarketplaceMeiliCategoryKeys(value, assetType) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return [];
  const categories = await marketplaceCategorySnapshot(assetType);
  const selected = categories.find((item) => (
    String(item.slug || "").toLowerCase() === normalized
    || String(item.sourceCategoryId || "").toLowerCase() === normalized
    || String(item._id || "").toLowerCase() === normalized
  ));
  if (!selected) return ["__missing_category__"];
  const selectedKey = String(selected.sourceCategoryId || "");
  const byId = new Map(categories.map((item) => [String(item._id), item]));
  const keys = new Set([selectedKey]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of categories) {
      const parentKey = String(item.parentSourceCategoryId || byId.get(String(item.parentId || ""))?.sourceCategoryId || "");
      if (parentKey && keys.has(parentKey) && !keys.has(String(item.sourceCategoryId || ""))) {
        keys.add(String(item.sourceCategoryId || ""));
        changed = true;
      }
    }
  }
  return [...keys].filter(Boolean);
}

export async function marketplaceMeiliSuggestions({ assetType = "model", q = "", limit = 8 } = {}) {
  if (!marketplaceMeilisearchConfigured() || normalizeText(q).length < 2) return null;
  const normalizedQuery = normalizeText(q);
  const context = await taxonomyContext(assetType);
  const categorySuggestions = context.categories.flatMap((category) => {
    const terms = uniqueStrings([
      category.title,
      category.titleEn,
      category.slug,
      category.aliasesVi,
      category.aliasesEn,
    ]);
    if (!terms.some((term) => normalizeText(term).includes(normalizedQuery))) return [];
    return [{
      type: "category",
      value: category.title || category.titleEn || category.slug,
      label: category.title || category.titleEn || category.slug,
      categoryKey: category.sourceCategoryId || "",
      assetType: normalizeAssetType(assetType),
    }];
  }).slice(0, 3);
  const result = await rawSearch({ assetType, q, sort: "relevance", facets: {} }, "", 0, Math.min(12, Math.max(1, limit)), 0.15);
  const assetSuggestions = (result.hits || []).flatMap((hit) => {
    const title = String(hit.card?.title || "").trim();
    if (!title) return [];
    return [{
      type: "asset",
      value: title,
      label: title,
      slug: hit.card?.slug || "",
      assetType: normalizeAssetType(assetType),
    }];
  });
  const seen = new Set();
  return [...categorySuggestions, ...assetSuggestions]
    .filter((item) => {
      const key = String(item.value || "").toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export async function marketplaceMeilisearchHealth() {
  const state = marketplaceMeilisearchCircuitState();
  if (!state.configured) return { ...state, healthy: false };
  const startedAt = performance.now();
  try {
    const health = await meiliRequest("/health", { timeoutMs: 2_000, useCircuit: false });
    const [models, scenes] = await Promise.all([
      meiliRequest(`/indexes/${encodeURIComponent(indexName("model"))}/stats`, { timeoutMs: 2_000, useCircuit: false }).catch(() => null),
      meiliRequest(`/indexes/${encodeURIComponent(indexName("scene"))}/stats`, { timeoutMs: 2_000, useCircuit: false }).catch(() => null),
    ]);
    return {
      ...state,
      healthy: health.status === "available",
      latencyMs: Math.round((performance.now() - startedAt) * 10) / 10,
      indexes: {
        models: models ? { documents: Number(models.numberOfDocuments || 0), indexing: Boolean(models.isIndexing) } : null,
        scenes: scenes ? { documents: Number(scenes.numberOfDocuments || 0), indexing: Boolean(scenes.isIndexing) } : null,
      },
    };
  } catch (error) {
    return {
      ...marketplaceMeilisearchCircuitState(),
      healthy: false,
      latencyMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error: String(error.message || error).slice(0, 500),
    };
  }
}

export async function swapMarketplaceMeiliIndexes(swaps = []) {
  if (!swaps.length) return { taskUid: null };
  const task = await meiliRequest("/swap-indexes", {
    method: "POST",
    body: swaps.map(([left, right]) => ({ indexes: [left, right] })),
    timeoutMs: 30_000,
    useCircuit: false,
  });
  return waitForTask(task.taskUid, 10 * 60_000);
}

export function marketplaceSearchQueryId(query, filters = {}) {
  return crypto.createHash("sha256")
    .update(JSON.stringify({ query: normalizeText(query), filters, bucket: Math.floor(Date.now() / 600_000) }))
    .digest("hex")
    .slice(0, 20);
}
