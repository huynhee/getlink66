import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const marketplaceInterestProfileSchema = new mongoose.Schema(
  {
    actorKey: { type: String, required: true, unique: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, index: true },
    weights: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    recentAssetIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    eventCount: { type: Number, default: 0, min: 0 },
    lastEventAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

marketplaceInterestProfileSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceInterestProfile")
  : marketplaceModel("MarketplaceInterestProfile", marketplaceInterestProfileSchema);

