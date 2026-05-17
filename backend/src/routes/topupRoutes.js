import { Router } from "express";
import { createTopup, getCredit, getPackages, topupHistory } from "../controllers/topupController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const topupLimit = createRateLimit({ keyPrefix: "topup-create", windowMs: 60_000, max: 20 });

router.get("/credit", requireAuth, getCredit);
router.get("/topup/packages", getPackages);
router.post("/topup", requireAuth, topupLimit, createTopup);
router.get("/topup/history", requireAuth, topupHistory);

export default router;
