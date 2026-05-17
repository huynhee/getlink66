import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const cookieSchema = new mongoose.Schema(
  {
    value: { type: String, required: true },
    label: { type: String, default: "" },
    isActive: { type: Boolean, default: true, index: true },
    status: { type: String, default: "active", enum: ["active", "warning", "cooldown", "disabled"] },
    failureCount: { type: Number, default: 0 },
    useCount: { type: Number, default: 0 },
    cooldownUntil: Date,
    lastUsedAt: Date,
    lastErrorAt: Date,
    lastErrorMessage: String,
    lastTestAt: Date,
    lastTestOk: Boolean,
    lastTestMessage: String
  },
  { timestamps: true }
);

export default isMemoryDb() ? createMemoryModel("Cookie") : mongoose.model("Cookie", cookieSchema);
