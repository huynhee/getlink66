import PaypalPayment from "../models/PaypalPayment.js";
import PaypalWebhookEvent from "../models/PaypalWebhookEvent.js";
import { paypalConfiguration } from "./paypal.js";
import { createPaypalCheckout, paypalOrderModel, processPaypalPayment } from "./paypalPaymentService.js";
import { processPaypalWebhookEvent } from "./paypalWebhookService.js";
import { sendTelegramNotification } from "./telegramNotifier.js";
import logger from "./logger.js";

let timer;
let running;

export async function reconcilePaypalOnce() {
  const config = paypalConfiguration();
  const events = await PaypalWebhookEvent.find({ environment: config.environment, state: "pending", nextAttemptAt: { $lte: new Date() } }).sort({ nextAttemptAt: 1 }).limit(10).lean();
  for (const event of events) {
    try { await processPaypalWebhookEvent(event._id); }
    catch (error) { logger.warn({ code: error.code, eventId: event._id }, "PayPal webhook reconciliation pending"); }
  }
  const payments = await PaypalPayment.find({ environment: config.environment, state: { $nin: ["settled", "stopped"] }, nextAttemptAt: { $lte: new Date() } }).sort({ nextAttemptAt: 1 }).limit(25).lean();
  for (const payment of payments) {
    try {
      if (payment.state === "creating") {
        const order = await paypalOrderModel(payment.kind).findById(payment.orderId);
        if (new Date(payment.expiresAt) <= new Date()) {
          await PaypalPayment.findByIdAndUpdate(payment._id, { $set: { state: "stopped" } });
          await paypalOrderModel(payment.kind).findOneAndUpdate({ _id: payment.orderId, status: "pending" }, {
            $set: { status: "rejected", rejectionReason: "expired", paymentReconciliationStatus: "stopped" },
          });
        } else if (order) await createPaypalCheckout(payment.kind, order);
      } else await processPaypalPayment(payment._id);
    } catch (error) {
      logger.warn({ code: error.code, paymentId: payment._id }, "PayPal payment reconciliation pending");
      if (Number(payment.attempts || 0) >= 3 && !payment.alertedAt) {
        const alert = await PaypalPayment.findOneAndUpdate({ _id: payment._id, alertedAt: { $exists: false } }, { $set: { alertedAt: new Date() } }, { new: true });
        if (alert) await sendTelegramNotification(`<b>PayPal reconciliation requires attention</b>\nOrder: ${payment.orderId}\nCode: ${error.code || "PAYPAL_API_ERROR"}`, { dedupeKey: `paypal-reconcile:${payment._id}` });
      }
    }
  }
  return { events: events.length, payments: payments.length };
}

export function startPaypalReconciliationJob() {
  try { paypalConfiguration(); } catch { return; }
  const tick = () => {
    if (running) return;
    running = reconcilePaypalOnce().catch((error) => logger.warn({ code: error.code }, "PayPal reconciliation failed")).finally(() => { running = null; });
  };
  timer = setInterval(tick, 30_000);
  timer.unref();
  tick();
}

export async function stopPaypalReconciliationJob() {
  clearInterval(timer);
  await running;
}
