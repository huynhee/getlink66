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
      enum: ["manual", "auto", "fake", "vnpay", "vietqr"],
      default: "auto",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    paymentCode: { type: String, index: true },
    qrUrl: String,
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

// Chong race condition "1 user 1 voucher 1 luot": nhieu request dong thoi cung user+voucher
// se bypass countDocuments check. Partial unique index force atomic at DB level.
topupSchema.index(
  { userId: 1, voucherCode: 1 },
  {
    unique: true,
    partialFilterExpression: {
      voucherCode: { $exists: true, $type: "string" },
      status: { $in: ["pending", "approved"] },
    },
    name: "unique_user_voucher_active",
  },
);

export default isMemoryDb()
  ? createMemoryModel("Topup")
  : mongoose.model("Topup", topupSchema);
