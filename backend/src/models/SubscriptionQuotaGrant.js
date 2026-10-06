import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const subscriptionQuotaGrantSchema = new mongoose.Schema(
  {
    sourceKey: { type: String, required: true, unique: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    dayKey: { type: String, required: true },
    amount: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    status: { type: String, enum: ["pending", "applied", "error", "expired"], default: "pending" },
    attempts: { type: Number, default: 0, min: 0 },
    syncedAt: Date,
    lastError: { type: String, default: "" },
  },
  { timestamps: true },
);

subscriptionQuotaGrantSchema.index({ status: 1, createdAt: 1 });
subscriptionQuotaGrantSchema.index({ userId: 1, dayKey: 1 });

export default isMemoryDb()
  ? createMemoryModel("SubscriptionQuotaGrant")
  : mongoose.model("SubscriptionQuotaGrant", subscriptionQuotaGrantSchema);
