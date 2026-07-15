import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const modelDownloadSchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], default: "model", index: true },
    modelId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceModel", required: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "DownloadSession", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    guestKey: { type: String, default: "", index: true },
    clientType: { type: String, enum: ["web", "plugin"], default: "web", index: true },
    // `guest` is retained only so historical download logs remain readable.
    accessTier: { type: String, enum: ["guest", "free", "member", "admin"], default: "free" },
    quotaCharged: { type: Boolean, default: false },
    quotaCost: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ["requested", "downloaded", "expired", "failed"],
      default: "requested",
      index: true,
    },
    downloadedAt: { type: Date, index: true },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);

modelDownloadSchema.index({ createdAt: -1 });
modelDownloadSchema.index({ userId: 1, downloadedAt: -1 });
modelDownloadSchema.index({ modelId: 1, downloadedAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("ModelDownload")
  : marketplaceModel("ModelDownload", modelDownloadSchema);
