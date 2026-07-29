import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    name: { type: String, required: true },
    avatar: { type: String, default: "" },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    credit: { type: Number, default: 0, min: 0 },
    referralCode: { type: String, unique: true, sparse: true, trim: true, uppercase: true, index: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    referralRewardedAt: Date,
    twoFactorSecret: { type: String, default: "" },
    isTwoFactorEnabled: { type: Boolean, default: false },
    isBanned: { type: Boolean, default: false, index: true },
    banReason: { type: String, default: "" },
    bannedAt: Date,
    bannedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sessionVersion: { type: Number, default: 0, min: 0 },
    proUntil: { type: Date, index: true },
    proPlanId: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipPlan" },
    proActivatedAt: Date,
    proDailyDownloadLimit: { type: Number, default: 100, min: 0 },
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("User") : mongoose.model("User", userSchema);
