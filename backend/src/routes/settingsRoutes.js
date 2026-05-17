import { Router } from "express";
import { getSettings, updateSettings } from "../controllers/settingsController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { adminOnly } from "../middleware/adminOnly.js";

const router = Router();

router.get("/settings", getSettings);
router.post("/settings", requireAuth, adminOnly, updateSettings);

export default router;
