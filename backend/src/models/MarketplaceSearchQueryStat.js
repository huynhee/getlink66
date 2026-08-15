import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const marketplaceSearchQueryStatSchema = new mongoose.Schema(
  {
    queryKey: { type: String, required: true, unique: true, index: true },
    assetType: { type: String, enum: ["model", "scene"], required: true, index: true },
    normalizedQuery: { type: String, required: true, maxlength: 120, index: true },
    displayQuery: { type: String, required: true, maxlength: 120 },
    timeBucket: { type: String, required: true, maxlength: 13, index: true },
    count: { type: Number, default: 0, min: 0 },
    zeroResultCount: { type: Number, default: 0, min: 0 },
    resultCountTotal: { type: Number, default: 0, min: 0 },
    totalLatencyMs: { type: Number, default: 0, min: 0 },
    lastLatencyMs: { type: Number, default: 0, min: 0 },
    lastEngine: { type: String, default: "", trim: true, maxlength: 80 },
    lastSearchedAt: { type: Date, default: Date.now, index: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

marketplaceSearchQueryStatSchema.index({ assetType: 1, count: -1, lastSearchedAt: -1 });
marketplaceSearchQueryStatSchema.index({ assetType: 1, normalizedQuery: 1, timeBucket: -1 });
marketplaceSearchQueryStatSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceSearchQueryStat")
  : marketplaceModel("MarketplaceSearchQueryStat", marketplaceSearchQueryStatSchema);
