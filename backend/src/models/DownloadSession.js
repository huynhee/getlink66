import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const downloadSessionSchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], default: "model", index: true },
    modelId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceModel", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    guestKey: { type: String, default: "", index: true },
    clientType: { type: String, enum: ["web", "plugin"], default: "web", index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    purgeAt: { type: Date, required: true },
    status: { type: String, enum: ["active", "used", "expired", "revoked"], default: "active", index: true },
    downloadedAt: Date,
    downloadCountedAt: Date,
    quotaCharged: { type: Boolean, default: false },
    quotaCost: { type: Number, default: 0, min: 0 },
    // `guest` is retained only so historical sessions remain readable.
    accessTier: { type: String, enum: ["guest", "free", "member", "admin"], default: "free" },
    storageProvider: { type: String, default: "" },
    storageKey: { type: String, default: "" },
    driveFileId: { type: String, default: "" },
    fileName: { type: String, default: "" },
    fileSize: { type: Number, default: 0 },
    sha256: { type: String, default: "" },
  },
  { timestamps: true },
);

downloadSessionSchema.index({ expiresAt: 1, status: 1 });
downloadSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("DownloadSession")
  : marketplaceModel("DownloadSession", downloadSessionSchema);
