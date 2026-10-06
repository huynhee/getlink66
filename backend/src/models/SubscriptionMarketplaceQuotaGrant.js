import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const schema = new mongoose.Schema({
  sourceKey: { type: String, required: true, unique: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true },
  dayKey: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  appliedAt: { type: Date, required: true },
}, { timestamps: true });
export default isMemoryDb() ? createMemoryModel("SubscriptionMarketplaceQuotaGrant") : marketplaceModel("SubscriptionMarketplaceQuotaGrant", schema);
