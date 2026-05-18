import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const voucherSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, default: "" },
    creditBonus: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    usageLimit: { type: Number, required: true, min: 1 },
    // 0 = khong gioi han theo tung tai khoan, chi bi gioi han boi usageLimit tong.
    perUserLimit: { type: Number, default: 1, min: 0 },
    applicablePackageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "TopupPackage" }],
    usedCount: { type: Number, default: 0, min: 0 },
    expireAt: { type: Date, required: true }
  },
  { timestamps: true }
);

voucherSchema.index({ code: 1, expireAt: 1 });
voucherSchema.index({ expireAt: 1, usedCount: 1 });

export default isMemoryDb() ? createMemoryModel("Voucher") : mongoose.model("Voucher", voucherSchema);
