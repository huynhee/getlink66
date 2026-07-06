import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

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
    source: {
      provider: { type: String, default: "drive", index: true },
      modelId: { type: String, required: true, trim: true },
      slug: { type: String, default: "", trim: true },
      categoryId: { type: String, default: "", trim: true },
      syncedAt: Date,
    },
    title: { type: String, required: true, trim: true, index: true },
    slug: { type: String, required: true, trim: true, lowercase: true, unique: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceCategory", index: true },
    parentCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceCategory", index: true },
    categorySourceId: { type: String, default: "", trim: true, index: true },
    coverImage: { type: previewImageSchema, default: () => ({}) },
    previewImages: { type: [previewImageSchema], default: [] },
    driveFolderId: { type: String, default: "", trim: true, index: true },
    driveFolderName: { type: String, default: "", trim: true },
    driveSignature: { type: String, default: "", trim: true, index: true },
    lastDriveScanAt: Date,
    lastDriveChangeAt: Date,
    styles: { type: [String], default: [], index: true },
    renderers: { type: [String], default: [], index: true },
    forms: { type: [String], default: [], index: true },
    colors: { type: [String], default: [], index: true },
    materials: { type: [String], default: [], index: true },
    renderer: { type: String, default: "" },
    sizeText: { type: String, default: "" },
    metadataStatus: {
      type: String,
      enum: ["complete", "incomplete"],
      default: "incomplete",
      index: true,
    },
    metadataMissingFields: { type: [String], default: [] },
    accessType: {
      type: String,
      enum: ["free", "member"],
      default: "member",
      index: true,
    },
    isPublished: { type: Boolean, default: false, index: true },
    fileStatus: {
      type: String,
      enum: ["missing", "pending_upload", "ready", "failed"],
      default: "missing",
      index: true,
    },
    storageProvider: {
      type: String,
      enum: ["google_drive", "b2", "r2", "local", "telegram", ""],
      default: "",
      index: true,
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
    downloadCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

marketplaceModelSchema.index(
  { "source.provider": 1, "source.modelId": 1 },
  { unique: true },
);
marketplaceModelSchema.index({ title: "text", slug: "text" }, { name: "marketplace_model_text" });
marketplaceModelSchema.index({ isPublished: 1, fileStatus: 1, accessType: 1 });
marketplaceModelSchema.index({ createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceModel")
  : mongoose.model("MarketplaceModel", marketplaceModelSchema);
