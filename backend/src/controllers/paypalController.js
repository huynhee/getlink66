import { isSafeId, rejectUnknownKeys } from "../utils/validators.js";
import { paypalCaptureResponse } from "../utils/paypalPaymentService.js";
import { verifyPaypalWebhook } from "../utils/paypal.js";
import { enqueuePaypalWebhook } from "../utils/paypalWebhookService.js";

export async function capturePaypalOrder(req, res, next) {
  try {
    if (!isSafeId(req.params.id) || !["topup", "membership"].includes(req.params.kind) || rejectUnknownKeys(req.body || {}, [])) {
      return res.status(400).json({ message: "Invalid payment order" });
    }
    res.json(await paypalCaptureResponse(req.params.kind, req.params.id, req.user._id));
  } catch (error) { next(error); }
}

export async function paypalWebhook(req, res, next) {
  try {
    if (!String(req.get("content-type") || "").includes("application/json")) return res.status(415).json({ message: "Content-Type must be application/json" });
    const environment = await verifyPaypalWebhook(req);
    res.json({ ok: true, ...await enqueuePaypalWebhook(req.body, environment) });
  } catch (error) { next(error); }
}
