import mongoose from "mongoose";
import { createMemoryModel, isMemoryDb } from "../config/memoryStore.js";
import { marketplaceModel } from "../config/modelFactory.js";

const notificationReceiptSchema = new mongoose.Schema(
  {
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Notification",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    readAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

notificationReceiptSchema.index(
  { notificationId: 1, userId: 1 },
  { unique: true, name: "unique_notification_user_receipt" },
);
notificationReceiptSchema.index({ userId: 1, readAt: -1 });

const NotificationReceiptModel = isMemoryDb()
  ? createMemoryModel("NotificationReceipt")
  : marketplaceModel("NotificationReceipt", notificationReceiptSchema);

export async function ensureNotificationReceiptIndexes() {
  if (isMemoryDb() || typeof NotificationReceiptModel.init !== "function") return;
  await NotificationReceiptModel.init();
}

export default NotificationReceiptModel;
