import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const referralSchema = new mongoose.Schema(
  {
    referrerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    referredUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
    referralCode: { type: String, required: true, trim: true, uppercase: true, index: true },
    rewardType: { type: String, enum: ["credit", "pro"], default: "credit", index: true },
    rewardCredit: { type: Number, default: 28, min: 0 },
    referrerRewardCredit: { type: Number, default: 28, min: 0 },
    referredRewardCredit: { type: Number, default: 28, min: 0 },
    rewardProDays: { type: Number, default: 0, min: 0 },
    referrerRewardProDays: { type: Number, default: 0, min: 0 },
    referredRewardProDays: { type: Number, default: 0, min: 0 },
    referrerProUntil: Date,
    referredProUntil: Date,
    rewardMode: {
      type: String,
      enum: ["both", "referrer_only"],
      default: "both",
      index: true,
    },
    status: {
      type: String,
      enum: ["rewarded", "ignored"],
      default: "rewarded",
      index: true,
    },
    rewardedAt: Date,
  },
  { timestamps: true },
);

referralSchema.index({ referrerId: 1, createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("Referral")
  : mongoose.model("Referral", referralSchema);
