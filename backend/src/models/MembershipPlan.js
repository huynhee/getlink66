import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const membershipPlanSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 },
    expiresEndOfDay: { type: Boolean, default: false },
    tier: { type: String, enum: ["member"], default: "member" },
    dailyDownloadLimit: { type: Number, default: 100, min: 1 },
    maxPurchasesPerUser: { type: Number, default: 0, min: 0 },
    badge: { type: String, default: "" },
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);

export default isMemoryDb()
  ? createMemoryModel("MembershipPlan")
  : mongoose.model("MembershipPlan", membershipPlanSchema);
