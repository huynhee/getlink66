import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const dailyDownloadQuotaSchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    guestKey: { type: String, default: "", index: true },
    tier: { type: String, enum: ["guest", "free", "member"], required: true },
    count: { type: Number, default: 0, min: 0 },
    bonusLimit: { type: Number, default: 0, min: 0 },
    resetAt: { type: Date, required: true, index: true },
  },
  { timestamps: true },
);

dailyDownloadQuotaSchema.index({ dayKey: 1, userId: 1, guestKey: 1, tier: 1 });

export default isMemoryDb()
  ? createMemoryModel("DailyDownloadQuota")
  : mongoose.model("DailyDownloadQuota", dailyDownloadQuotaSchema);
