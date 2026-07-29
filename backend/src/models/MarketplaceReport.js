import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

export const MARKETPLACE_REPORT_REASONS = [
  "download_failed",
  "archive_corrupt",
  "wrong_asset",
  "missing_files",
  "preview_incorrect",
  "metadata_incorrect",
  "duplicate",
  "other",
];

export const MARKETPLACE_REPORT_STATUSES = [
  "open",
  "investigating",
  "resolved",
  "dismissed",
];

const marketplaceReportSchema = new mongoose.Schema(
  {
    modelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketplaceModel",
      required: true,
      index: true,
    },
    assetType: {
      type: String,
      enum: ["model", "scene"],
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      enum: MARKETPLACE_REPORT_REASONS,
      required: true,
      index: true,
    },
    message: { type: String, default: "", maxlength: 1000, trim: true },
    status: {
      type: String,
      enum: MARKETPLACE_REPORT_STATUSES,
      default: "open",
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    adminNote: { type: String, default: "", maxlength: 1000, trim: true },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId },
    resolvedAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

marketplaceReportSchema.index(
  { userId: 1, modelId: 1 },
  {
    unique: true,
    partialFilterExpression: { isActive: true },
    name: "one_active_marketplace_report_per_user_asset",
  },
);
marketplaceReportSchema.index({ assetType: 1, isActive: 1, updatedAt: -1 });
marketplaceReportSchema.index({ modelId: 1, isActive: 1, updatedAt: -1 });
marketplaceReportSchema.index({ isActive: 1, resolvedAt: 1 });

const MarketplaceReportModel = isMemoryDb()
  ? createMemoryModel("MarketplaceReport")
  : marketplaceModel("MarketplaceReport", marketplaceReportSchema);

export async function ensureMarketplaceReportIndexes() {
  if (isMemoryDb() || typeof MarketplaceReportModel.init !== "function") return;
  const indexes = await MarketplaceReportModel.collection.indexes();
  const unsafeTtl = indexes.find((index) => (
    index.key?.expiresAt === 1 && Number(index.expireAfterSeconds) === 0
  ));
  if (unsafeTtl) await MarketplaceReportModel.collection.dropIndex(unsafeTtl.name);
  await MarketplaceReportModel.init();
}

export default MarketplaceReportModel;
