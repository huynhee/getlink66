import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const membershipOrderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    planId: { type: mongoose.Schema.Types.ObjectId, ref: "MembershipPlan", required: true, index: true },
    planCode: { type: String, default: "" },
    planName: { type: String, default: "" },
    originalAmount: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    voucherCode: { type: String, default: "", index: true },
    voucherDiscountPercent: { type: Number, default: 0, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    durationDays: { type: Number, required: true, min: 1 },
    expiresEndOfDay: { type: Boolean, default: false },
    dailyDownloadLimit: { type: Number, default: 100, min: 1 },
    isQuotaAddon: { type: Boolean, default: false, index: true },
    quotaBoostAmount: { type: Number, default: 0, min: 0 },
    quotaBoostDayKey: { type: String, default: "", index: true },
    status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending", index: true },
    paymentCode: { type: String, required: true, index: true },
    checkoutUrl: String,
    gatewayProvider: String,
    expiresAt: Date,
    paidAt: Date,
    canceledAt: Date,
    rejectionReason: String,
    gatewayTransactionId: { type: String, index: true },
    gatewayPayload: mongoose.Schema.Types.Mixed,
    activatedUntil: Date,
    idempotencyKey: { type: String, trim: true },
  },
  { timestamps: true },
);

membershipOrderSchema.index(
  { paymentCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentCode: { $exists: true, $type: "string" },
      status: "pending",
    },
    name: "unique_pending_membership_paymentCode",
  },
);
membershipOrderSchema.index({ userId: 1, createdAt: -1 });
membershipOrderSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
    name: "unique_user_membership_idempotency",
  },
);

export default isMemoryDb()
  ? createMemoryModel("MembershipOrder")
  : mongoose.model("MembershipOrder", membershipOrderSchema);
