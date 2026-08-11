import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";
import { marketplaceSourceIdNumber, normalizeMarketplaceTitle } from "../utils/marketplaceSort.js";

const previewImageSchema = new mongoose.Schema(
  {
    driveFileId: { type: String, default: "", trim: true },
    driveVersion: { type: String, default: "", trim: true },
    modifiedTime: Date,
    fileName: { type: String, default: "", trim: true },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
    size: { type: Number, default: 0, min: 0 },
    alt: { type: String, default: "" },
  },
  { _id: false },
);

const coverCacheSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["missing", "queued", "processing", "ready", "error"],
      default: "missing",
    },
    key: { type: String, default: "", trim: true },
    sourceFingerprint: { type: String, default: "", trim: true },
    width: { type: Number, default: 0, min: 0 },
    height: { type: Number, default: 0, min: 0 },
    size: { type: Number, default: 0, min: 0 },
    mimeType: { type: String, default: "", trim: true },
    generatedAt: Date,
    error: { type: String, default: "" },
    attempts: { type: Number, default: 0, min: 0 },
    nextRetryAt: Date,
    lockedAt: Date,
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
    sourceAssetIdSort: { type: Number, default: 0, min: 0 },
    title: { type: String, required: true, trim: true },
    titleSort: { type: String, default: "", trim: true },
    searchTitle: { type: String, default: "", trim: true },
    searchTaxonomy: { type: String, default: "", trim: true },
    searchTokens: { type: [String], default: [] },
    searchVersion: { type: Number, default: 0, min: 0 },
    searchDocumentHash: { type: String, default: "", trim: true },
    searchStatus: {
      type: String,
      enum: ["pending", "indexed", "error"],
      default: "pending",
      index: true,
    },
    searchIndexedAt: Date,
    searchError: { type: String, default: "" },
    slug: { type: String, required: true, trim: true, lowercase: true },
    // Legacy ObjectIds stay readable during migration. New writes use stable
    // Atlas taxonomy keys below so no cross-database populate is required.
    categoryId: { type: mongoose.Schema.Types.ObjectId },
    parentCategoryId: { type: mongoose.Schema.Types.ObjectId },
    categorySourceId: { type: String, default: "", trim: true },
    parentCategorySourceId: { type: String, default: "", trim: true },
    coverImage: { type: previewImageSchema, default: () => ({}) },
    previewImages: { type: [previewImageSchema], default: [] },
    coverCache: { type: coverCacheSchema, default: () => ({ status: "missing" }) },
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
    mainMaxFile: { type: String, default: "", trim: true },
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
    deletionStatus: {
      type: String,
      enum: ["active", "deleting", "trashed", "delete_error", "purging", "purge_error", "purged"],
      default: "active",
      index: true,
    },
    deletedAt: Date,
    purgeAt: Date,
    purgedAt: Date,
    deletionError: { type: String, default: "" },
    restoreDesiredPublished: Boolean,
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
  this.sourceAssetIdSort = marketplaceSourceIdNumber(
    this.source?.assetId || this.metadataSourceModelId || this.source?.modelId,
  );
  const searchFields = [
    "title",
    "slug",
    "categorySourceId",
    "parentCategorySourceId",
    "renderer",
    "styles",
    "renderers",
    "forms",
    "colors",
    "materials",
  ];
  if (!this.isNew && searchFields.some((field) => this.isModified(field))) {
    this.searchStatus = "pending";
    this.searchError = "";
  }
});

marketplaceModelSchema.index({ assetType: 1, slug: 1 }, { unique: true });
marketplaceModelSchema.index(
  { assetType: 1, "source.provider": 1, "source.assetId": 1 },
  { unique: true, partialFilterExpression: { "source.assetId": { $type: "string", $gt: "" } } },
);
marketplaceModelSchema.index(
  { searchTitle: "text", searchTaxonomy: "text", slug: "text" },
  {
    name: "marketplace_model_bilingual_text",
    default_language: "none",
    weights: { searchTitle: 10, searchTaxonomy: 6, slug: 2 },
  },
);
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, sourceAssetIdSort: -1, _id: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, downloadCount: -1, createdAt: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, titleSort: 1, _id: 1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, accessType: -1, createdAt: -1, _id: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, accessType: -1, createdAt: 1, _id: 1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, accessType: -1, sourceAssetIdSort: -1, createdAt: -1, _id: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, accessType: -1, downloadCount: -1, createdAt: -1, _id: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, accessType: -1, titleSort: 1, _id: 1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, accessType: -1, titleSort: -1, _id: -1 });
marketplaceModelSchema.index({ assetType: 1, isPublished: 1, metadataStatus: 1, fileStatus: 1, searchTokens: 1 });
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
marketplaceModelSchema.index({ assetType: 1, searchStatus: 1, updatedAt: 1 });
marketplaceModelSchema.index({ deletionStatus: 1, purgeAt: 1 });
marketplaceModelSchema.index({ "coverCache.status": 1, "coverCache.nextRetryAt": 1, "coverCache.lockedAt": 1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceModel")
  : marketplaceModel("MarketplaceModel", marketplaceModelSchema);
