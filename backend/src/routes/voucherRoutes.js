import { Router } from "express";
import { applyVoucher } from "../controllers/voucherController.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { createRateLimit } from "../middleware/rateLimit.js";

const router = Router();
// Chong voucher code enumeration: gioi han 10 lan apply / phut / user.
// Voucher code admin tao co the predictable (vd. WELCOME2026, SALE10) -> attacker brute force.
const voucherApplyLimit = createRateLimit({
  keyPrefix: "voucher-apply",
  windowMs: 60_000,
  max: 10,
});

router.post("/voucher/apply", requireAuth, voucherApplyLimit, applyVoucher);

export default router;
