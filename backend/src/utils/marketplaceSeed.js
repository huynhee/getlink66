import MarketplaceCategory from "../models/MarketplaceCategory.js";
import { DEFAULT_MARKETPLACE_CATEGORIES } from "../data/marketplaceCategories.js";

function categoryPayload(item, parent = null) {
  return {
    sourceProvider: "3dsky",
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

export async function initializeMarketplaceCategories() {
  const bySourceId = new Map();
  const roots = DEFAULT_MARKETPLACE_CATEGORIES.filter((item) => !item.parentId);
  const children = DEFAULT_MARKETPLACE_CATEGORIES.filter((item) => item.parentId);

  for (const item of roots) {
    const query = { sourceProvider: "3dsky", sourceCategoryId: String(item.id) };
    const category = await MarketplaceCategory.findOneAndUpdate(
      query,
      { $set: categoryPayload(item) },
      { upsert: true, new: true },
    );
    bySourceId.set(String(item.id), category);
  }

  for (const item of children) {
    const parent = bySourceId.get(String(item.parentId)) ||
      await MarketplaceCategory.findOne({
        sourceProvider: "3dsky",
        sourceCategoryId: String(item.parentId),
      });
    const query = { sourceProvider: "3dsky", sourceCategoryId: String(item.id) };
    const category = await MarketplaceCategory.findOneAndUpdate(
      query,
      { $set: categoryPayload(item, parent) },
      { upsert: true, new: true },
    );
    bySourceId.set(String(item.id), category);
  }
}
