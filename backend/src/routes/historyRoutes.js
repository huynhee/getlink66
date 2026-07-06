import { Router } from "express";
import { timelineHistory } from "../controllers/historyController.js";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

router.get("/history/timeline", requireAuth, timelineHistory);

export default router;

