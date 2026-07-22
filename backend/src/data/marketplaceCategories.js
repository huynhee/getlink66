import { marketplaceCategoryLabelVi } from "./marketplaceCategoryLabelsVi.js";

const CATEGORY_TREE = [
  ["102", "Architecture", [
    ["256", "Barbecue and grill"],
    ["11", "Building"],
    ["251", "Environment elements"],
    ["252", "Facade element"],
    ["257", "Fence"],
    ["250", "Other"],
    ["259", "Paving"],
    ["248", "Playground"],
    ["253", "Urban environment"],
  ]],
  ["87", "Bathroom", [
    ["92", "Bathroom accessories"],
    ["90", "Bathroom furniture"],
    ["89", "Bathtub"],
    ["91", "Faucet"],
    ["162", "Shower"],
    ["88", "Toilet and Bidet"],
    ["174", "Towel rail"],
    ["5", "Wash basin"],
  ]],
  ["75", "Childroom", [
    ["76", "Bed"],
    ["53", "Full furniture set"],
    ["80", "Miscellaneous"],
    ["77", "Table + Chair"],
    ["79", "Toy"],
    ["78", "Wardrobe"],
  ]],
  ["103", "Decoration", [
    ["182", "3D panel"],
    ["122", "Books"],
    ["128", "Carpets"],
    ["49", "Curtain"],
    ["15", "Decorative plaster"],
    ["130", "Decorative set"],
    ["105", "Frame"],
    ["104", "Mirror"],
    ["14", "Other decorative objects"],
    ["124", "Pillows"],
    ["16", "Sculpture"],
    ["106", "Vase"],
    ["246", "Watches & Clocks"],
    ["138", "Clothes and Footwear"],
  ]],
  ["2", "Furniture", [
    ["98", "Arm chair"],
    ["51", "Bed"],
    ["22", "Chair"],
    ["266", "Console"],
    ["262", "Dressing table"],
    ["263", "Hallway"],
    ["271", "Headboards"],
    ["55", "Office furniture"],
    ["29", "Other"],
    ["99", "Other soft seating"],
    ["264", "Rack"],
    ["52", "Sideboard & Chest of drawer"],
    ["20", "Sofa"],
    ["21", "Table"],
    ["100", "Table + Chair"],
    ["265", "TV Wall"],
    ["19", "Wardrobe & Display cabinets"],
  ]],
  ["71", "Kitchen", [
    ["150", "Faucet"],
    ["114", "Food and drinks"],
    ["50", "Kitchen"],
    ["73", "Kitchen appliance"],
    ["74", "Other kitchen accessories"],
    ["146", "Sink"],
    ["17", "Tableware"],
  ]],
  ["81", "Lighting", [
    ["260", "Ceiling lamp"],
    ["83", "Floor lamp"],
    ["267", "Neon"],
    ["4", "Pendant light"],
    ["85", "Spot light"],
    ["86", "Street lighting"],
    ["84", "Table lamp"],
    ["201", "Technical lighting"],
    ["82", "Wall light"],
  ]],
  ["56", "Materials", [
    ["63", "Glass"],
    ["59", "Leather"],
    ["66", "Liquid"],
    ["58", "Metal"],
    ["68", "Miscellaneous"],
    ["60", "Plastic"],
    ["61", "Stone"],
    ["69", "Tile"],
    ["57", "Wood"],
  ]],
  ["94", "Other Models", [
    ["95", "Beauty salon"],
    ["108", "Billiards"],
    ["8", "Creature"],
    ["30", "Doors"],
    ["31", "Fireplace"],
    ["10", "Miscellaneous"],
    ["67", "Musical instrument"],
    ["194", "Radiator"],
    ["96", "Restaurant"],
    ["48", "Shop"],
    ["97", "Sports"],
    ["32", "Staircase"],
    ["26", "Weapon"],
    ["112", "Windows"],
  ]],
  ["206", "Plants", [
    ["218", "Bouquet"],
    ["236", "Bush"],
    ["230", "Fitowall"],
    ["239", "Grass"],
    ["227", "Indoor"],
    ["242", "Outdoor"],
    ["233", "Tree"],
  ]],
  ["109", "Scripts", [
    ["110", "Scripts"],
  ]],
  ["6", "Technology", [
    ["120", "Audio tech"],
    ["24", "Household appliance"],
    ["27", "Miscellaneous"],
    ["23", "PC & other electronics"],
    ["118", "Phones"],
    ["116", "TV"],
  ]],
  ["33", "Textures", [
    ["65", "Brick"],
    ["40", "Fabric"],
    ["35", "Floor coverings"],
    ["46", "HDRI"],
    ["64", "Leather"],
    ["38", "Metal"],
    ["42", "Miscellaneous"],
    ["41", "Natural materials"],
    ["47", "Panorama"],
    ["70", "Rug"],
    ["39", "Stone"],
    ["62", "Tile"],
    ["37", "Wall covering"],
    ["34", "Wood"],
  ]],
  ["25", "Transport", [
    ["269", "Air Transport"],
    ["268", "Ground Transport"],
    ["270", "Water Transport"],
  ]],
];

function slugify(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function flattenCategoryTree() {
  const usedSlugs = new Set();

  function uniqueSlug(title, parentSlug = "") {
    const base = slugify(title) || "category";
    let slug = usedSlugs.has(base) && parentSlug ? `${parentSlug}-${base}` : base;
    let suffix = 2;
    while (usedSlugs.has(slug)) {
      slug = `${base}-${suffix}`;
      suffix += 1;
    }
    usedSlugs.add(slug);
    return slug;
  }

  return CATEGORY_TREE.flatMap(([id, titleEn, children], parentIndex) => {
    const parentSlug = uniqueSlug(titleEn);
    const parent = {
      id,
      parentId: null,
      title: marketplaceCategoryLabelVi(titleEn),
      titleEn,
      slug: parentSlug,
      position: parentIndex + 1,
    };
    const childItems = children.map(([childId, childTitleEn], childIndex) => ({
      id: childId,
      parentId: id,
      title: marketplaceCategoryLabelVi(childTitleEn),
      titleEn: childTitleEn,
      slug: uniqueSlug(childTitleEn, parentSlug),
      position: childIndex + 1,
    }));
    return [parent, ...childItems];
  });
}

export const DEFAULT_MARKETPLACE_CATEGORIES = flattenCategoryTree();
