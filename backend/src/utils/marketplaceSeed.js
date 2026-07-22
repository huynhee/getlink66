import MarketplaceCategory from "../models/MarketplaceCategory.js";
import { DEFAULT_MARKETPLACE_CATEGORIES } from "../data/marketplaceCategories.js";
import { DEFAULT_SCENE_CATEGORIES } from "../data/marketplaceCatalogs.js";
import { seedMarketplaceFilterOptions } from "./marketplaceTaxonomy.js";

function categoryPayload(item, parent = null, assetType = "model") {
  return {
    assetType,
    sourceProvider: assetType === "scene" ? "internal" : "3dsky",
    sourceCategoryId: String(item.id),
    title: item.title || "",
    titleEn: item.titleEn || "",
    aliasesVi: item.aliasesVi || [],
    aliasesEn: item.aliasesEn || [],
    slug: item.slug || "",
    parentId: parent?._id || null,
    parentSourceCategoryId: item.parentId ? String(item.parentId) : "",
    position: Number(item.position || 0),
    isActive: true,
  };
}

async function backfillLegacyCategoryLabel(category, payload, assetType) {
  if (!category || assetType !== "model" || !payload.title || payload.title === payload.titleEn) return category;
  const currentTitle = String(category.title || "").trim();
  const currentEnglish = String(category.titleEn || "").trim();
  if (currentTitle && currentTitle !== currentEnglish && currentTitle !== payload.titleEn) return category;
  return MarketplaceCategory.findByIdAndUpdate(category._id, {
    $set: {
      title: payload.title,
      titleEn: payload.titleEn,
    },
  }, { new: true });
}

async function seedCategories(items, assetType) {
  const bySourceId = new Map();
  const roots = items.filter((item) => !item.parentId);
  const children = items.filter((item) => item.parentId);
  const sourceProvider = assetType === "scene" ? "internal" : "3dsky";

  for (const item of roots) {
    const query = { assetType, sourceProvider, sourceCategoryId: String(item.id) };
    const payload = categoryPayload(item, null, assetType);
    let category = await MarketplaceCategory.findOneAndUpdate(
      query,
      {
        $setOnInsert: {
          title: payload.title,
          titleEn: payload.titleEn,
          aliasesVi: payload.aliasesVi,
          aliasesEn: payload.aliasesEn,
          position: payload.position,
          isActive: payload.isActive,
        },
        $set: {
          slug: payload.slug,
          parentId: payload.parentId,
          parentSourceCategoryId: payload.parentSourceCategoryId,
        },
      },
      { upsert: true, new: true },
    );
    category = await backfillLegacyCategoryLabel(category, payload, assetType);
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
    const payload = categoryPayload(item, parent, assetType);
    let category = await MarketplaceCategory.findOneAndUpdate(
      query,
      {
        $setOnInsert: {
          title: payload.title,
          titleEn: payload.titleEn,
          aliasesVi: payload.aliasesVi,
          aliasesEn: payload.aliasesEn,
          position: payload.position,
          isActive: payload.isActive,
        },
        $set: {
          slug: payload.slug,
          parentId: payload.parentId,
          parentSourceCategoryId: payload.parentSourceCategoryId,
        },
      },
      { upsert: true, new: true },
    );
    category = await backfillLegacyCategoryLabel(category, payload, assetType);
    bySourceId.set(String(item.id), category);
  }
}

export async function initializeMarketplaceCategories() {
  await seedCategories(DEFAULT_MARKETPLACE_CATEGORIES, "model");
  await seedCategories(DEFAULT_SCENE_CATEGORIES, "scene");
  await seedMarketplaceFilterOptions();
}
