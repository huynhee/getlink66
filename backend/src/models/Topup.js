import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const topupSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    packageId: { type: mongoose.Schema.Types.ObjectId, ref: "TopupPackage" },
    originalAmount: Number,
    discountAmount: { type: Number, default: 0 },
    voucherCode: String,
    voucherDiscountPercent: { type: Number, default: 0 },
    voucherCreditBonus: { type: Number, default: 0 },
    amount: { type: Number, required: true },
    credit: { type: Number, required: true },
    type: {
      type: String,
      enum: ["manual", "auto", "fake", "vnpay", "vietqr", "sepay"],
      default: "auto",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    paymentCode: { type: String, index: true },
    qrUrl: String,
    checkoutUrl: String,
    gatewayProvider: String,
    bankId: String,
    accountNo: String,
    accountName: String,
    expiresAt: Date,
    paidAt: Date,
    gatewayTransactionId: { type: String, index: true },
    gatewayPayload: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

// Chong paymentCode collision khi 2 topup pending cung code -> webhook approve nham nguoi.
// Chi enforce unique trong status "pending" (sau khi approved/rejected co the trung).
topupSchema.index(
  { paymentCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentCode: { $exists: true, $type: "string" },
      status: "pending",
    },
    name: "unique_pending_paymentCode",
  },
);
topupSchema.index({ userId: 1, createdAt: -1 });
topupSchema.index({ status: 1, createdAt: -1 });
topupSchema.index({ status: 1, paidAt: -1 });
topupSchema.index({ voucherCode: 1, status: 1 });

const TopupModel = isMemoryDb()
  ? createMemoryModel("Topup")
  : mongoose.model("Topup", topupSchema);

export async function ensureTopupIndexes() {
  if (isMemoryDb() || !TopupModel.collection?.indexes) return;
  try {
    const indexes = await TopupModel.collection.indexes();
    if (indexes.some((index) => index.name === "unique_user_voucher_active")) {
      await TopupModel.collection.dropIndex("unique_user_voucher_active");
    }
  } catch {
    // Non-fatal: old deployments may not have the obsolete index yet.
  }
}

export default TopupModel;
