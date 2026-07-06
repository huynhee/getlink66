import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const downloadSessionSchema = new mongoose.Schema(
  {
    modelId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceModel", required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    guestKey: { type: String, default: "", index: true },
    clientType: { type: String, enum: ["web", "plugin"], default: "web", index: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: ["active", "used", "expired", "revoked"], default: "active", index: true },
    quotaCharged: { type: Boolean, default: false },
    accessTier: { type: String, enum: ["guest", "free", "member", "admin"], default: "guest" },
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

export default isMemoryDb()
  ? createMemoryModel("DownloadSession")
  : mongoose.model("DownloadSession", downloadSessionSchema);
