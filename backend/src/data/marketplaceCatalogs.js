import { MARKETPLACE_FILTERS } from "./marketplaceFilters.js";

export const MARKETPLACE_ASSET_TYPES = ["model", "scene"];

export function normalizeAssetType(value, fallback = "model") {
  return String(value || "").trim().toLowerCase() === "scene" ? "scene" : fallback;
}

export function marketplaceAssetTypeFilter(value) {
  return normalizeAssetType(value) === "scene" ? "scene" : { $ne: "scene" };
}

export function marketplaceDownloadCost(assetType) {
  return normalizeAssetType(assetType) === "scene" ? 5 : 1;
}

export const SCENE_FILTERS = {
  style: [
    { value: "modern", label: "Modern" },
    { value: "industrial", label: "Industrial" },
    { value: "neoclassic", label: "Neoclassic" },
    { value: "classic", label: "Classic" },
    { value: "luxury", label: "Luxury" },
    { value: "indochine", label: "Indochine" },
    { value: "japanese", label: "Japanese" },
    { value: "wabi-sabi", label: "Wabi-sabi" },
    { value: "french", label: "French" },
    { value: "modern-classic", label: "Modern Classic" },
    { value: "other", label: "Other" },
  ],
  render: MARKETPLACE_FILTERS.render,
};

export function marketplaceFiltersFor(assetType) {
  return normalizeAssetType(assetType) === "scene" ? SCENE_FILTERS : MARKETPLACE_FILTERS;
}

const ROOTS = [
  ["architecture", "Architecture", "Kiến trúc"],
  ["exterior", "Exterior", "Ngoại thất", [
    ["landscape", "Landscape", "Cảnh quan"],
    ["garden", "Garden", "Sân vườn"],
    ["pool", "Pool", "Hồ bơi"],
    ["balcony", "Balcony", "Ban công"],
  ]],
  ["house-space", "House Space", "Không gian nhà ở", [
    ["living-room", "Living Room", "Phòng khách"],
    ["bedroom", "Bedroom", "Phòng ngủ"],
    ["bathroom", "Bathroom", "Phòng tắm"],
    ["kitchen", "Kitchen", "Bếp"],
    ["dining-room", "Dining Room", "Phòng ăn"],
    ["room", "Room", "Phòng khác"],
    ["altar-room", "Altar Room", "Phòng thờ"],
    ["kid-room", "Kid Room", "Phòng trẻ em"],
    ["work-room", "Work Room", "Phòng làm việc"],
    ["dressing-room", "Dressing Room", "Phòng thay đồ"],
    ["entertainment-room", "Entertainment Room", "Phòng giải trí"],
  ]],
  ["restaurant-coffee", "Restaurant & Coffee", "Nhà hàng & Cà phê"],
  ["office-space", "Office Space", "Văn phòng"],
  ["hotel-space", "Hotel Space", "Khách sạn"],
  ["gym-sport", "Gym & Sport", "Gym & Thể thao"],
  ["shop", "Shop", "Cửa hàng"],
  ["showroom", "Showroom", "Phòng trưng bày"],
  ["spa", "Spa", "Spa"],
  ["clinic", "Clinic", "Phòng khám"],
  ["bar", "Bar", "Bar"],
];

export const DEFAULT_SCENE_CATEGORIES = ROOTS.flatMap(([id, titleEn, title, children], rootIndex) => {
  const root = { id, titleEn, title, slug: id, position: rootIndex + 1, parentId: "" };
  return [root, ...(children || []).map(([childId, childTitleEn, childTitle], childIndex) => ({
    id: childId,
    titleEn: childTitleEn,
    title: childTitle,
    slug: childId,
    position: childIndex + 1,
    parentId: id,
  }))];
});
