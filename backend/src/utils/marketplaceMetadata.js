import crypto from "node:crypto";
import { MARKETPLACE_FILTERS } from "../data/marketplaceFilters.js";
import { marketplaceFiltersFor, normalizeAssetType } from "../data/marketplaceCatalogs.js";

export const MARKETPLACE_METADATA_SCHEMA_VERSION = 3;
export const MARKETPLACE_METADATA_MAX_BYTES = 256 * 1024;

export const MARKETPLACE_METADATA_FIELDS = [
  "assetType",
  "sourceAssetId",
  "sourceModelId",
  "title",
  "sourceCategoryId",
  "accessType",
  "renderer",
  "styles",
  "renderers",
  "forms",
  "colors",
  "materials",
  "platforms",
  "sha256",
];

function stringValue(value, maxLength = 200) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function facetValue(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/v-ray/g, "vray")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function rawList(value) {
  if (Array.isArray(value)) return value;
  return String(value ?? "").split(/[\n,]/);
}

function normalizeFacet(value, key, errors, filters = MARKETPLACE_FILTERS) {
  const allowed = new Set((filters[key] || []).map((item) => item.value));
  const normalized = [...new Set(rawList(value).map(facetValue).filter(Boolean))].slice(0, 24);
  const unknown = normalized.filter((item) => !allowed.has(item));
  if (unknown.length) errors.push({ field: key, code: "unknown_value", values: unknown });
  return normalized.filter((item) => allowed.has(item));
}

function sha256Value(value) {
  return String(value ?? "").trim().toLowerCase().match(/^[a-f0-9]{64}$/)?.[0] || "";
}

export function normalizeMarketplaceMetadata(raw = {}, fallback = {}) {
  const source = { ...fallback, ...raw };
  const errors = [];
  const assetType = normalizeAssetType(source.assetType || fallback.assetType);
  const filters = marketplaceFiltersFor(assetType);
  const accessValue = String(source.accessType || "member").trim().toLowerCase();
  if (!["free", "member", "pro"].includes(accessValue)) {
    errors.push({ field: "accessType", code: "unknown_value", values: [accessValue] });
  }
  const rawSha256 = stringValue(source.sha256, 128).toLowerCase();
  const metadata = {
    assetType,
    sourceAssetId: stringValue(source.sourceAssetId || source.sourceModelId, 80),
    sourceModelId: stringValue(source.sourceModelId || source.sourceAssetId, 80),
    title: stringValue(source.title, 200),
    sourceCategoryId: stringValue(source.sourceCategoryId, 80),
    accessType: accessValue === "free" ? "free" : "member",
    renderer: stringValue(source.renderer, 80),
    styles: normalizeFacet(source.styles, "style", errors, filters),
    renderers: normalizeFacet(source.renderers, "render", errors, filters),
    forms: assetType === "scene" ? [] : normalizeFacet(source.forms, "form", errors, filters),
    colors: assetType === "scene" ? [] : normalizeFacet(source.colors, "color", errors, filters),
    materials: assetType === "scene" ? [] : normalizeFacet(source.materials, "material", errors, filters),
    platforms: assetType === "scene" ? normalizeFacet(source.platforms || source.platform, "platform", errors, filters) : [],
    sha256: sha256Value(rawSha256),
  };
  if (!metadata.sourceAssetId) errors.push({ field: "sourceAssetId", code: "required" });
  if (!metadata.title) errors.push({ field: "title", code: "required" });
  if (!metadata.sourceCategoryId) errors.push({ field: "sourceCategoryId", code: "required" });
  if (rawSha256 && !metadata.sha256) errors.push({ field: "sha256", code: "invalid_format" });
  if (assetType === "scene" && !metadata.sha256) errors.push({ field: "sha256", code: "required" });
  return { metadata, errors };
}

export function marketplaceMetadataDocument(raw = {}, options = {}) {
  const { metadata, errors } = normalizeMarketplaceMetadata(raw, options.fallback || {});
  return {
    document: {
      schemaVersion: metadata.assetType === "scene" ? MARKETPLACE_METADATA_SCHEMA_VERSION : 2,
      revision: Math.max(1, Math.floor(Number(options.revision || raw.revision || 1))),
      updatedAt: new Date(options.updatedAt || raw.updatedAt || Date.now()).toISOString(),
      ...metadata,
      ...(metadata.assetType === "scene" ? { sourceModelId: undefined } : {}),
    },
    errors,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

export function serializeMarketplaceMetadata(document) {
  return `${JSON.stringify(stableValue(document), null, 2)}\n`;
}

export function marketplaceMetadataHash(document) {
  return crypto.createHash("sha256").update(serializeMarketplaceMetadata(document)).digest("hex");
}

export function marketplaceMetadataDiff(left = {}, right = {}) {
  return MARKETPLACE_METADATA_FIELDS.flatMap((field) => {
    const before = left[field] ?? (Array.isArray(right[field]) ? [] : "");
    const after = right[field] ?? (Array.isArray(left[field]) ? [] : "");
    return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ field, before, after }];
  });
}

export function metadataFromMarketplaceModel(model = {}) {
  return normalizeMarketplaceMetadata({
    assetType: model.assetType || "model",
    sourceAssetId: model.source?.assetId || model.metadataSourceModelId || model.source?.modelId || model.driveFolderName || model.slug,
    sourceModelId: model.metadataSourceModelId || model.source?.modelId || model.driveFolderName || model.slug,
    title: model.title,
    sourceCategoryId: model.categorySourceId || model.source?.categoryId || "",
    accessType: model.accessType,
    renderer: model.renderer,
    styles: model.styles,
    renderers: model.renderers,
    forms: model.forms,
    colors: model.colors,
    materials: model.materials,
    platforms: model.platforms,
    sha256: model.sha256,
  }).metadata;
}
