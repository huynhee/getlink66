import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";
import { normalizeMarketplaceTitle } from "../utils/marketplaceSort.js";

const previewImageSchema = new mongoose.Schema(
  {
    driveFileId: { type: String, default: "", trim: true },
    fileName: { type: String, default: "", trim: true },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
    size: { type: Number, default: 0, min: 0 },
    alt: { type: String, default: "" },
  },
  { _id: false },
);

const marketplaceModelSchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], default: "model", index: true },
    source: {
      provider: { type: String, default: "drive" },
      modelId: { type: String, required: true, trim: true },
      assetId: { type: String, default: "", trim: true },
      slug: { type: String, default: "", trim: true },
      categoryId: { type: String, default: "", trim: true },
      syncedAt: Date,
    },
    title: { type: String, required: true, trim: true },
    titleSort: { type: String, default: "", trim: true },
    slug: { type: String, required: true, trim: true, lowercase: true },
    // Legacy ObjectIds stay readable during migration. New writes use stable
    // Atlas taxonomy keys below so no cross-database populate is required.
    categoryId: { type: mongoose.Schema.Types.ObjectId },
    parentCategoryId: { type: mongoose.Schema.Types.ObjectId },
    categorySourceId: { type: String, default: "", trim: true },
    parentCategorySourceId: { type: String, default: "", trim: true },
    coverImage: { type: previewImageSchema, default: () => ({}) },
    previewImages: { type: [previewImageSchema], default: [] },
    driveFolderId: { type: String, default: "", trim: true, index: true },
    driveFolderName: { type: String, default: "", trim: true },
    driveSignature: { type: String, default: "", trim: true },
    lastDriveScanAt: Date,
    lastDriveChangeAt: Date,
    styles: { type: [String], default: [] },
    renderers: { type: [String], default: [] },
    forms: { type: [String], default: [] },
    colors: { type: [String], default: [] },
    materials: { type: [String], default: [] },
    renderer: { type: String, default: "" },
    metadataStatus: {
      type: String,
      enum: ["complete", "incomplete"],
      default: "incomplete",
    },
    metadataMissingFields: { type: [String], default: [] },
    accessType: {
      type: String,
      enum: ["free", "member"],
      default: "member",
    },
    isPublished: { type: Boolean, default: false },
    fileStatus: {
      type: String,
      enum: ["missing", "pending_upload", "ready", "failed"],
      default: "missing",
    },
    storageProvider: {
      type: String,
      enum: ["google_drive", "b2", "r2", "local", "telegram", ""],
      default: "",
    },
    storageKey: { type: String, default: "" },
    driveFileId: { type: String, default: "" },
    telegramFileRef: { type: String, default: "" },
    archiveExt: { type: String, default: "zip", trim: true },
    fileSize: { type: Number, default: 0, min: 0 },
    sha256: { type: String, default: "" },
    metadataDriveFileId: { type: String, default: "", trim: true },
    metadataFileName: { type: String, default: "", trim: true },
    metadataSize: { type: Number, default: 0, min: 0 },
    metadataSourceModelId: { type: String, default: "", trim: true },
    metadataHash: { type: String, default: "", trim: true },
    metadataRevision: { type: Number, default: 0, min: 0 },
    metadataDriveVersion: { type: String, default: "", trim: true },
    metadataModifiedTime: Date,
    syncStatus: {
      type: String,
      enum: ["synced", "syncing", "conflict", "error", "missing"],
      default: "missing",
    },
    syncError: { type: String, default: "" },
    desiredPublished: { type: Boolean, default: false },
    publicationBlockers: { type: [String], default: [] },
    downloadCount: { type: Number, default: 0, min: 0 },
    discoveryStatus: {
      type: String,
      enum: ["pending", "indexed", "error"],
      default: "pending",
    },
    discoveryIndexedAt: Date,
    discoveryError: { type: String, default: "" },
    discoveryRevision: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

marketplaceModelSchema.pre("validate", function normalizeTitleForSorting() {
  this.titleSort = normalizeMarketplaceTitle(this.title);
});

marketplaceModelSchema.index({ assetType: 1, slug: 1 }, { unique: true });
marketplaceModelSchema.index(
  { assetType: 1, "source.provider": 1, "source.assetId": 1 },
  { unique: true, partialFilterExpression: { "source.assetId": { $type: "string", $gt: "" } } },
);
marketplaceModelSchema.index({ title: "text", slug: "text" }, { name: "marketplace_model_text" });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, downloadCount: -1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, titleSort: 1, _id: 1 });
marketplaceModelSchema.index({ assetType: 1, categorySourceId: 1, isPublished: 1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, parentCategorySourceId: 1, isPublished: 1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, accessType: 1, isPublished: 1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, styles: 1, isPublished: 1 });
marketplaceModelSchema.index({ assetType: 1, renderers: 1, isPublished: 1 });
marketplaceModelSchema.index({ assetType: 1, forms: 1, isPublished: 1 });
marketplaceModelSchema.index({ assetType: 1, colors: 1, isPublished: 1 });
marketplaceModelSchema.index({ assetType: 1, materials: 1, isPublished: 1 });
marketplaceModelSchema.index({ assetType: 1, syncStatus: 1, updatedAt: 1 });
marketplaceModelSchema.index({ assetType: 1, discoveryStatus: 1, updatedAt: 1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceModel")
  : marketplaceModel("MarketplaceModel", marketplaceModelSchema);
