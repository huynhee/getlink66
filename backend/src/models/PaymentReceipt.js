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
      required: true,
      unique: true,
    },
    amount: { type: Number, required: true },
  },
  { timestamps: true },
);

paymentReceiptSchema.index({ createdAt: -1 });

const PaymentReceiptModel = isMemoryDb()
  ? createMemoryModel("PaymentReceipt")
  : mongoose.model("PaymentReceipt", paymentReceiptSchema);

export async function ensurePaymentReceiptIndexes() {
  if (isMemoryDb() || typeof PaymentReceiptModel.init !== "function") return;
  await PaymentReceiptModel.init();
}

export default PaymentReceiptModel;
