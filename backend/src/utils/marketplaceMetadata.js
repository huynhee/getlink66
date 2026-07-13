import crypto from "node:crypto";
import { MARKETPLACE_FILTERS } from "../data/marketplaceFilters.js";

export const MARKETPLACE_METADATA_SCHEMA_VERSION = 2;
export const MARKETPLACE_METADATA_MAX_BYTES = 256 * 1024;

export const MARKETPLACE_METADATA_FIELDS = [
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

function normalizeFacet(value, key, errors) {
  const allowed = new Set((MARKETPLACE_FILTERS[key] || []).map((item) => item.value));
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
  const accessValue = String(source.accessType || "member").trim().toLowerCase();
  if (!["free", "member", "pro"].includes(accessValue)) {
    errors.push({ field: "accessType", code: "unknown_value", values: [accessValue] });
  }
  const metadata = {
    sourceModelId: stringValue(source.sourceModelId, 80),
    title: stringValue(source.title, 200),
    sourceCategoryId: stringValue(source.sourceCategoryId, 80),
    accessType: accessValue === "free" ? "free" : "member",
    renderer: stringValue(source.renderer, 80),
    styles: normalizeFacet(source.styles, "style", errors),
    renderers: normalizeFacet(source.renderers, "render", errors),
    forms: normalizeFacet(source.forms, "form", errors),
    colors: normalizeFacet(source.colors, "color", errors),
    materials: normalizeFacet(source.materials, "material", errors),
    sha256: sha256Value(source.sha256),
  };
  if (!metadata.sourceModelId) errors.push({ field: "sourceModelId", code: "required" });
  if (!metadata.title) errors.push({ field: "title", code: "required" });
  if (!metadata.sourceCategoryId) errors.push({ field: "sourceCategoryId", code: "required" });
  for (const field of ["styles", "renderers", "forms", "colors", "materials"]) {
    if (!metadata[field].length) errors.push({ field, code: "required" });
  }
  return { metadata, errors };
}

export function marketplaceMetadataDocument(raw = {}, options = {}) {
  const { metadata, errors } = normalizeMarketplaceMetadata(raw, options.fallback || {});
  return {
    document: {
      schemaVersion: MARKETPLACE_METADATA_SCHEMA_VERSION,
      revision: Math.max(1, Math.floor(Number(options.revision || raw.revision || 1))),
      updatedAt: new Date(options.updatedAt || raw.updatedAt || Date.now()).toISOString(),
      ...metadata,
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
    sourceModelId: model.metadataSourceModelId || model.source?.catalogId || model.driveFolderName || model.slug,
    title: model.title,
    sourceCategoryId: model.categorySourceId || model.source?.categoryId || "",
    accessType: model.accessType,
    renderer: model.renderer,
    styles: model.styles,
    renderers: model.renderers,
    forms: model.forms,
    colors: model.colors,
    materials: model.materials,
    sha256: model.sha256,
  }).metadata;
}
