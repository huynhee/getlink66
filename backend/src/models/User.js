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
    isTwoFactorEnabled: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("User") : mongoose.model("User", userSchema);
