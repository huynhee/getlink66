import crypto from "node:crypto";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { marketplaceCategorySnapshot, marketplaceFilterSnapshot } from "../utils/marketplaceTaxonomy.js";

const SCHEMA_VERSION = 1;

function selectedAssetTypes(value) {
  return String(value || "all").toLowerCase() === "all"
    ? ["model", "scene"]
    : [normalizeAssetType(value)];
}

function categoryRows(categories, includeInactive) {
  const byId = new Map(categories.map((item) => [String(item._id), item]));
  return [...categories]
    .sort((left, right) => Number(left.position || 0) - Number(right.position || 0)
      || String(left.sourceCategoryId).localeCompare(String(right.sourceCategoryId)))
    .map((category) => ({
      key: String(category.sourceCategoryId || ""),
      parentKey: String(
        category.parentSourceCategoryId
        || byId.get(String(category.parentId || ""))?.sourceCategoryId
        || "",
      ),
      labelVi: String(category.title || category.titleEn || ""),
      labelEn: String(category.titleEn || category.title || ""),
      aliasesVi: [...(category.aliasesVi || [])],
      aliasesEn: [...(category.aliasesEn || [])],
      position: Number(category.position || 0),
      ...(includeInactive ? { isActive: category.isActive !== false } : {}),
    }));
}

function filterRows(filters, includeInactive) {
  return Object.fromEntries(
    Object.keys(filters).sort().map((facet) => [facet, [...(filters[facet] || [])]
      .sort((left, right) => Number(left.position || 0) - Number(right.position || 0)
        || String(left.value).localeCompare(String(right.value)))
      .map((option) => ({
        value: String(option.value || ""),
        facet,
        labelVi: String(option.labelVi || option.labelEn || option.value || ""),
        labelEn: String(option.labelEn || option.labelVi || option.value || ""),
        aliasesVi: [...(option.aliasesVi || [])],
        aliasesEn: [...(option.aliasesEn || [])],
        position: Number(option.position || 0),
        ...(option.hex ? { hex: option.hex } : {}),
        ...(option.iconKey ? { iconKey: option.iconKey } : {}),
        ...(option.iconUrl ? { iconUrl: option.iconUrl } : {}),
        ...(includeInactive ? { isActive: option.isActive !== false } : {}),
      }))]),
  );
}

export async function buildMarketplaceTaxonomyBundle({ assetType = "all", includeInactive = false } = {}) {
  const assets = {};
  for (const type of selectedAssetTypes(assetType)) {
    const [categories, filters] = await Promise.all([
      marketplaceCategorySnapshot(type, { includeInactive }),
      marketplaceFilterSnapshot(type, { includeInactive }),
    ]);
    assets[type] = {
      categories: categoryRows(categories, includeInactive),
      filters: filterRows(filters, includeInactive),
    };
  }
  const digest = crypto.createHash("sha256").update(JSON.stringify(assets)).digest("hex");
  return {
    schemaVersion: SCHEMA_VERSION,
    taxonomyVersion: `sha256:${digest}`,
    generatedAt: new Date().toISOString(),
    assets,
  };
}

function sendBundle(req, res, bundle) {
  const etag = `"${bundle.taxonomyVersion}"`;
  if (String(req.headers?.["if-none-match"] || "") === etag) return res.status(304).end();
  const stamp = bundle.generatedAt
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .replace(/\.\d{3}Z$/, "");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
  res.setHeader("Content-Disposition", `attachment; filename="3dipl-taxonomy-v1-${stamp}.json"`);
  return res.json(bundle);
}

export async function exportMarketplaceTaxonomy(req, res, next) {
  try {
    const bundle = await buildMarketplaceTaxonomyBundle({ assetType: req.query.assetType || "all" });
    return sendBundle(req, res, bundle);
  } catch (error) {
    next(error);
  }
}

export async function adminExportMarketplaceTaxonomy(req, res, next) {
  try {
    const bundle = await buildMarketplaceTaxonomyBundle({
      assetType: req.query.assetType || "all",
      includeInactive: String(req.query.includeInactive || "").toLowerCase() === "true",
    });
    return sendBundle(req, res, bundle);
  } catch (error) {
    next(error);
  }
}
