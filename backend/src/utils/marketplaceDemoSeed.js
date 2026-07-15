import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceModel from "../models/MarketplaceModel.js";

const DEMO_NAMES = [
  "Amoebe Armchair",
  "Modern Lounge Chair",
  "Nordic Dining Chair",
  "Soft Modular Sofa",
  "Oak Coffee Table",
  "Boucle Accent Chair",
  "Minimal Sideboard",
  "Curved Reading Chair",
  "Studio Floor Lamp",
  "Round Dining Table",
  "Contemporary Console",
  "Relax Lounge Collection",
];

export async function seedMarketplaceDemoModels(options = {}) {
  if (process.env.NODE_ENV === "production") return { created: 0, skipped: true };
  const count = Math.min(61, Math.max(1, Number(options.count || 61)));
  const category = await MarketplaceCategory.findOne({ assetType: "model", sourceProvider: "3dsky", sourceCategoryId: "98" });
  const parent = await MarketplaceCategory.findOne({ assetType: "model", sourceProvider: "3dsky", sourceCategoryId: "2" });
  if (!category || !parent) throw new Error("Marketplace demo seed requires initialized categories.");

  for (let index = 0; index < count; index += 1) {
    const number = String(index + 1).padStart(3, "0");
    const sourceModelId = `demo-${number}`;
    const baseName = DEMO_NAMES[index % DEMO_NAMES.length];
    const title = index < DEMO_NAMES.length ? baseName : `${baseName} ${Math.floor(index / DEMO_NAMES.length) + 1}`;
    const slug = `demo-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${number}`;
    const renderer = index % 3 === 0 ? "Vray" : "Corona";
    await MarketplaceModel.findOneAndUpdate(
      { "source.provider": "demo", "source.modelId": sourceModelId },
      {
        $set: {
          assetType: "model",
          source: {
            provider: "demo",
            modelId: sourceModelId,
            assetId: sourceModelId,
            slug,
            categoryId: "98",
            syncedAt: new Date(),
          },
          title,
          slug,
          categorySourceId: "98",
          parentCategorySourceId: "2",
          coverImage: {
            driveFileId: `demo:cover:${index % DEMO_NAMES.length}`,
            fileName: "3dipl-d.jpg",
            width: 1200,
            height: 1200,
            size: 77707,
            alt: title,
          },
          previewImages: Array.from({ length: 4 }, (_, previewIndex) => ({
            driveFileId: `demo:preview:${index % DEMO_NAMES.length}:${previewIndex + 1}`,
            fileName: `preview-${previewIndex + 1}.jpg`,
            width: 1200,
            height: 1200,
            size: 77707,
            alt: `${title} - ${previewIndex + 1}`,
          })),
          styles: [index % 4 === 0 ? "classic" : "modern"],
          renderers: [renderer.toLowerCase()],
          forms: [index % 5 === 0 ? "bioform" : index % 2 === 0 ? "round" : "rectangle"],
          colors: [index % 3 === 0 ? "gray" : index % 3 === 1 ? "beige" : "green"],
          materials: [index % 2 === 0 ? "fabric" : "wood"],
          renderer,
          metadataStatus: "complete",
          metadataMissingFields: [],
          accessType: index % 4 === 0 ? "free" : "member",
          desiredPublished: true,
          isPublished: true,
          fileStatus: "ready",
          storageProvider: "",
          archiveExt: "zip",
          fileSize: 18_000_000 + index * 1_250_000,
          syncStatus: "synced",
          syncError: "",
          publicationBlockers: [],
          downloadCount: Math.max(0, 240 - index * 3),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  return { created: count, skipped: false };
}

const DEMO_SCENE_NAMES = [
  "Modern Living Room", "Luxury Penthouse", "Wabi-sabi Bedroom", "Industrial Coffee Shop",
  "Neoclassic Villa", "Japanese Garden", "Contemporary Office", "Boutique Hotel Lobby",
  "Modern Kitchen", "French Style Restaurant", "Minimal Spa", "Luxury Showroom",
];

export async function seedMarketplaceDemoScenes(options = {}) {
  if (process.env.NODE_ENV === "production") return { created: 0, skipped: true };
  const count = Math.min(60, Math.max(6, Number(options.count || 18)));
  const category = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "living-room" });
  const parent = await MarketplaceCategory.findOne({ assetType: "scene", sourceCategoryId: "house-space" });
  if (!category || !parent) throw new Error("Scene demo seed requires initialized scene categories.");
  const styles = ["modern", "luxury", "wabi-sabi", "industrial", "neoclassic", "japanese"];

  for (let index = 0; index < count; index += 1) {
    const number = String(index + 1).padStart(3, "0");
    const assetId = `demo-scene-${number}`;
    const baseName = DEMO_SCENE_NAMES[index % DEMO_SCENE_NAMES.length];
    const title = index < DEMO_SCENE_NAMES.length ? baseName : `${baseName} ${Math.floor(index / DEMO_SCENE_NAMES.length) + 1}`;
    const slug = `${baseName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${number}`;
    const renderer = index % 2 ? "Corona" : "V-Ray";
    await MarketplaceModel.findOneAndUpdate(
      { assetType: "scene", "source.provider": "demo", "source.assetId": assetId },
      { $set: {
        assetType: "scene",
        source: { provider: "demo", modelId: assetId, assetId, slug, categoryId: "living-room", syncedAt: new Date() },
        title,
        slug,
        categorySourceId: "living-room",
        parentCategorySourceId: "house-space",
        coverImage: { driveFileId: `demo:cover:${index % DEMO_NAMES.length}`, fileName: "preview-1.jpg", width: 1200, height: 1200, size: 77707, alt: title },
        previewImages: Array.from({ length: 4 }, (_, previewIndex) => ({ driveFileId: `demo:preview:${index % DEMO_NAMES.length}:${previewIndex + 1}`, fileName: `preview-${previewIndex + 1}.jpg`, width: 1200, height: 1200, size: 77707, alt: `${title} - ${previewIndex + 1}` })),
        styles: [styles[index % styles.length]],
        renderers: [renderer === "V-Ray" ? "vray" : "corona"],
        forms: [], colors: [], materials: [], renderer,
        metadataStatus: "complete", metadataMissingFields: [],
        accessType: index % 4 === 0 ? "free" : "member",
        desiredPublished: true, isPublished: true, fileStatus: "ready",
        storageProvider: "", archiveExt: "zip", fileSize: 120_000_000 + index * 8_500_000,
        syncStatus: "synced", syncError: "", publicationBlockers: [], downloadCount: Math.max(0, 180 - index * 4),
      } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  return { created: count, skipped: false };
}
