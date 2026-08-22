import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceFilterOption from "../models/MarketplaceFilterOption.js";
import { marketplaceAssetTypeFilter, marketplaceFiltersFor, normalizeAssetType } from "../data/marketplaceCatalogs.js";

const LABELS_VI = {
  classic: "Cổ điển", modern: "Hiện đại", ethnic: "Truyền thống",
  industrial: "Công nghiệp", neoclassic: "Tân cổ điển", luxury: "Sang trọng",
  indochine: "Đông Dương", japanese: "Nhật Bản", "wabi-sabi": "Wabi-sabi",
  french: "Phong cách Pháp", "modern-classic": "Cổ điển hiện đại", other: "Khác",
  "taiwan-style": "Phong cách Đài Loan", scandinavian: "Bắc Âu", rustic: "Mộc mạc",
  "color-block": "Khối màu", tropical: "Nhiệt đới",
  vray: "Vray", corona: "Corona", standard: "Standard",
  round: "Tròn", oval: "Bầu dục", square: "Vuông", rectangle: "Chữ nhật",
  triangle: "Tam giác", diamond: "Hình thoi", pentagon: "Ngũ giác", star: "Ngôi sao",
  angle: "Angle", bioform: "Bioform", white: "Trắng", gray: "Xám", black: "Đen",
  brown: "Nâu", red: "Đỏ", orange: "Cam", yellow: "Vàng", beige: "Be",
  pink: "Hồng", magenta: "Tím hồng", purple: "Tím", blue: "Xanh dương",
  sky: "Xanh trời", cyan: "Xanh ngọc", lime: "Xanh lá sáng", green: "Xanh lá",
  brick: "Gạch", ceramics: "Gốm sứ", concrete: "Bê tông", fabric: "Vải",
  fur: "Lông", glass: "Kính", gypsum: "Thạch cao", leather: "Da",
  liquid: "Chất lỏng", metal: "Kim loại", organics: "Hữu cơ", paper: "Giấy",
  plastic: "Nhựa", rattan: "Mây tre", stone: "Đá", wood: "Gỗ",
};

export function normalizeTaxonomyAliases(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",");
  const seen = new Set();
  const aliases = [];
  for (const item of list) {
    const alias = String(item || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const key = alias.toLocaleLowerCase("en");
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    aliases.push(alias);
    if (aliases.length >= 20) break;
  }
  return aliases;
}

let filterCache = new Map();
let categoryCache = new Map();

function cacheKey(assetType) {
  return normalizeAssetType(assetType);
}

export function clearMarketplaceTaxonomyCache() {
  filterCache = new Map();
  categoryCache = new Map();
}

export async function marketplaceCategorySnapshot(assetType, { includeInactive = false } = {}) {
  const normalized = cacheKey(assetType);
  const key = `${normalized}:${includeInactive ? "all" : "active"}`;
  const cached = categoryCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const categories = await MarketplaceCategory.find({ assetType: marketplaceAssetTypeFilter(normalized) })
    .sort({ position: 1 })
    .lean();
  let value = categories;
  if (!includeInactive) {
    const byId = new Map(categories.map((category) => [String(category._id), category]));
    const state = new Map();
    const effectiveActive = (category, visiting = new Set()) => {
      const id = String(category?._id || "");
      if (!category || category.isActive === false || visiting.has(id)) return false;
      if (state.has(id)) return state.get(id);
      const parent = category.parentId ? byId.get(String(category.parentId)) : null;
      const active = !parent || effectiveActive(parent, new Set([...visiting, id]));
      state.set(id, active);
      return active;
    };
    value = categories.filter((category) => effectiveActive(category));
  }
  categoryCache.set(key, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

export async function seedMarketplaceFilterOptions() {
  for (const assetType of ["model", "scene"]) {
    const filters = marketplaceFiltersFor(assetType);
    for (const [facet, options] of Object.entries(filters)) {
      for (let position = 0; position < options.length; position += 1) {
        const option = options[position];
        const seededAliasesVi = normalizeTaxonomyAliases(option.aliasesVi);
        const seededAliasesEn = normalizeTaxonomyAliases(option.aliasesEn);
        const saved = await MarketplaceFilterOption.findOneAndUpdate(
          { assetType, facet, value: option.value },
          {
            $setOnInsert: {
              assetType,
              facet,
              value: option.value,
              labelVi: LABELS_VI[option.value] || option.label,
              labelEn: option.label,
              aliasesVi: seededAliasesVi,
              aliasesEn: seededAliasesEn,
              hex: option.hex || "",
              iconKey: facet === "form" ? option.value : "",
              position: position + 1,
              isActive: true,
              catalogVersion: 1,
            },
          },
          { upsert: true, new: true },
        );
        const currentAliasesVi = normalizeTaxonomyAliases(saved.aliasesVi);
        const currentAliasesEn = normalizeTaxonomyAliases(saved.aliasesEn);
        const aliasesVi = normalizeTaxonomyAliases([...currentAliasesVi, ...seededAliasesVi]);
        const aliasesEn = normalizeTaxonomyAliases([...currentAliasesEn, ...seededAliasesEn]);
        if (
          JSON.stringify(aliasesVi) !== JSON.stringify(currentAliasesVi)
          || JSON.stringify(aliasesEn) !== JSON.stringify(currentAliasesEn)
        ) {
          await MarketplaceFilterOption.findByIdAndUpdate(saved._id, {
            $set: { aliasesVi, aliasesEn },
          });
        }
      }
    }
  }
  clearMarketplaceTaxonomyCache();
}

export async function marketplaceFilterSnapshot(assetType, { includeInactive = false } = {}) {
  const normalized = cacheKey(assetType);
  const key = `${normalized}:${includeInactive ? "all" : "active"}`;
  const cached = filterCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const query = { assetType: normalized };
  if (!includeInactive) query.isActive = true;
  let options = await MarketplaceFilterOption.find(query).sort({ position: 1 }).lean();
  if (!options.length) {
    await seedMarketplaceFilterOptions();
    options = await MarketplaceFilterOption.find(query).sort({ position: 1 }).lean();
  }
  const grouped = options.reduce((result, option) => {
    if (!result[option.facet]) result[option.facet] = [];
    result[option.facet].push({
      value: option.value,
      label: option.labelEn,
      labelEn: option.labelEn,
      labelVi: option.labelVi,
      aliasesVi: normalizeTaxonomyAliases(option.aliasesVi),
      aliasesEn: normalizeTaxonomyAliases(option.aliasesEn),
      ...(option.hex ? { hex: option.hex } : {}),
      ...(option.iconKey ? { iconKey: option.iconKey } : {}),
      isActive: option.isActive !== false,
      position: Number(option.position || 0),
    });
    return result;
  }, {});
  filterCache.set(key, { value: grouped, expiresAt: Date.now() + 60_000 });
  return grouped;
}

export async function resolveMarketplaceCategory(sourceCategoryId, assetType = "model", { requireLeaf = false, includeInactive = false } = {}) {
  const value = String(sourceCategoryId || "").trim();
  if (!value) return null;
  const categories = await marketplaceCategorySnapshot(assetType, { includeInactive });
  const category = categories.find((item) => (
    String(item.sourceCategoryId || "") === value
    || String(item.slug || "").toLowerCase() === value.toLowerCase()
  ));
  if (!category) return null;
  if (requireLeaf && categories.some((item) => (
    String(item.parentId || "") === String(category._id)
    || String(item.parentSourceCategoryId || "") === String(category.sourceCategoryId || "")
  ))) return null;
  const parent = category.parentId
    ? categories.find((item) => String(item._id) === String(category.parentId)) || null
    : categories.find((item) => String(item.sourceCategoryId || "") === String(category.parentSourceCategoryId || "")) || null;
  return { category, parent };
}

export async function validateMarketplaceTaxonomy(metadata = {}, { currentModel = null } = {}) {
  const assetType = normalizeAssetType(metadata.assetType);
  let resolved = await resolveMarketplaceCategory(metadata.sourceCategoryId, assetType, { requireLeaf: true });
  const errors = [];
  const unchangedCategory = String(metadata.sourceCategoryId || "") === String(currentModel?.categorySourceId || "");
  if (!resolved && unchangedCategory) {
    resolved = await resolveMarketplaceCategory(metadata.sourceCategoryId, assetType, { includeInactive: true });
  }
  if (!resolved) errors.push({ field: "sourceCategoryId", code: "invalid_leaf" });
  const filters = await marketplaceFilterSnapshot(assetType);
  const fieldMap = { styles: "style", renderers: "render", forms: "form", colors: "color", materials: "material" };
  for (const [field, facet] of Object.entries(fieldMap)) {
    if (assetType === "scene" && ["forms", "colors", "materials"].includes(field)) continue;
    const allowed = new Set((filters[facet] || []).map((item) => item.value));
    const existing = new Set((currentModel?.[field] || []).map(String));
    const unknown = (metadata[field] || []).filter((value) => !allowed.has(value) && !existing.has(String(value)));
    if (unknown.length) errors.push({ field, code: "inactive_or_unknown", values: unknown });
  }
  return { resolved, errors };
}

export async function hydrateMarketplaceCategoryRefs(models = []) {
  const list = Array.isArray(models) ? models : [models];
  const keysByType = new Map();
  list.forEach((model) => {
    const assetType = normalizeAssetType(model?.assetType);
    if (!keysByType.has(assetType)) keysByType.set(assetType, new Set());
    if (model?.categorySourceId) keysByType.get(assetType).add(String(model.categorySourceId));
    if (model?.parentCategorySourceId) keysByType.get(assetType).add(String(model.parentCategorySourceId));
  });
  const categoryMaps = new Map();
  for (const [assetType, keys] of keysByType.entries()) {
    const categories = keys.size
      ? (await marketplaceCategorySnapshot(assetType, { includeInactive: true }))
        .filter((category) => keys.has(String(category.sourceCategoryId)))
      : [];
    categoryMaps.set(assetType, new Map(categories.map((category) => [String(category.sourceCategoryId), category])));
  }
  list.forEach((model) => {
    const map = categoryMaps.get(normalizeAssetType(model?.assetType));
    if (!map) return;
    model.category = map.get(String(model.categorySourceId || "")) || null;
    model.parentCategory = map.get(String(model.parentCategorySourceId || "")) || null;
  });
  return models;
}
