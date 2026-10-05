import PaypalPayment from "../models/PaypalPayment.js";
import { paymentError } from "./paymentMoney.js";

export async function assertPaypalSettlement(kind, order, fields, session) {
  if (order.gatewayProvider !== "paypal") return;
  let query = PaypalPayment.findOne({ _id: `${kind}:${order._id}`, state: "captured", captureId: fields.paypalCaptureId });
  if (session) query = query.session(session);
  const payment = await query;
  if (!payment || payment.capture?.status !== "COMPLETED" || fields.gatewayTransactionId !== `paypal:${payment.captureId}` || order.currency !== "USD" || order.amountMinor !== payment.amountMinor) {
    throw paymentError("PayPal orders require a verified completed capture", "PAYPAL_CAPTURE_REQUIRED", 409);
  }
}
