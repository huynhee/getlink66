import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceFilterOption from "../models/MarketplaceFilterOption.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { marketplaceAssetTypeFilter, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { clearMarketplaceTaxonomyCache, normalizeTaxonomyAliases } from "../utils/marketplaceTaxonomy.js";
import { markMarketplaceSearchPendingForTaxonomy } from "../utils/marketplaceSearch.js";
import { isSafeId, limitedString, rejectUnknownKeys, sanitizeString } from "../utils/validators.js";

const FACETS_BY_ASSET = {
  model: ["style", "render", "form", "color", "material"],
  scene: ["style", "render"],
};
const FORM_ICON_KEYS = new Set([
  "round", "oval", "square", "rectangle", "triangle",
  "diamond", "pentagon", "star", "angle", "bioform",
]);
const TAXONOMY_KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

function requestAssetType(req) {
  return normalizeAssetType(req.query?.assetType || req.body?.assetType || "model");
}

function position(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(100000, Math.max(0, number)) : fallback;
}

function taxonomyKey(value, fallback = "") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function requireBoolean(value, field = "isActive") {
  if (value !== undefined && typeof value !== "boolean") {
    const error = new Error(`${field} must be a boolean`);
    error.status = 400;
    throw error;
  }
}

function requireLabels(labelVi, labelEn) {
  const vi = sanitizeString(labelVi, 120);
  const en = sanitizeString(labelEn, 120);
  if (!vi || !en) {
    const error = new Error("Vietnamese and English labels are required");
    error.status = 400;
    throw error;
  }
  return { vi, en };
}

function assertTaxonomyKey(key) {
  if (!key || !TAXONOMY_KEY_RE.test(key)) {
    const error = new Error("Taxonomy key must use lowercase letters, numbers and single hyphens");
    error.status = 400;
    error.code = "INVALID_TAXONOMY_KEY";
    throw error;
  }
}

function taxonomyConflict(message = "Taxonomy key already exists") {
  const error = new Error(message);
  error.status = 409;
  error.code = "TAXONOMY_KEY_CONFLICT";
  return error;
}

function increment(map, key, amount = 1) {
  const normalized = String(key || "").trim();
  if (!normalized) return;
  map.set(normalized, Number(map.get(normalized) || 0) + Number(amount || 0));
}

async function marketplaceTaxonomyUsage(assetType) {
  const categoryDirect = new Map();
  const categoryParent = new Map();
  const facetUsage = new Map();
  const fields = { styles: "style", renderers: "render", forms: "form", colors: "color", materials: "material" };
  const query = { assetType: marketplaceAssetTypeFilter(assetType) };

  if (isMemoryDb()) {
    const models = await MarketplaceModel.find(query)
      .select("categorySourceId parentCategorySourceId styles renderers forms colors materials")
      .lean();
    for (const model of models) {
      increment(categoryDirect, model.categorySourceId);
      increment(categoryParent, model.parentCategorySourceId);
      for (const [field, facet] of Object.entries(fields)) {
        for (const value of model[field] || []) increment(facetUsage, `${facet}:${value}`);
      }
    }
  } else {
    const facets = {
      categoryDirect: [{ $match: { categorySourceId: { $nin: ["", null] } } }, { $group: { _id: "$categorySourceId", count: { $sum: 1 } } }],
      categoryParent: [{ $match: { parentCategorySourceId: { $nin: ["", null] } } }, { $group: { _id: "$parentCategorySourceId", count: { $sum: 1 } } }],
    };
    for (const [field, facet] of Object.entries(fields)) {
      facets[facet] = [{ $unwind: `$${field}` }, { $group: { _id: `$${field}`, count: { $sum: 1 } } }];
    }
    const [usage = {}] = await MarketplaceModel.aggregate([{ $match: query }, { $facet: facets }]);
    for (const row of usage.categoryDirect || []) increment(categoryDirect, row._id, row.count);
    for (const row of usage.categoryParent || []) increment(categoryParent, row._id, row.count);
    for (const facet of Object.values(fields)) {
      for (const row of usage[facet] || []) increment(facetUsage, `${facet}:${row._id}`, row.count);
    }
  }

  return { categoryDirect, categoryParent, facetUsage };
}

export async function adminListMarketplaceTaxonomy(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const [categories, filterOptions, usage] = await Promise.all([
      MarketplaceCategory.find({ assetType: marketplaceAssetTypeFilter(assetType) }).sort({ position: 1 }).lean(),
      MarketplaceFilterOption.find({ assetType }).sort({ facet: 1, position: 1 }).lean(),
      marketplaceTaxonomyUsage(assetType),
    ]);
    res.json({
      assetType,
      categories: categories.map((category) => ({
        ...category,
        usageCount: Number(usage.categoryDirect.get(String(category.sourceCategoryId)) || 0)
          + Number(usage.categoryParent.get(String(category.sourceCategoryId)) || 0),
      })),
      filterOptions: filterOptions.map((option) => ({
        ...option,
        usageCount: Number(usage.facetUsage.get(`${option.facet}:${option.value}`) || 0),
      })),
      allowedFacets: FACETS_BY_ASSET[assetType],
      formIconKeys: [...FORM_ICON_KEYS],
    });
  } catch (error) {
    next(error);
  }
}

export async function adminCreateMarketplaceCategory(req, res, next) {
  try {
    if (rejectUnknownKeys(req.body, ["assetType", "title", "titleEn", "aliasesVi", "aliasesEn", "key", "parentId", "position", "isActive"])) {
      return res.status(400).json({ message: "Invalid category create request" });
    }
    const assetType = requestAssetType(req);
    const labels = requireLabels(req.body.title, req.body.titleEn);
    const key = String(req.body.key || "").trim() || taxonomyKey(labels.en);
    assertTaxonomyKey(key);
    requireBoolean(req.body.isActive);

    const duplicate = await MarketplaceCategory.findOne({
      assetType: marketplaceAssetTypeFilter(assetType),
      $or: [{ sourceCategoryId: key }, { slug: key }],
    }).lean();
    if (duplicate) throw taxonomyConflict();

    let parent = null;
    const parentId = String(req.body.parentId || "").trim();
    if (parentId) {
      if (!isSafeId(parentId)) return res.status(400).json({ message: "Invalid parent category id" });
      parent = await MarketplaceCategory.findById(parentId).lean();
      if (!parent || normalizeAssetType(parent.assetType) !== assetType) {
        return res.status(400).json({ message: "Parent category must use the same asset type" });
      }
      if (parent.isActive === false) return res.status(400).json({ message: "Parent category is disabled" });
      if (parent.parentId || parent.parentSourceCategoryId) {
        return res.status(400).json({ message: "Marketplace categories support only two levels" });
      }
    }

    const category = await MarketplaceCategory.create({
      assetType,
      sourceProvider: "internal",
      sourceCategoryId: key,
      slug: key,
      title: labels.vi,
      titleEn: labels.en,
      aliasesVi: normalizeTaxonomyAliases(req.body.aliasesVi),
      aliasesEn: normalizeTaxonomyAliases(req.body.aliasesEn),
      parentId: parent?._id || null,
      parentSourceCategoryId: parent?.sourceCategoryId || "",
      position: position(req.body.position),
      isActive: req.body.isActive !== false,
    });
    clearMarketplaceTaxonomyCache();
    return res.status(201).json({ category: { ...(category.toObject?.() || category), usageCount: 0 } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Taxonomy key already exists", code: "TAXONOMY_KEY_CONFLICT" });
    if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code || "" });
    next(error);
  }
}

export async function adminUpdateMarketplaceCategory(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid category id" });
    if (rejectUnknownKeys(req.body, ["title", "titleEn", "aliasesVi", "aliasesEn", "position", "isActive"])) {
      return res.status(400).json({ message: "Category keys and hierarchy are locked" });
    }
    requireBoolean(req.body.isActive);
    const current = await MarketplaceCategory.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Category not found" });
    const update = {};
    if (req.body.title !== undefined) update.title = sanitizeString(req.body.title, 120);
    if (req.body.titleEn !== undefined) update.titleEn = sanitizeString(req.body.titleEn, 120);
    if (req.body.aliasesVi !== undefined) update.aliasesVi = normalizeTaxonomyAliases(req.body.aliasesVi);
    if (req.body.aliasesEn !== undefined) update.aliasesEn = normalizeTaxonomyAliases(req.body.aliasesEn);
    if (req.body.position !== undefined) update.position = position(req.body.position, current.position);
    if (req.body.isActive !== undefined) update.isActive = req.body.isActive;
    requireLabels(update.title ?? current.title, update.titleEn ?? current.titleEn);
    const category = await MarketplaceCategory.findByIdAndUpdate(current._id, { $set: update }, { new: true });
    clearMarketplaceTaxonomyCache();
    await markMarketplaceSearchPendingForTaxonomy({
      assetType: current.assetType,
      type: "category",
      key: current.sourceCategoryId,
    });
    res.json({ category });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code || "" });
    next(error);
  }
}

export async function adminCreateMarketplaceFilterOption(req, res, next) {
  try {
    if (rejectUnknownKeys(req.body, ["assetType", "facet", "labelVi", "labelEn", "aliasesVi", "aliasesEn", "key", "position", "isActive", "hex", "iconKey"])) {
      return res.status(400).json({ message: "Invalid filter option create request" });
    }
    const assetType = requestAssetType(req);
    const facet = limitedString(req.body.facet, 20).toLowerCase();
    if (!FACETS_BY_ASSET[assetType].includes(facet)) {
      return res.status(400).json({ message: `${facet || "Facet"} is not supported for ${assetType}` });
    }
    const labels = requireLabels(req.body.labelVi, req.body.labelEn);
    const value = String(req.body.key || "").trim() || taxonomyKey(labels.en);
    assertTaxonomyKey(value);
    requireBoolean(req.body.isActive);

    const duplicate = await MarketplaceFilterOption.findOne({ assetType, facet, value }).lean();
    if (duplicate) throw taxonomyConflict();
    const hex = limitedString(req.body.hex, 7).toLowerCase();
    const iconKey = limitedString(req.body.iconKey, 40).toLowerCase();
    if (facet === "color" && !HEX_COLOR_RE.test(hex)) {
      return res.status(400).json({ message: "Color requires a valid #RRGGBB value" });
    }
    if (facet === "form" && !FORM_ICON_KEYS.has(iconKey)) {
      return res.status(400).json({ message: "Form requires a supported icon" });
    }

    const filterOption = await MarketplaceFilterOption.create({
      assetType,
      facet,
      value,
      labelVi: labels.vi,
      labelEn: labels.en,
      aliasesVi: normalizeTaxonomyAliases(req.body.aliasesVi),
      aliasesEn: normalizeTaxonomyAliases(req.body.aliasesEn),
      hex: facet === "color" ? hex : "",
      iconKey: facet === "form" ? iconKey : "",
      position: position(req.body.position),
      isActive: req.body.isActive !== false,
      catalogVersion: 1,
    });
    clearMarketplaceTaxonomyCache();
    return res.status(201).json({ filterOption: { ...(filterOption.toObject?.() || filterOption), usageCount: 0 } });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Taxonomy key already exists", code: "TAXONOMY_KEY_CONFLICT" });
    if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code || "" });
    next(error);
  }
}

export async function adminUpdateMarketplaceFilterOption(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid filter option id" });
    if (rejectUnknownKeys(req.body, ["labelVi", "labelEn", "aliasesVi", "aliasesEn", "position", "isActive", "hex", "iconKey"])) {
      return res.status(400).json({ message: "Filter keys and facets are locked" });
    }
    requireBoolean(req.body.isActive);
    const current = await MarketplaceFilterOption.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Filter option not found" });
    const update = {};
    if (req.body.labelVi !== undefined) update.labelVi = sanitizeString(req.body.labelVi, 120);
    if (req.body.labelEn !== undefined) update.labelEn = sanitizeString(req.body.labelEn, 120);
    if (req.body.aliasesVi !== undefined) update.aliasesVi = normalizeTaxonomyAliases(req.body.aliasesVi);
    if (req.body.aliasesEn !== undefined) update.aliasesEn = normalizeTaxonomyAliases(req.body.aliasesEn);
    if (req.body.position !== undefined) update.position = position(req.body.position, current.position);
    if (req.body.isActive !== undefined) update.isActive = req.body.isActive;
    if (req.body.hex !== undefined) {
      if (current.facet !== "color") return res.status(400).json({ message: "Only color options can define hex" });
      const hex = limitedString(req.body.hex, 7).toLowerCase();
      if (!HEX_COLOR_RE.test(hex)) return res.status(400).json({ message: "Color requires a valid #RRGGBB value" });
      update.hex = hex;
    }
    if (req.body.iconKey !== undefined) {
      if (current.facet !== "form") return res.status(400).json({ message: "Only form options can define an icon" });
      const iconKey = limitedString(req.body.iconKey, 40).toLowerCase();
      if (!FORM_ICON_KEYS.has(iconKey)) return res.status(400).json({ message: "Form requires a supported icon" });
      update.iconKey = iconKey;
    }
    requireLabels(update.labelVi ?? current.labelVi, update.labelEn ?? current.labelEn);
    const filterOption = await MarketplaceFilterOption.findByIdAndUpdate(current._id, { $set: update }, { new: true });
    clearMarketplaceTaxonomyCache();
    await markMarketplaceSearchPendingForTaxonomy({
      assetType: current.assetType,
      type: current.facet,
      key: current.value,
    });
    res.json({ filterOption });
  } catch (error) {
    if (error?.status) return res.status(error.status).json({ message: error.message, code: error.code || "" });
    next(error);
  }
}
