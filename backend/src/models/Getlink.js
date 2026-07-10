import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";

const getlinkSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    productId: { type: String, required: true, index: true },
    fileUrl: { type: String, required: true },
    sourceUrl: String,
    resolvedSourceUrl: String,
    title: String,
    imageUrl: String,
    creditUsed: { type: Number, default: 1 },
    downloadFormat: {
      key: { type: String, default: "" },
      label: { type: String, default: "" },
      fileFormat: { type: String, default: "" },
      formatVersion: { type: String, default: "" },
      rendererType: { type: String, default: "" },
      rendererLabel: { type: String, default: "" },
      size: { type: String, default: "" },
    },
    initialDownloadAt: Date,
    redownloadCount: { type: Number, default: 0, min: 0 },
    lastRedownloadAt: Date,
  },
  { timestamps: true }
);

getlinkSchema.index({ userId: 1, productId: 1, createdAt: -1 });
getlinkSchema.index({ userId: 1, createdAt: -1 });
getlinkSchema.index({ productId: 1, createdAt: -1 });
getlinkSchema.index({ createdAt: -1 });

export default isMemoryDb() ? createMemoryModel("Getlink") : mongoose.model("Getlink", getlinkSchema);
