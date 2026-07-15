import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceFilterOption from "../models/MarketplaceFilterOption.js";
import { marketplaceAssetTypeFilter, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { clearMarketplaceTaxonomyCache } from "../utils/marketplaceTaxonomy.js";
import { isSafeId, limitedString, rejectUnknownKeys } from "../utils/validators.js";

function requestAssetType(req) {
  return normalizeAssetType(req.query?.assetType || req.body?.assetType || "model");
}

function position(value, fallback = 0) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(100000, Math.max(0, number)) : fallback;
}

export async function adminListMarketplaceTaxonomy(req, res, next) {
  try {
    const assetType = requestAssetType(req);
    const [categories, filterOptions] = await Promise.all([
      MarketplaceCategory.find({ assetType: marketplaceAssetTypeFilter(assetType) }).sort({ position: 1 }).lean(),
      MarketplaceFilterOption.find({ assetType }).sort({ facet: 1, position: 1 }).lean(),
    ]);
    res.json({ assetType, categories, filterOptions });
  } catch (error) {
    next(error);
  }
}

export async function adminUpdateMarketplaceCategory(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid category id" });
    if (rejectUnknownKeys(req.body, ["title", "titleEn", "position", "isActive"])) {
      return res.status(400).json({ message: "Category keys and hierarchy are locked" });
    }
    if (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    const current = await MarketplaceCategory.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Category not found" });
    const update = {};
    if (req.body.title !== undefined) update.title = limitedString(req.body.title, 120);
    if (req.body.titleEn !== undefined) update.titleEn = limitedString(req.body.titleEn, 120);
    if (req.body.position !== undefined) update.position = position(req.body.position, current.position);
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);
    if (!String((update.title ?? current.title) || "").trim() || !String((update.titleEn ?? current.titleEn) || "").trim()) {
      return res.status(400).json({ message: "Vietnamese and English labels are required" });
    }
    const category = await MarketplaceCategory.findByIdAndUpdate(current._id, { $set: update }, { new: true });
    clearMarketplaceTaxonomyCache();
    res.json({ category });
  } catch (error) {
    next(error);
  }
}

export async function adminUpdateMarketplaceFilterOption(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid filter option id" });
    if (rejectUnknownKeys(req.body, ["labelVi", "labelEn", "position", "isActive"])) {
      return res.status(400).json({ message: "Filter keys and facets are locked" });
    }
    if (req.body.isActive !== undefined && typeof req.body.isActive !== "boolean") {
      return res.status(400).json({ message: "isActive must be a boolean" });
    }
    const current = await MarketplaceFilterOption.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Filter option not found" });
    const update = {};
    if (req.body.labelVi !== undefined) update.labelVi = limitedString(req.body.labelVi, 120);
    if (req.body.labelEn !== undefined) update.labelEn = limitedString(req.body.labelEn, 120);
    if (req.body.position !== undefined) update.position = position(req.body.position, current.position);
    if (req.body.isActive !== undefined) update.isActive = Boolean(req.body.isActive);
    if (!String((update.labelVi ?? current.labelVi) || "").trim() || !String((update.labelEn ?? current.labelEn) || "").trim()) {
      return res.status(400).json({ message: "Vietnamese and English labels are required" });
    }
    const filterOption = await MarketplaceFilterOption.findByIdAndUpdate(current._id, { $set: update }, { new: true });
    clearMarketplaceTaxonomyCache();
    res.json({ filterOption });
  } catch (error) {
    next(error);
  }
}
