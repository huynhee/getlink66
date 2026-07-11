import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const paymentReceiptSchema = new mongoose.Schema(
  {
    gatewayTransactionId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    provider: { type: String, default: "", trim: true, index: true },
    topupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topup",
      default: null,
    },
    membershipOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MembershipOrder",
      default: null,
    },
    amount: { type: Number, required: true },
  },
  { timestamps: true },
);

paymentReceiptSchema.index({ createdAt: -1 });
paymentReceiptSchema.index(
  { topupId: 1 },
  {
    unique: true,
    partialFilterExpression: { topupId: { $type: "objectId" } },
    name: "unique_topup_payment_receipt",
  },
);
paymentReceiptSchema.index(
  { membershipOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { membershipOrderId: { $type: "objectId" } },
    name: "unique_membership_payment_receipt",
  },
);

const PaymentReceiptModel = isMemoryDb()
  ? createMemoryModel("PaymentReceipt")
  : mongoose.model("PaymentReceipt", paymentReceiptSchema);

export async function ensurePaymentReceiptIndexes() {
  if (isMemoryDb() || typeof PaymentReceiptModel.init !== "function") return;
  try {
    await PaymentReceiptModel.collection.dropIndex("topupId_1");
  } catch (error) {
    if (error?.codeName !== "IndexNotFound" && error?.code !== 27) throw error;
  }
  await PaymentReceiptModel.createIndexes();
}

export default PaymentReceiptModel;
