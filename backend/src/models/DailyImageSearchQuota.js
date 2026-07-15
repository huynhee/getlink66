import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const dailyImageSearchQuotaSchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tier: { type: String, enum: ["free", "member"], required: true },
    count: { type: Number, default: 0, min: 0 },
    resetAt: { type: Date, required: true },
    lastImageHash: { type: String, default: "" },
  },
  { timestamps: true },
);

dailyImageSearchQuotaSchema.index({ dayKey: 1, userId: 1, tier: 1 }, { unique: true });
dailyImageSearchQuotaSchema.index({ resetAt: 1 }, { expireAfterSeconds: 45 * 24 * 60 * 60 });

export default isMemoryDb()
  ? createMemoryModel("DailyImageSearchQuota")
  : marketplaceModel("DailyImageSearchQuota", dailyImageSearchQuotaSchema);
