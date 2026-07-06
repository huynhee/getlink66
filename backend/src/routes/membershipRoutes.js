import { Router } from "express";
import {
  cancelMembershipOrder,
  createMembershipCheckout,
  listMembershipPlans,
  membershipMe,
  membershipOrderStatus,
} from "../controllers/membershipController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
const checkoutLimit = createRateLimit({ keyPrefix: "membership-checkout", windowMs: 60_000, max: 20 });
const statusLimit = createRateLimit({ keyPrefix: "membership-status", windowMs: 60_000, max: 120 });

router.get("/membership/plans", listMembershipPlans);
router.get("/membership/me", requireAuth, membershipMe);
router.post("/membership/checkout", requireAuth, checkoutLimit, createMembershipCheckout);
router.get("/membership/orders/:id/status", requireAuth, statusLimit, membershipOrderStatus);
router.post("/membership/orders/:id/cancel", requireAuth, checkoutLimit, cancelMembershipOrder);

export default router;
