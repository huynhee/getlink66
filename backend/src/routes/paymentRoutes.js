import { Router } from "express";
import { sepayIpn, vietQrWebhook } from "../controllers/paymentController.js";
import { createRateLimit } from "../middleware/rateLimit.js";
import { webhookIpGuard } from "../middleware/webhookGuard.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { capturePaypalOrder, paypalWebhook } from "../controllers/paypalController.js";

const router = Router();
const webhookLimit = createRateLimit({
  keyPrefix: "vietqr-webhook",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip
});
const sepayWebhookLimit = createRateLimit({
  keyPrefix: "sepay-ipn",
  windowMs: 60_000,
  max: 120,
  keyGenerator: (req) => req.ip
});

router.post("/payments/vietqr/webhook", webhookIpGuard, webhookLimit, vietQrWebhook);
router.post("/payments/sepay/ipn", sepayWebhookLimit, sepayIpn);
router.post("/payments/paypal/webhook", createRateLimit({ keyPrefix: "paypal-webhook", windowMs: 60_000, max: 120, keyGenerator: (req) => req.ip }), paypalWebhook);
router.post("/payments/paypal/orders/:kind/:id/capture", requireAuth, createRateLimit({ keyPrefix: "paypal-capture", windowMs: 60_000, max: 30 }), capturePaypalOrder);

export default router;
