import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const dailyDownloadQuotaSchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    guestKey: { type: String, default: "", index: true },
    tier: { type: String, enum: ["guest", "free", "member"], required: true },
    count: { type: Number, default: 0, min: 0 },
    bonusLimit: { type: Number, default: 0, min: 0 },
    resetAt: { type: Date, required: true },
  },
  { timestamps: true },
);

dailyDownloadQuotaSchema.index({ dayKey: 1, userId: 1, guestKey: 1, tier: 1 }, { unique: true });
dailyDownloadQuotaSchema.index({ resetAt: 1 }, { expireAfterSeconds: 45 * 24 * 60 * 60 });

export default isMemoryDb()
  ? createMemoryModel("DailyDownloadQuota")
  : marketplaceModel("DailyDownloadQuota", dailyDownloadQuotaSchema);
