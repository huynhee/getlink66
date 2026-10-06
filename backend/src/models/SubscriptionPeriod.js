import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  sourceKey: { type: String, required: true, unique: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipOrder" },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipPlan" },
  planCode: { type: String, default: "" },
  planName: { type: String, default: "Subscription" },
  billingPeriod: { type: String, enum: ["day", "month", "year"], required: true },
  durationDays: { type: Number, min: 1, required: true, validate: Number.isSafeInteger },
  dailyDownloadLimit: { type: Number, min: 1, required: true, validate: Number.isSafeInteger },
  startsAt: { type: Date, required: true },
  endsAt: { type: Date, required: true },
  status: { type: String, enum: ["valid", "cancelled"], default: "valid", required: true },
  cancelledAt: Date,
  adjustedAt: Date,
}, { timestamps: true });
schema.index({ userId: 1, status: 1, startsAt: 1 });
schema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { orderId: { $type: "objectId" } } });

export default isMemoryDb() ? createMemoryModel("SubscriptionPeriod") : mongoose.model("SubscriptionPeriod", schema);
