import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const systemLogSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["getlink", "download", "cookie", "payment", "security", "system"],
      index: true,
    },
    level: {
      type: String,
      default: "error",
      enum: ["info", "warn", "error"],
      index: true,
    },
    message: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", index: true },
    productId: { type: String, index: true },
    historyId: { type: mongoose.Schema.Types.ObjectId, ref: "Getlink", index: true },
    status: Number,
    ip: String,
    path: String,
    details: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true },
);

systemLogSchema.index({ createdAt: -1 });
systemLogSchema.index({ type: 1, createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("SystemLog")
  : marketplaceModel("SystemLog", systemLogSchema);
