import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const schema = new mongoose.Schema({
  _id: String,
  kind: { type: String, enum: ["topup", "membership"], required: true },
  orderId: { type: mongoose.Schema.Types.ObjectId, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  packageId: { type: mongoose.Schema.Types.ObjectId, required: true },
  voucherCode: { type: String, default: "", index: true },
  state: { type: String, enum: ["held", "consumed", "released"], required: true, index: true },
}, { timestamps: true });

schema.index({ userId: 1, kind: 1, packageId: 1, state: 1 });
schema.index({ userId: 1, voucherCode: 1, state: 1 });
export default isMemoryDb() ? createMemoryModel("PaymentBenefitReservation") : mongoose.model("PaymentBenefitReservation", schema);
