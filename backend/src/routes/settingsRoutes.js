import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { adminOnly } from "../middleware/adminOnly.js";
import { auditAdmin } from "../middleware/auditLog.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const settingsWriteLimit = createRateLimit({
  keyPrefix: "settings-write",
  windowMs: 60_000,
  max: 20,
});

router.get("/settings", getSettings);
router.post(
  "/settings",
  requireAuth,
  adminOnly,
  settingsWriteLimit,
  auditAdmin("UPDATE_SETTINGS"),
  updateSettings,
);

export default router;
