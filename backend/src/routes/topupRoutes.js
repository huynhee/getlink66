import { Router } from "express";
import { cancelTopup, createTopup, getCredit, getPackages, topupHistory, topupStatus } from "../controllers/topupController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const topupLimit = createRateLimit({ keyPrefix: "topup-create", windowMs: 60_000, max: 20 });
const topupIpLimit = createRateLimit({
  keyPrefix: "topup-create-ip",
  windowMs: 60_000,
  max: Number(process.env.TOPUP_CREATE_IP_RATE_LIMIT || 100),
  keyGenerator: (req) => req.ip,
});
const topupStatusLimit = createRateLimit({
  keyPrefix: "topup-status",
  windowMs: 60_000,
  max: 120,
});
const topupCancelLimit = createRateLimit({
  keyPrefix: "topup-cancel",
  windowMs: 60_000,
  max: 20,
});

router.get("/credit", requireAuth, getCredit);
router.get("/topup/packages", getPackages);
router.post("/topup", requireAuth, topupLimit, topupIpLimit, createTopup);
router.get("/topup/history", requireAuth, topupHistory);
router.get("/topup/:id/status", requireAuth, topupStatusLimit, topupStatus);
router.post("/topup/:id/cancel", requireAuth, topupCancelLimit, cancelTopup);

export default router;
