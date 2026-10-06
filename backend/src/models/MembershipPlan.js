import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const membershipPlanSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    price: { type: Number, default: null, min: 0, required() { return this.isActive === true; }, validate: (value) => value == null || Number.isSafeInteger(value) },
    paypalPriceCents: { type: Number, default: null, min: 0, max: 100000000, validate: (value) => value == null || Number.isSafeInteger(value) },
    billingPeriod: { type: String, enum: ["day", "month", "year"] },
    catalogVersion: { type: Number, default: 1, enum: [1, 2], index: true },
    catalogRetired: { type: Boolean, default: false },
    durationDays: { type: Number, required: true, min: 1, validate: Number.isSafeInteger },
    expiresEndOfDay: { type: Boolean, default: false },
    tier: { type: String, enum: ["member"], default: "member" },
    dailyDownloadLimit: { type: Number, default: 100, min: 1, validate: Number.isSafeInteger },
    maxPurchasesPerUser: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
    badge: { type: String, default: "" },
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);

export default isMemoryDb()
  ? createMemoryModel("MembershipPlan")
  : mongoose.model("MembershipPlan", membershipPlanSchema);
