import { Router } from "express";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../controllers/notificationController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();
const notificationLimit = createRateLimit({
  keyPrefix: "notifications",
  windowMs: 60_000,
  max: 120,
});

router.get("/notifications", requireAuth, notificationLimit, listNotifications);
router.post(
  "/notifications/read-all",
  requireAuth,
  notificationLimit,
  markAllNotificationsRead,
);
router.post(
  "/notifications/:id/read",
  requireAuth,
  notificationLimit,
  markNotificationRead,
);

export default router;
