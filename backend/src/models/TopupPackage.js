import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const topupPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, default: "GÓI CREDIT" },
    price: { type: Number, required: true },
    credit: { type: Number, required: true },
    salePercent: { type: Number, default: 0, min: 0, max: 100 },
    maxTopupsPerUser: { type: Number, default: 0, min: 0 },
    badge: { type: String, default: "" },
    features: { type: [String], default: [] },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0, index: true }
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("TopupPackage") : mongoose.model("TopupPackage", topupPackageSchema);
