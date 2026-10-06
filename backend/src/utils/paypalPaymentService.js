import { randomUUID } from "node:crypto";
import PaypalPayment from "../models/PaypalPayment.js";
import Topup from "../models/Topup.js";
import MembershipOrder from "../models/MembershipOrder.js";
import User from "../models/User.js";
import { paypalApi, paypalApprovalUrl, paypalConfiguration, paypalRequestId, validatePaypalCapture, validatePaypalOrder } from "./paypal.js";
import { paymentError } from "./paymentMoney.js";
import { releasePaymentReservation, reservePaymentBenefits } from "./paymentBenefitService.js";
import { approvePendingTopup } from "./topupApprovalService.js";
import { approvePendingMembershipOrder, membershipSnapshot } from "./membershipService.js";
import { refreshSubscriptionUser } from "./subscriptionScheduleService.js";

export function paypalOrderModel(kind) {
  if (kind === "topup") return Topup;
  if (kind === "membership") return MembershipOrder;
  throw paymentError("Invalid payment order kind", "PAYMENT_KIND_INVALID");
}

export function paypalPaymentId(kind, orderId) {
  return `${kind}:${orderId}`;
}

async function claimLease(id) {
  const leaseToken = randomUUID();
  const payment = await PaypalPayment.findOneAndUpdate({
    _id: id,
    $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: null }, { leaseUntil: { $lte: new Date() } }],
  }, { $set: { leaseToken, leaseUntil: new Date(Date.now() + 90_000) } }, { new: true });
  if (!payment) throw paymentError("Payment is being processed; retry shortly", "PAYMENT_PROCESSING", 409);
  return payment;
}

async function updatePayment(payment, fields) {
  const updated = await PaypalPayment.findOneAndUpdate(
    { _id: payment._id, leaseToken: payment.leaseToken }, { $set: fields }, { new: true },
  );
  if (!updated) throw paymentError("Payment lease was lost; reconciliation will retry", "PAYMENT_LEASE_LOST", 409);
  return updated;
}

function returnUrl(kind, id, result) {
  const base = String(process.env.CLIENT_URL || process.env.PUBLIC_BASE_URL || "");
  const url = new URL("/topup", base);
  url.searchParams.set("mode", kind === "membership" ? "pro" : "credit");
  url.searchParams.set("payment", `paypal_${result}`);
  url.searchParams.set("orderKind", kind);
  url.searchParams.set("orderId", String(id));
  return url.href;
}

function checkoutResponse(payment) {
  return { provider: "paypal", method: "GET", currency: "USD", checkoutUrl: payment.approvalUrl, orderId: String(payment.orderId), orderKind: payment.kind };
}

export async function createPaypalCheckout(kind, order) {
  const Model = paypalOrderModel(kind);
  const id = paypalPaymentId(kind, order._id);
  let payment = await PaypalPayment.findById(id);
  if (!payment) {
    const config = paypalConfiguration({ newCheckout: true });
    try {
      payment = await PaypalPayment.findOneAndUpdate({ _id: id }, { $setOnInsert: {
        kind, orderId: order._id, userId: order.userId, environment: config.environment,
        merchantId: config.merchantId, invoiceId: `${config.environment}-${kind}-${order._id}`,
        amountMinor: order.amountMinor, state: "creating", expiresAt: order.expiresAt,
        nextAttemptAt: new Date(), attempts: 0,
      } }, { upsert: true, new: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
      payment = await PaypalPayment.findById(id);
    }
  }
  if (payment.state === "settled" || order.status === "approved") return null;
  if (payment.approvalUrl && payment.state === "awaiting_approval" && new Date(payment.expiresAt) > new Date()) return checkoutResponse(payment);
  if (payment.state !== "creating") throw paymentError("Payment order cannot be resumed", "PAYMENT_ORDER_NOT_PENDING", 409);
  payment = await claimLease(id);
  try {
    if (new Date(payment.expiresAt) <= new Date()) throw paymentError("Payment order expired", "PAYMENT_ORDER_EXPIRED", 409);
    const data = await paypalApi("/v2/checkout/orders", {
      method: "POST", environment: payment.environment, requestId: paypalRequestId("create", payment._id),
      body: {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: "default", custom_id: payment._id, invoice_id: payment.invoiceId,
          payee: { merchant_id: payment.merchantId },
          amount: { currency_code: "USD", value: (payment.amountMinor / 100).toFixed(2) },
          description: kind === "membership" ? "3DIPL Pro membership" : "3DIPL Credit top-up",
        }],
        payment_source: { paypal: { experience_context: {
          brand_name: "3DIPL", shipping_preference: "NO_SHIPPING", user_action: "PAY_NOW",
          return_url: returnUrl(kind, order._id, "return"), cancel_url: returnUrl(kind, order._id, "cancel"),
        } } },
      },
    });
    if (!/^[A-Z0-9]+$/i.test(data.id || "")) throw paymentError("Invalid PayPal order", "PAYPAL_ORDER_INVALID", 502);
    const approvalUrl = paypalApprovalUrl(data, payment.environment);
    await updatePayment(payment, { paypalOrderId: data.id, approvalUrl, state: "awaiting_approval", nextAttemptAt: new Date(Date.now() + 30_000), lastError: "" });
    await Model.findByIdAndUpdate(order._id, { $set: { paypalEnvironment: payment.environment, paypalOrderId: data.id, checkoutUrl: approvalUrl, paymentReconciliationStatus: "awaiting_approval" } });
    return checkoutResponse({ ...(payment.toObject?.() || payment), approvalUrl });
  } catch (error) {
    await updatePayment(payment, {
      attempts: Number(payment.attempts || 0) + 1, lastError: error.code || "PAYPAL_API_ERROR",
      nextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(Number(payment.attempts || 0), 5))),
    });
    throw error;
  } finally {
    await updatePayment(payment, { leaseUntil: null, leaseToken: "" });
  }
}

async function settleCapture(payment, order, capture) {
  const checked = validatePaypalCapture(capture, payment);
  if (["PARTIALLY_REFUNDED", "REFUNDED"].includes(capture.status)) {
    await updatePayment(payment, { state: "review", captureId: checked.captureId, capture });
    await paypalOrderModel(payment.kind).findByIdAndUpdate(order._id, {
      $set: { paymentReconciliationStatus: "review", paypalCaptureId: checked.captureId },
    });
    throw paymentError("Capture was adjusted before fulfillment; manual review is required", "PAYPAL_CAPTURE_ADJUSTED", 503);
  }
  if (!["COMPLETED", "PENDING"].includes(capture.status)) {
    return stopPaypalPayment(payment, order, "paypal_capture_denied");
  }
  if (capture.status !== "COMPLETED") {
    await updatePayment(payment, { state: "capture_pending", captureId: checked.captureId, nextAttemptAt: new Date(Date.now() + 30_000) });
    await paypalOrderModel(payment.kind).findByIdAndUpdate(order._id, { $set: { paymentReconciliationStatus: "capture_pending", paypalCaptureId: checked.captureId } });
    return order;
  }
  // Persist the capture before granting benefits so a DB/restart retry never recaptures.
  await updatePayment(payment, { state: "captured", captureId: checked.captureId, capture });
  const Model = paypalOrderModel(payment.kind);
  await Model.findByIdAndUpdate(order._id, { $set: { paymentReconciliationStatus: "captured", paypalCaptureId: checked.captureId, paypalFeeMinor: checked.feeMinor } });
  const fields = {
    gatewayProvider: "paypal", gatewayTransactionId: `paypal:${checked.captureId}`,
    paypalCaptureId: checked.captureId, paypalEnvironment: payment.environment,
    paypalFeeMinor: checked.feeMinor, paymentReconciliationStatus: "settled",
    gatewayPayload: { orderId: payment.paypalOrderId, captureId: checked.captureId, status: capture.status },
  };
  if (order.status !== "approved") {
    if (payment.kind === "topup") await approvePendingTopup(order, fields);
    else await approvePendingMembershipOrder(order, fields);
  }
  const updated = await Model.findById(order._id);
  if (updated?.status !== "approved") throw paymentError("Captured payment requires reconciliation", "PAYPAL_SETTLEMENT_PENDING", 503);
  await updatePayment(payment, { state: "settled", lastError: "" });
  return updated;
}

async function stopPaypalPayment(payment, order, reason) {
  await releasePaymentReservation(payment.kind, order);
  await updatePayment(payment, { state: "stopped", lastError: reason });
  return await paypalOrderModel(payment.kind).findOneAndUpdate({ _id: order._id, status: "pending" }, {
    $set: { status: "rejected", rejectionReason: reason, paymentReconciliationStatus: "stopped" },
  }, { new: true }) || order;
}

export async function processPaypalPayment(id, { captureApproved = true } = {}) {
  let payment = await PaypalPayment.findById(id);
  if (!payment) throw paymentError("PayPal payment not found", "PAYMENT_NOT_FOUND", 404);
  const Model = paypalOrderModel(payment.kind);
  let order = await Model.findById(payment.orderId);
  if (!order) throw paymentError("Payment order not found", "PAYMENT_NOT_FOUND", 404);
  if (payment.state === "settled" && order.status === "approved") return order;
  payment = await claimLease(id);
  try {
    if (payment.capture?.status === "COMPLETED") return await settleCapture(payment, order, payment.capture);
    if (!payment.paypalOrderId) throw paymentError("PayPal order creation is pending", "PAYMENT_PROCESSING", 409);
    let remote = await paypalApi(`/v2/checkout/orders/${payment.paypalOrderId}`, { environment: payment.environment });
    let unit = validatePaypalOrder(remote, payment);
    const captures = unit.payments?.captures || [];
    if (captures.length > 1) throw paymentError("Unexpected multiple captures", "PAYPAL_CAPTURE_MISMATCH", 409);
    if (captures.length) {
      return await settleCapture(payment, order, captures[0]);
    }
    if (remote.status === "VOIDED") {
      return await stopPaypalPayment(payment, order, "paypal_capture_denied");
    }
    if (payment.state !== "capturing" && (new Date(payment.expiresAt) <= new Date() || order.status === "rejected")) {
      await releasePaymentReservation(payment.kind, order);
      await Model.findOneAndUpdate({ _id: order._id, status: "pending" }, { $set: { status: "rejected", rejectionReason: "expired", paymentReconciliationStatus: "stopped" } });
      await updatePayment(payment, { state: "stopped" });
      return Model.findById(order._id);
    }
    if (remote.status !== "APPROVED" || !captureApproved) {
      await updatePayment(payment, { nextAttemptAt: new Date(Date.now() + 30_000) });
      return order;
    }
    const user = await User.findById(payment.userId);
    if (!user || user.isBanned) throw paymentError("Account is unavailable", "PAYMENT_ACCOUNT_UNAVAILABLE", 403);
    await reservePaymentBenefits(payment.kind, order);
    if (payment.captureStartedAt && Date.now() - new Date(payment.captureStartedAt).getTime() > 6 * 60 * 60 * 1000) {
      throw paymentError("Capture outcome requires manual reconciliation", "PAYPAL_CAPTURE_UNCERTAIN", 503);
    }
    await updatePayment(payment, { state: "capturing", captureStartedAt: payment.captureStartedAt || new Date() });
    await paypalApi(`/v2/checkout/orders/${payment.paypalOrderId}/capture`, {
      method: "POST", body: {}, environment: payment.environment,
      requestId: paypalRequestId("capture", payment._id),
    });
    remote = await paypalApi(`/v2/checkout/orders/${payment.paypalOrderId}`, { environment: payment.environment });
    unit = validatePaypalOrder(remote, payment);
    if (unit.payments?.captures?.length !== 1) throw paymentError("Capture confirmation is pending", "PAYPAL_SETTLEMENT_PENDING", 503);
    order = await settleCapture(payment, order, unit.payments.captures[0]);
    return order;
  } catch (error) {
    const state = (await PaypalPayment.findById(id))?.state;
    await updatePayment(payment, {
      attempts: Number(payment.attempts || 0) + 1, lastError: String(error.code || "PAYPAL_API_ERROR"),
      nextAttemptAt: new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** Math.min(Number(payment.attempts || 0), 5))),
      ...(state === "captured" ? { state: "captured" } : {}),
    });
    throw error;
  } finally {
    await updatePayment(payment, { leaseUntil: null, leaseToken: "" });
  }
}

export async function paypalCaptureResponse(kind, orderId, userId) {
  const Model = paypalOrderModel(kind);
  const owned = await Model.findOne({ _id: orderId, userId, gatewayProvider: "paypal" });
  if (!owned) throw paymentError("Payment order not found", "PAYMENT_NOT_FOUND", 404);
  const order = await processPaypalPayment(paypalPaymentId(kind, orderId));
  const user = await refreshSubscriptionUser(await User.findById(userId));
  return { status: order.status, ...(kind === "topup" ? { topup: order, userCredit: user.credit } : { order, membership: membershipSnapshot(user) }) };
}

export async function cancelPaypalPayment(kind, order) {
  if (order.status === "approved") return order;
  const Model = paypalOrderModel(kind);
  const id = paypalPaymentId(kind, order._id);
  const payment = await claimLease(id);
  try {
    if (payment.paypalOrderId) {
      const remote = await paypalApi(`/v2/checkout/orders/${payment.paypalOrderId}`, { environment: payment.environment });
      const unit = validatePaypalOrder(remote, payment);
      const capture = unit.payments?.captures?.[0];
      if (capture && ["COMPLETED", "PENDING"].includes(capture.status)) return await settleCapture(payment, order, capture);
    }
    if (["capturing", "captured", "capture_pending"].includes(payment.state)) {
      throw paymentError("Capture outcome is pending; cancellation cannot discard it", "PAYMENT_PROCESSING", 409);
    }
    await releasePaymentReservation(kind, order);
    await updatePayment(payment, { state: "stopped" });
    return await Model.findOneAndUpdate({ _id: order._id, status: "pending" }, {
      $set: { status: "rejected", canceledAt: new Date(), rejectionReason: "user_cancel", paymentReconciliationStatus: "stopped" },
    }, { new: true }) || await Model.findById(order._id);
  } finally { await updatePayment(payment, { leaseUntil: null, leaseToken: "" }); }
}
