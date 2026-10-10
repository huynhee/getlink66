import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";
import { NOTIFICATION_PAGE_KEYS } from "../utils/notificationPages.js";

const notificationSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    displayType: {
      type: String,
      enum: ["dropdown", "fullscreen"],
      default: "dropdown",
      index: true,
    },
    displayPages: {
      type: [{ type: String, enum: NOTIFICATION_PAGE_KEYS }],
      default: [],
    },
    imageUrl: { type: String, default: "" },
    actionLabel: { type: String, default: "" },
    actionUrl: { type: String, default: "" },
    targetType: {
      type: String,
      enum: ["all", "users"],
      default: "all",
      index: true,
    },
    userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "User", index: true }],
    readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true, index: true },
    startsAt: Date,
    expiresAt: Date,
  },
  { timestamps: true },
);

notificationSchema.index({ createdAt: -1 });

export default isMemoryDb()
  ? createMemoryModel("Notification")
  : marketplaceModel("Notification", notificationSchema);
