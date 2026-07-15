import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const modelDownloadSchema = new mongoose.Schema(
  {
    assetType: { type: String, enum: ["model", "scene"], default: "model", index: true },
    modelId: { type: mongoose.Schema.Types.ObjectId, ref: "MarketplaceModel", required: true, index: true },
    sessionId: { type: mongoose.Schema.Types.ObjectId, ref: "DownloadSession", index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    guestKey: { type: String, default: "", index: true },
    clientType: { type: String, enum: ["web", "plugin"], default: "web", index: true },
    accessTier: { type: String, enum: ["guest", "free", "member", "admin"], default: "guest" },
    quotaCharged: { type: Boolean, default: false },
    quotaCost: { type: Number, default: 0, min: 0 },
    ip: { type: String, default: "" },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true },
);

modelDownloadSchema.index({ createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("ModelDownload")
  : mongoose.model("ModelDownload", modelDownloadSchema);
