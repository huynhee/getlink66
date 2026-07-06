import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const dailyImageSearchQuotaSchema = new mongoose.Schema(
  {
    dayKey: { type: String, required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tier: { type: String, enum: ["free", "member"], required: true },
    count: { type: Number, default: 0, min: 0 },
    resetAt: { type: Date, required: true, index: true },
    lastImageHash: { type: String, default: "" },
  },
  { timestamps: true },
);

dailyImageSearchQuotaSchema.index({ dayKey: 1, userId: 1, tier: 1 }, { unique: true });

export default isMemoryDb()
  ? createMemoryModel("DailyImageSearchQuota")
  : mongoose.model("DailyImageSearchQuota", dailyImageSearchQuotaSchema);
