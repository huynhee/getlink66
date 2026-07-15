import Notification from "../models/Notification.js";
import NotificationReceipt from "../models/NotificationReceipt.js";
import User from "../models/User.js";
import { hydrateAtlasUserFields } from "../utils/crossDatabaseHydration.js";
import {
  isSafeId,
  limitedString,
  rejectUnknownKeys,
} from "../utils/validators.js";

function activeNotificationQuery(userId) {
  const now = new Date();
  return {
    isActive: true,
    $or: [{ targetType: "all" }, { targetType: "users", userIds: userId }],
    $and: [
      {
        $or: [
          { startsAt: { $exists: false } },
          { startsAt: null },
          { startsAt: { $lte: now } },
        ],
      },
      {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      },
    ],
  };
}

function serializeNotification(item, userId, receiptIds = new Set()) {
  const readBy = Array.isArray(item.readBy) ? item.readBy : [];
  return {
    _id: item._id,
    title: item.title,
    body: item.body,
    displayType: item.displayType || "dropdown",
    imageUrl: item.imageUrl || "",
    actionLabel: item.actionLabel || "",
    actionUrl: item.actionUrl || "",
    targetType: item.targetType,
    isRead:
      receiptIds.has(String(item._id)) ||
      readBy.some((id) => String(id) === String(userId)),
    createdAt: item.createdAt,
    startsAt: item.startsAt,
    expiresAt: item.expiresAt,
  };
}

function safeNotificationUrl(value = "", { allowRelative = true } = {}) {
  const text = limitedString(value, 1000);
  if (!text) return "";
  if (allowRelative && text.startsWith("/") && !text.startsWith("//")) return text;
  try {
    const parsed = new URL(text);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export async function listNotifications(req, res, next) {
  try {
    const notifications = await Notification.find(
      activeNotificationQuery(req.user._id),
    )
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    const notificationIds = notifications.map((item) => item._id);
    const receipts = notificationIds.length
      ? await NotificationReceipt.find({
          userId: req.user._id,
          notificationId: { $in: notificationIds },
        })
          .select("notificationId")
          .lean()
      : [];
    const receiptIds = new Set(
      receipts.map((receipt) => String(receipt.notificationId)),
    );
    const items = notifications.map((item) =>
      serializeNotification(item, req.user._id, receiptIds),
    );
    res.json({
      notifications: items,
      unreadCount: items.filter((item) => !item.isRead).length,
    });
  } catch (error) {
    next(error);
  }
}

export async function markNotificationRead(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const notification = await Notification.findOne({
      _id: req.params.id,
      ...activeNotificationQuery(req.user._id),
    });
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    await NotificationReceipt.findOneAndUpdate(
      { notificationId: req.params.id, userId: req.user._id },
      { $set: { readAt: new Date() } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}

export async function adminListNotifications(_req, res, next) {
  try {
    const notifications = await Notification.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    await hydrateAtlasUserFields(notifications, ["createdBy", "userIds"]);
    res.json({ notifications });
  } catch (error) {
    next(error);
  }
}

export async function adminCreateNotification(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, [
      "title",
      "body",
      "displayType",
      "imageUrl",
      "actionLabel",
      "actionUrl",
      "targetType",
      "emails",
      "startsAt",
      "expiresAt",
    ]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid notification request" });
    }

    const title = limitedString(req.body.title, 120);
    const body = limitedString(req.body.body, 2000);
    const displayType = req.body.displayType === "fullscreen" ? "fullscreen" : "dropdown";
    const imageUrl = safeNotificationUrl(req.body.imageUrl, { allowRelative: false });
    const actionLabel = limitedString(req.body.actionLabel, 80);
    const actionUrl = safeNotificationUrl(req.body.actionUrl, { allowRelative: true });
    const targetType = req.body.targetType === "users" ? "users" : "all";
    if (!title || !body) {
      return res.status(400).json({ message: "Title and content are required" });
    }

    let userIds = [];
    if (targetType === "users") {
      const emails = String(req.body.emails || "")
        .split(/[\n,;]/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 200);
      if (!emails.length) {
        return res.status(400).json({ message: "Target emails are required" });
      }
      const users = await User.find({ email: { $in: emails } });
      userIds = users.map((user) => user._id);
      if (!userIds.length) {
        return res.status(400).json({ message: "No matching users found" });
      }
    }

    let startsAt;
    if (req.body.startsAt) {
      startsAt = new Date(req.body.startsAt);
      if (Number.isNaN(startsAt.valueOf())) {
        return res.status(400).json({ message: "Invalid start time" });
      }
    }

    let expiresAt;
    if (req.body.expiresAt) {
      expiresAt = new Date(req.body.expiresAt);
      if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date()) {
        return res.status(400).json({ message: "Invalid expiration time" });
      }
    }
    if (startsAt && expiresAt && startsAt >= expiresAt) {
      return res.status(400).json({ message: "Expiration time must be after start time" });
    }

    const notification = await Notification.create({
      title,
      body,
      displayType,
      imageUrl,
      actionLabel,
      actionUrl,
      targetType,
      userIds,
      startsAt,
      expiresAt,
      createdBy: req.user._id,
    });
    res.json({ notification });
  } catch (error) {
    next(error);
  }
}

export async function adminUpdateNotification(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    const unknownKey = rejectUnknownKeys(req.body, [
      "title",
      "body",
      "displayType",
      "imageUrl",
      "actionLabel",
      "actionUrl",
      "targetType",
      "emails",
      "startsAt",
      "expiresAt",
    ]);
    if (unknownKey) {
      return res.status(400).json({ message: "Invalid notification request" });
    }

    const title = limitedString(req.body.title, 120);
    const body = limitedString(req.body.body, 2000);
    const displayType = req.body.displayType === "fullscreen" ? "fullscreen" : "dropdown";
    const imageUrl = safeNotificationUrl(req.body.imageUrl, { allowRelative: false });
    const actionLabel = limitedString(req.body.actionLabel, 80);
    const actionUrl = safeNotificationUrl(req.body.actionUrl, { allowRelative: true });
    const targetType = req.body.targetType === "users" ? "users" : "all";
    if (!title || !body) {
      return res.status(400).json({ message: "Title and content are required" });
    }

    let userIds = [];
    if (targetType === "users") {
      const emails = String(req.body.emails || "")
        .split(/[\n,;]/)
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 200);
      if (!emails.length) {
        return res.status(400).json({ message: "Target emails are required" });
      }
      const users = await User.find({ email: { $in: emails } });
      userIds = users.map((user) => user._id);
      if (!userIds.length) {
        return res.status(400).json({ message: "No matching users found" });
      }
    }

    let startsAt;
    if (req.body.startsAt) {
      startsAt = new Date(req.body.startsAt);
      if (Number.isNaN(startsAt.valueOf())) {
        return res.status(400).json({ message: "Invalid start time" });
      }
    }

    let expiresAt;
    if (req.body.expiresAt) {
      expiresAt = new Date(req.body.expiresAt);
      if (Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date()) {
        return res.status(400).json({ message: "Invalid expiration time" });
      }
    }
    if (startsAt && expiresAt && startsAt >= expiresAt) {
      return res.status(400).json({ message: "Expiration time must be after start time" });
    }

    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          title,
          body,
          displayType,
          imageUrl,
          actionLabel,
          actionUrl,
          targetType,
          userIds,
          startsAt,
          expiresAt,
          isActive: true,
          readBy: [],
        },
      },
      { new: true },
    );
    if (!notification) {
      return res.status(404).json({ message: "Notification not found" });
    }
    await NotificationReceipt.deleteMany({ notificationId: req.params.id });
    res.json({ notification });
  } catch (error) {
    next(error);
  }
}

export async function adminDeleteNotification(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) {
      return res.status(400).json({ message: "Invalid notification id" });
    }
    await Notification.findByIdAndDelete(req.params.id);
    await NotificationReceipt.deleteMany({ notificationId: req.params.id });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
}
