import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const marketplaceCreditEntitlementSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assetType: { type: String, enum: ["model", "scene"], required: true },
    assetId: { type: String, required: true },
    creditCost: { type: Number, required: true, min: 1 },
    chargedAt: { type: Date, required: true },
    validUntil: { type: Date, required: true, index: true },
    purgeAt: { type: Date, required: true },
    version: { type: Number, default: 0, min: 0 },
    lastTransactionId: { type: String, default: "" },
  },
  { timestamps: true },
);

marketplaceCreditEntitlementSchema.index(
  { userId: 1, assetType: 1, assetId: 1 },
  { unique: true },
);
marketplaceCreditEntitlementSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0 });

export default isMemoryDb()
  ? createMemoryModel("MarketplaceCreditEntitlement")
  : mongoose.model("MarketplaceCreditEntitlement", marketplaceCreditEntitlementSchema);
