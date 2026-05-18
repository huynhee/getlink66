import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const voucherRedemptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    voucherCode: { type: String, required: true, uppercase: true, trim: true },
    topupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Topup",
      required: true,
      unique: true,
    },
    slot: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

voucherRedemptionSchema.index(
  { userId: 1, voucherCode: 1, slot: 1 },
  { unique: true, name: "unique_user_voucher_slot" },
);
voucherRedemptionSchema.index({ userId: 1, voucherCode: 1, createdAt: -1 });
voucherRedemptionSchema.index({ voucherCode: 1, createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("VoucherRedemption")
  : mongoose.model("VoucherRedemption", voucherRedemptionSchema);
