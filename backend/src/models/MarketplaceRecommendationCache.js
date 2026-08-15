import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const marketplaceRecommendationCacheSchema = new mongoose.Schema(
  {
    modelId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true, index: true },
    assetType: { type: String, enum: ["model", "scene"], required: true, index: true },
    candidateIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    engine: { type: String, default: "catalog_behavior_v3" },
    sourceUpdatedAt: Date,
    generatedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true, index: true },
    error: { type: String, default: "" },
  },
  { timestamps: true },
);

marketplaceRecommendationCacheSchema.index({ assetType: 1, expiresAt: 1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceRecommendationCache")
  : marketplaceModel("MarketplaceRecommendationCache", marketplaceRecommendationCacheSchema);

