import MarketplaceCategory from "../models/MarketplaceCategory.js";
import { DEFAULT_MARKETPLACE_CATEGORIES } from "../data/marketplaceCategories.js";
import { DEFAULT_SCENE_CATEGORIES } from "../data/marketplaceCatalogs.js";

function categoryPayload(item, parent = null, assetType = "model") {
  return {
    assetType,
    sourceProvider: assetType === "scene" ? "internal" : "3dsky",
    sourceCategoryId: String(item.id),
    title: item.title || "",
    titleEn: item.titleEn || "",
    slug: item.slug || "",
    parentId: parent?._id,
    parentSourceCategoryId: item.parentId ? String(item.parentId) : "",
    position: Number(item.position || 0),
    isActive: true,
  };
}

async function seedCategories(items, assetType) {
  const bySourceId = new Map();
  const roots = items.filter((item) => !item.parentId);
  const children = items.filter((item) => item.parentId);
  const sourceProvider = assetType === "scene" ? "internal" : "3dsky";

  for (const item of roots) {
    const query = { assetType, sourceProvider, sourceCategoryId: String(item.id) };
    const category = await MarketplaceCategory.findOneAndUpdate(
      query,
      { $set: categoryPayload(item, null, assetType) },
      { upsert: true, new: true },
    );
    bySourceId.set(String(item.id), category);
  }

  for (const item of children) {
    const parent = bySourceId.get(String(item.parentId)) ||
      await MarketplaceCategory.findOne({
        assetType,
        sourceProvider,
        sourceCategoryId: String(item.parentId),
      });
    const query = { assetType, sourceProvider, sourceCategoryId: String(item.id) };
    const category = await MarketplaceCategory.findOneAndUpdate(
      query,
      { $set: categoryPayload(item, parent, assetType) },
      { upsert: true, new: true },
    );
    bySourceId.set(String(item.id), category);
  }
}

export async function initializeMarketplaceCategories() {
  await seedCategories(DEFAULT_MARKETPLACE_CATEGORIES, "model");
  await seedCategories(DEFAULT_SCENE_CATEGORIES, "scene");
}
