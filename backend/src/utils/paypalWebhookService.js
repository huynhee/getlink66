import { randomUUID } from "node:crypto";
import PaypalWebhookEvent from "../models/PaypalWebhookEvent.js";
import PaypalPayment from "../models/PaypalPayment.js";
import PaypalAdjustment from "../models/PaypalAdjustment.js";
import { paypalApi, validatePaypalOrder } from "./paypal.js";
import { paypalOrderModel, processPaypalPayment } from "./paypalPaymentService.js";
import { paymentError, usdCents } from "./paymentMoney.js";
import { sendTelegramNotification } from "./telegramNotifier.js";

const CHECKOUT_EVENTS = new Set(["CHECKOUT.ORDER.APPROVED", "PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.PENDING", "PAYMENT.CAPTURE.DENIED", "PAYMENT.CAPTURE.DECLINED"]);
const ADJUSTMENT_EVENTS = new Set(["PAYMENT.CAPTURE.REFUNDED", "PAYMENT.CAPTURE.REVERSED", "CUSTOMER.DISPUTE.CREATED", "CUSTOMER.DISPUTE.UPDATED", "CUSTOMER.DISPUTE.RESOLVED"]);

export async function enqueuePaypalWebhook(payload, environment) {
  if (!/^[A-Z0-9-]{1,100}$/i.test(payload?.id || "") || typeof payload.event_type !== "string" || !payload.resource) {
    throw paymentError("Invalid PayPal webhook event", "PAYPAL_WEBHOOK_INVALID");
  }
  if (!CHECKOUT_EVENTS.has(payload.event_type) && !ADJUSTMENT_EVENTS.has(payload.event_type)) return { ignored: true };
  const id = `${environment}:${payload.id}`;
  try {
    await PaypalWebhookEvent.findOneAndUpdate({ _id: id }, { $setOnInsert: {
      environment, eventType: payload.event_type, payload, state: "pending", nextAttemptAt: new Date(), attempts: 0,
    } }, { upsert: true, new: true });
  } catch (error) { if (error.code !== 11000) throw error; }
  return { queued: true };
}

function captureIdFromLinks(resource) {
  for (const link of resource.links || []) {
    const url = new URL(link.href);
    const id = url.pathname.match(/^\/v2\/payments\/captures\/([A-Z0-9]+)$/i)?.[1];
    if (id) return id;
  }
  return "";
}

async function findPayment(event) {
  const resource = event.payload.resource;
  const orderId = event.eventType === "CHECKOUT.ORDER.APPROVED" ? resource.id : resource.supplementary_data?.related_ids?.order_id;
  let payment = orderId ? await PaypalPayment.findOne({ environment: event.environment, paypalOrderId: orderId }) : null;
  if (!payment && orderId && /^[A-Z0-9]+$/i.test(orderId)) {
    // Recover a create-order response lost before its PayPal id reached Mongo.
    const remote = await paypalApi(`/v2/checkout/orders/${orderId}`, { environment: event.environment });
    const localId = remote.purchase_units?.[0]?.custom_id;
    payment = localId ? await PaypalPayment.findOne({ _id: localId, environment: event.environment }) : null;
    if (payment) {
      validatePaypalOrder(remote, payment);
      await PaypalPayment.findOneAndUpdate({ _id: payment._id, paypalOrderId: { $exists: false }, state: "creating" }, {
        $set: { paypalOrderId: remote.id, state: "awaiting_approval" },
      });
    }
  }
  if (!payment) throw paymentError("Webhook payment has not been linked yet", "PAYPAL_WEBHOOK_UNLINKED", 409);
  return payment;
}

async function recordAdjustment(event) {
  let resource = event.payload.resource;
  const dispute = event.eventType.startsWith("CUSTOMER.DISPUTE.");
  const refund = event.eventType === "PAYMENT.CAPTURE.REFUNDED";
  if (refund) {
    if (!/^[A-Z0-9]+$/i.test(resource.id || "")) throw paymentError("Invalid refund id", "PAYPAL_WEBHOOK_INVALID");
    resource = await paypalApi(`/v2/payments/refunds/${resource.id}`, { environment: event.environment });
  }
  const captureIds = dispute
    ? (resource.disputed_transactions || []).map((item) => item.seller_transaction_id)
    : [refund ? captureIdFromLinks(resource) : resource.id];
  const type = dispute ? "dispute" : refund ? "refund" : "reversal";
  let matched = false;
  for (const captureId of captureIds) {
    const payment = await PaypalPayment.findOne({ environment: event.environment, captureId });
    if (!payment) continue;
    matched = true;
    const remote = await paypalApi(`/v2/checkout/orders/${payment.paypalOrderId}`, { environment: payment.environment });
    validatePaypalOrder(remote, payment);
    if (!dispute && resource.amount?.currency_code !== "USD") throw paymentError("Refund currency mismatch", "PAYPAL_AMOUNT_MISMATCH", 409);
    const amountMinor = dispute ? 0 : usdCents(resource.amount?.value);
    if (amountMinor > payment.amountMinor) throw paymentError("Refund amount mismatch", "PAYPAL_AMOUNT_MISMATCH", 409);
    const id = `${event.environment}:${type}:${resource.id}:${captureId}`;
    const status = String(resource.status || (refund ? "COMPLETED" : "REVERSED"));
    await PaypalAdjustment.findOneAndUpdate({ _id: id }, { $set: {
      paymentId: payment._id, externalId: resource.id, type, amountMinor, currency: "USD", status,
    } }, { upsert: true, new: true });
    const Model = paypalOrderModel(payment.kind);
    if (dispute) {
      await Model.findByIdAndUpdate(payment.orderId, { $set: { paypalDisputeStatus: status } });
    } else {
      const adjustments = await PaypalAdjustment.find({ paymentId: payment._id, type: { $in: ["refund", "reversal"] } }).lean();
      const refunded = Math.min(payment.amountMinor, adjustments.reduce((sum, item) => sum + (["COMPLETED", "REVERSED"].includes(item.status) ? item.amountMinor : 0), 0));
      await Model.findByIdAndUpdate(payment.orderId, { $set: { paypalRefundMinor: refunded } });
    }
    const notification = await PaypalAdjustment.findOneAndUpdate({ _id: id, notifiedAt: { $exists: false } }, { $set: { notifiedAt: new Date() } }, { new: true });
    if (notification) {
      await sendTelegramNotification(`<b>PayPal ${type}: manual review required</b>\nOrder: ${payment.kind} ${payment.orderId}\nAmount: USD ${(amountMinor / 100).toFixed(2)}\nCredit/Pro were not automatically revoked.`, { dedupeKey: `paypal-adjustment:${id}` });
    }
  }
  if (!matched) throw paymentError("Adjustment capture has not been linked yet", "PAYPAL_WEBHOOK_UNLINKED", 409);
}

export async function processPaypalWebhookEvent(id) {
  const leaseToken = randomUUID();
  const event = await PaypalWebhookEvent.findOneAndUpdate({
    _id: id, state: { $ne: "done" },
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
  }, { $set: { leaseToken, leaseUntil: new Date(Date.now() + 120_000) } }, { new: true });
  if (!event) return;
  try {
    if (CHECKOUT_EVENTS.has(event.eventType)) await processPaypalPayment((await findPayment(event))._id);
    else await recordAdjustment(event);
    await PaypalWebhookEvent.findOneAndUpdate({ _id: id, leaseToken }, { $set: { state: "done", lastError: "", leaseUntil: null } });
  } catch (error) {
    await PaypalWebhookEvent.findOneAndUpdate({ _id: id, leaseToken }, { $set: {
      state: "pending", leaseUntil: null, attempts: Number(event.attempts || 0) + 1,
      lastError: error.code || "PAYPAL_API_ERROR",
      nextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(Number(event.attempts || 0), 5))),
    } });
    if (Number(event.attempts || 0) >= 2) {
      const alert = await PaypalWebhookEvent.findOneAndUpdate({ _id: id, notifiedAt: { $exists: false } }, {
        $set: { notifiedAt: new Date() },
      }, { new: true });
      if (alert) await sendTelegramNotification(`<b>PayPal webhook reconciliation requires attention</b>\nEvent: ${event.payload.id}\nCode: ${error.code || "PAYPAL_API_ERROR"}`, { dedupeKey: `paypal-webhook:${id}` });
    }
    throw error;
  }
}
