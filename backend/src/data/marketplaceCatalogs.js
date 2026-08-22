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
    { value: "japanese", label: "Japanese", aliasesEn: ["Japan Style"] },
    { value: "wabi-sabi", label: "Wabi-sabi" },
    { value: "french", label: "French" },
    { value: "modern-classic", label: "Modern Classic" },
    { value: "ethnic", label: "Ethnic" },
    { value: "taiwan-style", label: "Taiwan Style" },
    { value: "scandinavian", label: "Scandinavian" },
    { value: "rustic", label: "Rustic" },
    { value: "color-block", label: "Color Block" },
    { value: "tropical", label: "Tropical" },
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
    ["building", "Building", "Công trình", 0],
    ["landscape", "Landscape", "Cảnh quan"],
    ["garden", "Garden", "Sân vườn"],
    ["pool", "Pool", "Hồ bơi"],
    ["balcony", "Balcony", "Ban công"],
  ]],
  ["house-space", "House Space", "Không gian nhà ở", [
    ["full-apartment", "Full Apartment", "Căn hộ hoàn chỉnh", 0],
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
  ["restaurant-coffee", "Restaurant & Coffee", "Nhà hàng & Cà phê", [
    ["restaurant", "Restaurant", "Nhà hàng"],
    ["coffee-shop", "Coffee Shop", "Quán cà phê"],
    ["tea-house", "Tea House", "Quán trà"],
    ["bakery", "Bakery", "Tiệm bánh"],
    ["fast-food", "Fast Food", "Đồ ăn nhanh"],
  ]],
  ["office-space", "Office Space", "Văn phòng", [
    ["reception", "Reception", "Lễ tân"],
    ["meeting-room", "Meeting Room", "Phòng họp"],
    ["open-office", "Open Office", "Văn phòng mở"],
    ["director-room", "Director Room", "Phòng giám đốc"],
    ["co-working-space", "Co-working Space", "Không gian làm việc chung"],
  ]],
  ["hotel-space", "Hotel Space", "Khách sạn"],
  ["gym-sport", "Gym & Sport", "Gym & Thể thao", [
    ["gym", "Gym", "Phòng gym"],
    ["yoga-room", "Yoga Room", "Phòng yoga"],
    ["fitness-center", "Fitness Center", "Trung tâm thể hình"],
    ["sport-hall", "Sport Hall", "Nhà thi đấu"],
    ["swimming-facility", "Swimming Facility", "Khu bơi lội"],
  ]],
  ["shop", "Shop", "Cửa hàng", [
    ["fashion-store", "Fashion Store", "Cửa hàng thời trang"],
    ["furniture-store", "Furniture Store", "Cửa hàng nội thất"],
    ["cosmetic-shop", "Cosmetic Shop", "Cửa hàng mỹ phẩm"],
    ["jewelry-store", "Jewelry Store", "Cửa hàng trang sức"],
    ["retail-store", "Retail Store", "Cửa hàng bán lẻ"],
  ]],
  ["showroom", "Showroom", "Phòng trưng bày", [
    ["furniture-showroom", "Furniture Showroom", "Showroom nội thất"],
    ["car-showroom", "Car Showroom", "Showroom ô tô"],
    ["material-showroom", "Material Showroom", "Showroom vật liệu"],
    ["product-display", "Product Display", "Trưng bày sản phẩm"],
  ]],
  ["spa", "Spa", "Spa", [
    ["massage-room", "Massage Room", "Phòng massage"],
    ["facial-room", "Facial Room", "Phòng chăm sóc da"],
    ["waiting-area", "Waiting Area", "Khu chờ"],
    ["luxury-spa", "Luxury Spa", "Spa cao cấp"],
  ]],
  ["clinic", "Clinic", "Phòng khám", [
    ["dental-clinic", "Dental Clinic", "Phòng khám nha khoa"],
    ["cosmetic-clinic", "Cosmetic Clinic", "Phòng khám thẩm mỹ"],
    ["examination-room", "Examination Room", "Phòng khám bệnh"],
    ["reception-area", "Reception Area", "Khu vực lễ tân"],
  ]],
  ["bar", "Bar", "Bar", [
    ["lounge-bar", "Lounge Bar", "Lounge bar"],
    ["wine-bar", "Wine Bar", "Quầy rượu vang"],
    ["pub", "Pub", "Quán pub"],
    ["rooftop-bar", "Rooftop Bar", "Bar sân thượng"],
    ["cocktail-bar", "Cocktail Bar", "Quầy cocktail"],
  ]],
];

export const DEFAULT_SCENE_CATEGORIES = ROOTS.flatMap(([id, titleEn, title, children], rootIndex) => {
  const root = { id, titleEn, title, slug: id, position: rootIndex + 1, parentId: "" };
  return [root, ...(children || []).map(([childId, childTitleEn, childTitle, declaredPosition], childIndex) => ({
    id: childId,
    titleEn: childTitleEn,
    title: childTitle,
    slug: childId,
    position: Number.isFinite(declaredPosition) ? declaredPosition : childIndex + 1,
    parentId: id,
  }))];
});
