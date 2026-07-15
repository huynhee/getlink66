import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const marketplaceQuotaGrantSchema = new mongoose.Schema(
  {
    membershipOrderId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    dayKey: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    appliedAt: { type: Date, required: true },
  },
  { timestamps: true },
);

marketplaceQuotaGrantSchema.index({ userId: 1, dayKey: 1, appliedAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceQuotaGrant")
  : marketplaceModel("MarketplaceQuotaGrant", marketplaceQuotaGrantSchema);
