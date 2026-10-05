import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: User } = await import("../src/models/User.js");
const { default: Topup } = await import("../src/models/Topup.js");
const { default: TopupPackage } = await import("../src/models/TopupPackage.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { default: MembershipPlan } = await import("../src/models/MembershipPlan.js");
const { default: Voucher } = await import("../src/models/Voucher.js");
const { default: PaymentReceipt } = await import("../src/models/PaymentReceipt.js");
const { default: PaypalPayment } = await import("../src/models/PaypalPayment.js");
const { default: PaypalWebhookEvent } = await import("../src/models/PaypalWebhookEvent.js");
const { default: PaypalAdjustment } = await import("../src/models/PaypalAdjustment.js");
const { default: Reservation } = await import("../src/models/PaymentBenefitReservation.js");
const { createTopup } = await import("../src/controllers/topupController.js");
const { createMembershipCheckout } = await import("../src/controllers/membershipController.js");
const { paypalCaptureResponse, processPaypalPayment, cancelPaypalPayment } = await import("../src/utils/paypalPaymentService.js");
const { enqueuePaypalWebhook, processPaypalWebhookEvent } = await import("../src/utils/paypalWebhookService.js");
const { verifyPaypalWebhook, validatePaypalOrder, validatePaypalCapture } = await import("../src/utils/paypal.js");
const { reservePaymentBenefits } = await import("../src/utils/paymentBenefitService.js");
const { approvePendingTopup } = await import("../src/utils/topupApprovalService.js");
const { paymentSummary } = await import("../src/utils/paymentReporting.js");
const { buildUserTimeline } = await import("../src/utils/timelineService.js");
const { adminPaypalPrice, usdCents } = await import("../src/utils/paymentMoney.js");
const { paypalConfigurationIssues } = await import("../src/config/paypalConfig.js");
const { reconcilePaypalOnce } = await import("../src/utils/paypalReconciliationJob.js");
const { sepayIpn } = await import("../src/controllers/paymentController.js");
const { adminApproveTopup, adminTransactions } = await import("../src/controllers/adminV1Controller.js");
const { csrfProtection, issueCsrfToken } = await import("../src/middleware/csrf.js");
const { requireAuth } = await import("../src/middleware/requireAuth.js");
const { default: paymentRoutes } = await import("../src/routes/paymentRoutes.js");
const { checkoutCurrency, packagePrice, parseAdminUsdPrice } = await import("../../frontend/src/utils/paymentPresentation.js");

const originalFetch = globalThis.fetch;
let remoteOrders;
let requests;
let captureMode;
let verification;
let pack;
let user;

function response(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }

beforeEach(async () => {
  Object.assign(process.env, {
    PAYPAL_ENABLED: "true", PAYPAL_ENV: "sandbox", PAYPAL_CLIENT_ID: "fixture-client",
    PAYPAL_CLIENT_SECRET: "fixture-secret", PAYPAL_WEBHOOK_ID: "fixture-webhook", PAYPAL_MERCHANT_ID: "MERCHANT1",
    CLIENT_URL: "https://example.test", TELEGRAM_NOTIFICATIONS_ENABLED: "false",
    SEPAY_ENABLED: "true", SEPAY_ENV: "sandbox", SEPAY_MERCHANT_ID: "fixture-sepay", SEPAY_SECRET_KEY: "fixture-secret",
  });
  for (const Model of [User, Topup, TopupPackage, MembershipOrder, MembershipPlan, Voucher, PaymentReceipt, PaypalPayment, PaypalWebhookEvent, PaypalAdjustment, Reservation]) await Model.deleteMany({});
  remoteOrders = new Map();
  requests = [];
  captureMode = "COMPLETED";
  verification = "SUCCESS";
  user = await User.create({ name: "PayPal fixture", email: "paypal@example.test", credit: 0 });
  pack = await TopupPackage.create({ name: "Credit fixture", price: 100000, salePrice: 50000, salePercent: 50, paypalPriceCents: 1234, credit: 100, isActive: true });
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://api-m.sandbox.paypal.com", "No real payment or untrusted host may be called");
    requests.push({ path: parsed.pathname, ...options });
    const body = options.body?.startsWith("{") ? JSON.parse(options.body) : {};
    if (parsed.pathname === "/v1/oauth2/token") return response({ access_token: "mock-token", expires_in: 3600 });
    if (parsed.pathname === "/v1/notifications/verify-webhook-signature") return response({ verification_status: verification });
    if (parsed.pathname === "/v2/checkout/orders" && options.method === "POST") {
      const existing = [...remoteOrders.values()].find((item) => item.requestId === options.headers["PayPal-Request-Id"]);
      if (existing) return response(existing);
      const id = `ORDER${remoteOrders.size + 1}`;
      const remote = { id, intent: "CAPTURE", status: "CREATED", purchase_units: body.purchase_units, requestId: options.headers["PayPal-Request-Id"], links: [{ rel: "payer-action", href: `https://www.sandbox.paypal.com/checkoutnow?token=${id}` }] };
      remoteOrders.set(id, remote);
      return response(remote);
    }
    const match = parsed.pathname.match(/^\/v2\/checkout\/orders\/(ORDER\d+)(\/capture)?$/);
    if (match) {
      const remote = remoteOrders.get(match[1]);
      assert.ok(remote);
      if (match[2]) {
        const capture = { id: `CAPTURE${match[1].slice(5)}`, status: captureMode === "lost-response" ? "COMPLETED" : captureMode, amount: remote.purchase_units[0].amount, final_capture: true, seller_receivable_breakdown: { paypal_fee: { currency_code: "USD", value: "0.50" } } };
        remote.purchase_units[0].payments = { captures: [capture] };
        remote.status = capture.status === "COMPLETED" ? "COMPLETED" : "APPROVED";
        if (captureMode === "lost-response") throw new TypeError("fetch failed after capture");
      }
      return response(remote);
    }
    if (parsed.pathname === "/v2/payments/refunds/REFUND1") return response({ id: "REFUND1", status: "COMPLETED", amount: { currency_code: "USD", value: "2.00" }, links: [{ rel: "up", href: "https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE1" }] });
    throw new Error(`Unexpected mock request: ${parsed.pathname}`);
  };
});
afterEach(() => { globalThis.fetch = originalFetch; });

async function invoke(controller, body, key = "paypal-fixture-idempotency-0001") {
  let status = 200;
  let payload;
  let error;
  await controller({ user, body, get: () => key }, {
    status(code) { status = code; return this; }, json(data) { payload = data; },
  }, (caught) => { error = caught; status = caught.status || 500; });
  return { status, payload, error };
}

async function checkout(body = {}) {
  const result = await invoke(createTopup, { packageId: pack._id, paymentProvider: "paypal", ...body });
  assert.equal(result.status, 200, result.error?.stack || JSON.stringify(result.payload));
  const payment = await PaypalPayment.findById(`topup:${result.payload.topup._id}`);
  return { ...result.payload, operation: payment, remote: remoteOrders.get(payment.paypalOrderId) };
}

function captureRequests() { return requests.filter((request) => request.path.endsWith("/capture")); }

test("USD parsing rejects floating cents and preserves independent package pricing", () => {
  assert.equal(usdCents("12.34"), 1234);
  assert.equal(parseAdminUsdPrice("12.34"), 1234);
  assert.equal(adminPaypalPrice(null), null);
  for (const value of [1.1, -1, "1234", 0]) assert.throws(() => adminPaypalPrice(value));
  assert.throws(() => usdCents("1.001"));
  assert.equal(checkoutCurrency("en"), "USD");
  assert.equal(checkoutCurrency("vi"), "VND");
  assert.equal(packagePrice(pack, "en"), 12.34);
  assert.equal(packagePrice(pack, "vi"), 50000);
});

test("checkout freezes USD price, benefits and provider across replay", async () => {
  const first = await checkout();
  assert.equal(first.topup.amountMinor, 1234);
  assert.equal(first.topup.amount, 12.34);
  assert.equal(first.topup.currency, "USD");
  assert.equal(first.topup.discountAmount, 0);
  await TopupPackage.findByIdAndUpdate(pack._id, { paypalPriceCents: 9900, credit: 999 });
  const replay = await checkout();
  assert.equal(replay.topup.amountMinor, 1234);
  assert.equal(replay.topup.credit, 100);
  assert.equal(remoteOrders.size, 1);
  const conflict = await invoke(createTopup, { packageId: pack._id, paymentProvider: "sepay" });
  assert.equal(conflict.status, 409);
});

test("missing USD price and disabled PayPal fail closed without orders", async () => {
  await TopupPackage.findByIdAndUpdate(pack._id, { paypalPriceCents: null });
  const missing = await invoke(createTopup, { packageId: pack._id, paymentProvider: "paypal" });
  assert.equal(missing.error.code, "PAYPAL_PRICE_UNAVAILABLE");
  assert.equal(await Topup.countDocuments({}), 0);
  process.env.PAYPAL_ENABLED = "false";
  assert.equal((await invoke(createTopup, { packageId: pack._id, paymentProvider: "paypal" })).status, 503);
  assert.equal(await Topup.countDocuments({}), 0);
});

test("free EN Trial activates immediately with PayPal disabled and no USD price", async () => {
  process.env.PAYPAL_ENABLED = "false";
  const plan = await MembershipPlan.create({ code: "TRIAL", name: "Trial", price: 0, durationDays: 7, dailyDownloadLimit: 100, maxPurchasesPerUser: 1, isActive: true });
  const result = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "paypal" });
  assert.equal(result.status, 200, result.error?.stack);
  assert.equal(result.payload.order.gatewayProvider, "internal_free");
  assert.equal(result.payload.status, "approved");
  assert.equal(remoteOrders.size, 0);
  assert.equal((await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "paypal" }, "trial-second-purchase-0002")).status, 409);
});

test("approval alone does not grant; concurrent captures create one receipt and one credit grant", async () => {
  const result = await checkout();
  await processPaypalPayment(result.operation._id);
  assert.equal((await User.findById(user._id)).credit, 0);
  result.remote.status = "APPROVED";
  const attempts = await Promise.allSettled([processPaypalPayment(result.operation._id), processPaypalPayment(result.operation._id)]);
  assert.equal(attempts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 100);
  await processPaypalPayment(result.operation._id);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
  const receipt = await PaymentReceipt.findOne({});
  assert.equal(receipt.gatewayTransactionId, "paypal:CAPTURE1");
  assert.equal(receipt.currency, "USD");
  assert.equal(receipt.amountMinor, 1234);
});

test("capture ownership is enforced", async () => {
  const result = await checkout();
  await assert.rejects(paypalCaptureResponse("topup", result.topup._id, "000000000000000000000001"), { code: "PAYMENT_NOT_FOUND" });
  assert.equal(captureRequests().length, 0);
});

test("wrong merchant, currency, amount or capture never grants benefits", async () => {
  const result = await checkout();
  for (const changes of [{ payee: { merchant_id: "OTHER" } }, { amount: { currency_code: "EUR", value: "12.34" } }, { amount: { currency_code: "USD", value: "12.35" } }]) {
    const tampered = structuredClone(result.remote);
    Object.assign(tampered.purchase_units[0], changes);
    assert.throws(() => validatePaypalOrder(tampered, result.operation), { code: "PAYPAL_ORDER_MISMATCH" });
  }
  assert.throws(() => validatePaypalCapture({ id: "CAPTURE1", amount: { currency_code: "USD", value: "12.33" }, final_capture: true }, result.operation), { code: "PAYPAL_CAPTURE_MISMATCH" });
  result.remote.status = "APPROVED";
  result.remote.purchase_units[0].payee.merchant_id = "OTHER";
  await assert.rejects(processPaypalPayment(result.operation._id), { code: "PAYPAL_ORDER_MISMATCH" });
  assert.equal(captureRequests().length, 0);
  assert.equal((await User.findById(user._id)).credit, 0);
});

test("lost capture response is reconciled before retry without a second capture", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  captureMode = "lost-response";
  await assert.rejects(processPaypalPayment(result.operation._id));
  assert.equal((await PaypalPayment.findById(result.operation._id)).state, "capturing");
  process.env.PAYPAL_ENABLED = "false";
  await processPaypalPayment(result.operation._id);
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("PENDING capture waits and late completion survives local expiry/cancel", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  captureMode = "PENDING";
  await processPaypalPayment(result.operation._id);
  assert.equal((await User.findById(user._id)).credit, 0);
  assert.equal((await cancelPaypalPayment("topup", await Topup.findById(result.topup._id))).status, "pending");
  await Topup.findByIdAndUpdate(result.topup._id, { status: "rejected", rejectionReason: "expired" });
  await PaypalPayment.findByIdAndUpdate(result.operation._id, { expiresAt: new Date(0) });
  result.remote.purchase_units[0].payments.captures[0].status = "COMPLETED";
  await processPaypalPayment(result.operation._id);
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(captureRequests().length, 1);
});

test("voucher reservation is shared with SePay and survives expiry after capture", async () => {
  await Voucher.create({ code: "PAYPAL10", targetKind: "all", discountPercent: 10, creditBonus: 5, usageLimit: 10, usedCount: 0, perUserLimit: 1, expireAt: new Date(Date.now() + 3600000), isActive: true });
  const result = await checkout({ voucherCode: "PAYPAL10" });
  assert.equal(result.topup.amountMinor, 1111);
  assert.equal(result.topup.credit, 105);
  await reservePaymentBenefits("topup", result.topup);
  const sepayOrder = await Topup.create({ userId: user._id, packageId: pack._id, status: "pending", amount: 50000, credit: 100, currency: "VND", gatewayProvider: "sepay", voucherCode: "PAYPAL10" });
  await assert.rejects(approvePendingTopup(sepayOrder), { code: "VOUCHER_USER_LIMIT_REACHED" });
  await Voucher.findOneAndUpdate({ code: "PAYPAL10" }, { expireAt: new Date(0) });
  result.remote.status = "APPROVED";
  await processPaypalPayment(result.operation._id);
  assert.equal((await User.findById(user._id)).credit, 105);
  assert.equal((await Voucher.findOne({ code: "PAYPAL10" })).usedCount, 1);
});

test("failed pre-capture purchase limits do not take money", async () => {
  await TopupPackage.findByIdAndUpdate(pack._id, { maxTopupsPerUser: 1 });
  const result = await checkout();
  await Topup.create({ userId: user._id, packageId: pack._id, status: "approved", credit: 100, amount: 50000 });
  result.remote.status = "APPROVED";
  await assert.rejects(processPaypalPayment(result.operation._id), { code: "PACKAGE_PURCHASE_LIMIT_REACHED" });
  assert.equal(captureRequests().length, 0);
});

test("manual/admin approval cannot grant an unpaid PayPal order", async () => {
  const result = await checkout();
  await assert.rejects(approvePendingTopup(result.topup), { code: "PAYPAL_CAPTURE_REQUIRED" });
  assert.equal((await User.findById(user._id)).credit, 0);
});

test("durable duplicate webhook completes a purchase when the browser is closed", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  const event = { id: "WEBHOOK1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: result.remote.id } };
  await enqueuePaypalWebhook(event, "sandbox");
  await enqueuePaypalWebhook(event, "sandbox");
  assert.equal(await PaypalWebhookEvent.countDocuments({}), 1);
  await processPaypalWebhookEvent("sandbox:WEBHOOK1");
  await processPaypalWebhookEvent("sandbox:WEBHOOK1");
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("webhook recovers a lost create-order DB response from a canonical remote order", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  await PaypalPayment.findByIdAndUpdate(result.operation._id, { $unset: { paypalOrderId: "" }, $set: { state: "creating" } });
  await enqueuePaypalWebhook({ id: "RECOVER1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: result.remote.id } }, "sandbox");
  await processPaypalWebhookEvent("sandbox:RECOVER1");
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("webhook signature rejection and certificate allowlist fail before queuing", async () => {
  const headers = { "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT1", "paypal-transmission-id": "TEST", "paypal-transmission-sig": "SIG", "paypal-transmission-time": new Date().toISOString() };
  const req = { body: { id: "WEBHOOK1" }, get: (name) => headers[name] };
  verification = "FAILURE";
  await assert.rejects(verifyPaypalWebhook(req), { status: 401 });
  for (const url of ["http://localhost/cert", "garbage", "https://api.paypal.com/cert"]) {
    headers["paypal-cert-url"] = url;
    await assert.rejects(verifyPaypalWebhook(req), { status: 401 });
  }
  assert.equal(await PaypalWebhookEvent.countDocuments({}), 0);
});

test("refund/dispute are idempotent and never automatically revoke Credit", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  await processPaypalPayment(result.operation._id);
  for (const id of ["REFUNDEVENT1", "REFUNDEVENT2"]) {
    await enqueuePaypalWebhook({ id, event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND1" } }, "sandbox");
    await processPaypalWebhookEvent(`sandbox:${id}`);
  }
  await enqueuePaypalWebhook({ id: "DISPUTEEVENT1", event_type: "CUSTOMER.DISPUTE.CREATED", resource: { id: "DISPUTE1", status: "OPEN", disputed_transactions: [{ seller_transaction_id: "CAPTURE1" }] } }, "sandbox");
  await processPaypalWebhookEvent("sandbox:DISPUTEEVENT1");
  const order = await Topup.findById(result.topup._id);
  assert.equal(order.paypalRefundMinor, 200);
  assert.equal(order.paypalDisputeStatus, "OPEN");
  assert.equal(order.status, "approved");
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(await PaypalAdjustment.countDocuments({ type: "refund" }), 1);
});

test("history and reports preserve original currency without adding USD to VND", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  await processPaypalPayment(result.operation._id);
  const order = await Topup.findById(result.topup._id);
  const totals = paymentSummary([{ amount: 50000 }, order], [{ amount: 199000 }]);
  assert.equal(totals.VND.grossMinor, 249000);
  assert.equal(totals.USD.grossMinor, 1234);
  assert.equal(totals.USD.feesMinor, 50);
  assert.equal(totals.USD.netMinor, 1184);
  const timeline = await buildUserTimeline({ userId: user._id, type: "credit" });
  assert.equal(timeline.events[0].metadata.currency, "USD");
  assert.equal(timeline.events[0].metadata.amountMoney, 12.34);
  let payload;
  await adminTransactions({ query: { kind: "all" } }, { json(value) { payload = value; } }, (error) => { throw error; });
  assert.equal(payload.transactions[0].currency, "USD");
  assert.equal(payload.transactions[0].amountMinor, 1234);
  assert.equal(payload.transactions[0].paypalCaptureId, "CAPTURE1");
  assert.equal(payload.transactions[0].paypalFeeMinor, 50);
});

test("PayPal config is optional while disabled, but enabled checkout requires all credentials", () => {
  assert.deepEqual(paypalConfigurationIssues({ PAYPAL_ENABLED: "false" }), []);
  assert.ok(paypalConfigurationIssues({ PAYPAL_ENABLED: "true", PAYPAL_ENV: "live" }).length >= 4);
});

test("captured payment survives a failed benefit write and retries without charging again", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  const originalUpdate = User.findByIdAndUpdate;
  User.findByIdAndUpdate = () => { throw new Error("simulated Atlas outage"); };
  try { await assert.rejects(processPaypalPayment(result.operation._id), /simulated Atlas outage/); }
  finally { User.findByIdAndUpdate = originalUpdate; }
  assert.equal((await PaypalPayment.findById(result.operation._id)).state, "captured");
  assert.equal((await User.findById(user._id)).credit, 0);
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
  assert.equal((await Reservation.findById(result.operation._id)).state, "held");
  await processPaypalPayment(result.operation._id);
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(captureRequests().length, 1);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
});

test("capture and a completion webhook racing grant once", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  await enqueuePaypalWebhook({ id: "RACING1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: result.remote.id } }, "sandbox");
  await Promise.allSettled([processPaypalPayment(result.operation._id), processPaypalWebhookEvent("sandbox:RACING1")]);
  await processPaypalWebhookEvent("sandbox:RACING1");
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(captureRequests().length, 1);
});

test("paid Pro uses USD and stacks once on the current membership", async () => {
  const currentExpiry = new Date(Date.now() + 30 * 86400000);
  await User.findByIdAndUpdate(user._id, { proUntil: currentExpiry, proDailyDownloadLimit: 100 });
  const plan = await MembershipPlan.create({ code: "WEEK", name: "Weekly", price: 49000, paypalPriceCents: 250, durationDays: 7, dailyDownloadLimit: 100, isActive: true });
  const result = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "paypal" });
  assert.equal(result.status, 200, result.error?.stack);
  const order = result.payload.order;
  const operation = await PaypalPayment.findById(`membership:${order._id}`);
  remoteOrders.get(operation.paypalOrderId).status = "APPROVED";
  await processPaypalPayment(operation._id);
  const firstExpiry = (await User.findById(user._id)).proUntil;
  assert.ok(new Date(firstExpiry) > currentExpiry);
  await processPaypalPayment(operation._id);
  assert.equal((await User.findById(user._id)).proUntil, firstExpiry);
  assert.equal((await PaymentReceipt.findOne({ membershipOrderId: order._id })).amountMinor, 250);
});

test("USD voucher can make Pro free without calling the gateway", async () => {
  const plan = await MembershipPlan.create({ code: "CENT", name: "Small Pro", price: 49000, paypalPriceCents: 1, durationDays: 7, dailyDownloadLimit: 100, isActive: true });
  await Voucher.create({ code: "PRO90", targetKind: "pro", discountPercent: 90, usageLimit: 10, usedCount: 0, perUserLimit: 1, expireAt: new Date(Date.now() + 3600000), isActive: true });
  const result = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "paypal", voucherCode: "PRO90" });
  assert.equal(result.status, 200, result.error?.stack);
  assert.equal(result.payload.status, "approved");
  assert.equal(result.payload.order.amountMinor, 0);
  assert.equal(remoteOrders.size, 0);
});

test("background reconciliation keeps working after PayPal is disabled", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  await PaypalPayment.findByIdAndUpdate(result.operation._id, { nextAttemptAt: new Date(0) });
  process.env.PAYPAL_ENABLED = "false";
  await reconcilePaypalOnce();
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("an expired unapproved order is stopped without taking money", async () => {
  const result = await checkout();
  await PaypalPayment.findByIdAndUpdate(result.operation._id, { expiresAt: new Date(0) });
  await processPaypalPayment(result.operation._id);
  assert.equal((await Topup.findById(result.topup._id)).status, "rejected");
  assert.equal(captureRequests().length, 0);
});

test("SePay cannot approve a PayPal order even if its payment code and amount match", async () => {
  const result = await checkout();
  await Topup.findByIdAndUpdate(result.topup._id, { paymentCode: "NAPFIXTURE1" });
  let payload;
  await sepayIpn({ get: (name) => name === "content-type" ? "application/json" : "fixture-secret", body: { notification_type: "ORDER_PAID", order: { order_invoice_number: "NAPFIXTURE1", order_amount: 12.34 }, transaction: { transaction_id: "TXTEST", transaction_status: "APPROVED" } } }, { json(value) { payload = value; return this; }, status() { return this; } }, (error) => { throw error; });
  assert.equal(payload.reason, "topup_not_found_or_already_handled");
  assert.equal((await Topup.findById(result.topup._id)).status, "pending");
  assert.equal((await User.findById(user._id)).credit, 0);
});

test("Credit voucher rounding never drops checkout below one USD cent", async () => {
  await TopupPackage.findByIdAndUpdate(pack._id, { paypalPriceCents: 1 });
  await Voucher.create({ code: "CENT90", targetKind: "credit", discountPercent: 90, usageLimit: 10, usedCount: 0, perUserLimit: 1, expireAt: new Date(Date.now() + 3600000), isActive: true });
  const result = await checkout({ voucherCode: "CENT90" });
  assert.equal(result.topup.amountMinor, 1);
  assert.equal(result.topup.discountAmountMinor, 0);
  assert.equal(result.remote.purchase_units[0].amount.value, "0.01");
});

test("declined capture releases reserved benefits and cannot grant on retry", async () => {
  await Voucher.create({ code: "DECLINE10", targetKind: "all", discountPercent: 10, usageLimit: 10, usedCount: 0, perUserLimit: 1, expireAt: new Date(Date.now() + 3600000), isActive: true });
  const result = await checkout({ voucherCode: "DECLINE10" });
  result.remote.status = "APPROVED";
  captureMode = "DECLINED";
  assert.equal((await processPaypalPayment(result.operation._id)).status, "rejected");
  assert.equal((await PaypalPayment.findById(result.operation._id)).state, "stopped");
  assert.equal((await Voucher.findOne({ code: "DECLINE10" })).usedCount, 0);
  assert.equal((await Reservation.findById(result.operation._id)).state, "released");
  await processPaypalPayment(result.operation._id);
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 0);
  assert.equal(await PaymentReceipt.countDocuments({}), 0);
});

test("concurrent orders share the same package purchase limit before taking money", async () => {
  const first = await checkout();
  const second = await invoke(createTopup, { packageId: pack._id, paymentProvider: "paypal" }, "paypal-second-order-0002");
  assert.equal(second.status, 200, second.error?.stack);
  const secondPayment = await PaypalPayment.findById(`topup:${second.payload.topup._id}`);
  await TopupPackage.findByIdAndUpdate(pack._id, { maxTopupsPerUser: 1 });
  first.remote.status = "APPROVED";
  remoteOrders.get(secondPayment.paypalOrderId).status = "APPROVED";
  const results = await Promise.allSettled([processPaypalPayment(first.operation._id), processPaypalPayment(secondPayment._id)]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("daily Pro add-on uses USD without replacing the current monthly membership", async () => {
  const currentExpiry = new Date(Date.now() + 30 * 86400000);
  await User.findByIdAndUpdate(user._id, { proUntil: currentExpiry, proDailyDownloadLimit: 100 });
  const plan = await MembershipPlan.create({ code: "DAILY", name: "Daily add-on", price: 20000, paypalPriceCents: 100, durationDays: 1, dailyDownloadLimit: 100, isActive: true });
  const result = await invoke(createMembershipCheckout, { planId: plan._id, paymentProvider: "paypal" });
  assert.equal(result.status, 200, result.error?.stack);
  const id = `membership:${result.payload.order._id}`;
  remoteOrders.get((await PaypalPayment.findById(id)).paypalOrderId).status = "APPROVED";
  const approved = await processPaypalPayment(id);
  assert.equal(approved.currency, "USD");
  assert.equal(approved.isQuotaAddon, true);
  assert.equal(approved.quotaBoostAmount, 100);
  assert.equal((await User.findById(user._id)).proUntil, currentExpiry.toISOString());
  await processPaypalPayment(id);
  assert.equal(await PaymentReceipt.countDocuments({}), 1);
});

test("admin reconciliation verifies PayPal instead of granting an unpaid order", async () => {
  const result = await checkout();
  let payload;
  const req = { params: { id: result.topup._id }, user };
  const res = { json(value) { payload = value; }, status() { return this; } };
  const next = (error) => { throw error; };
  await adminApproveTopup(req, res, next);
  assert.equal(payload.topup.status, "pending");
  assert.equal((await User.findById(user._id)).credit, 0);
  result.remote.status = "APPROVED";
  await adminApproveTopup(req, res, next);
  assert.equal(payload.topup.status, "approved");
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("PayPal webhook alone bypasses CSRF; capture still requires CSRF and authentication", () => {
  for (const path of ["/api/payments/paypal/webhook", "/api/payments/paypal/orders/topup/000000000000000000000001/capture"]) {
    let nextCalled = false;
    let status;
    csrfProtection({ method: "POST", path, cookies: {}, get: () => "", ip: "127.0.0.1" }, {
      status(code) { status = code; return this; }, json() {},
    }, () => { nextCalled = true; });
    assert.equal(nextCalled, path.endsWith("/webhook"));
    if (!nextCalled) assert.equal(status, 403);
  }
  let status;
  requireAuth({ isAuthenticated: () => false }, { status(code) { status = code; return this; }, json() {} }, () => assert.fail("Anonymous capture must not be accepted"));
  assert.equal(status, 401);
});

test("refund preceding fulfillment preserves its capture and reservation for manual review", async () => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  captureMode = "lost-response";
  await assert.rejects(processPaypalPayment(result.operation._id));
  result.remote.purchase_units[0].payments.captures[0].status = "REFUNDED";
  await assert.rejects(processPaypalPayment(result.operation._id), { code: "PAYPAL_CAPTURE_ADJUSTED" });
  assert.equal((await PaypalPayment.findById(result.operation._id)).state, "review");
  assert.equal((await Reservation.findById(result.operation._id)).state, "held");
  await enqueuePaypalWebhook({ id: "EARLYREFUND1", event_type: "PAYMENT.CAPTURE.REFUNDED", resource: { id: "REFUND1" } }, "sandbox");
  await processPaypalWebhookEvent("sandbox:EARLYREFUND1");
  assert.equal((await Topup.findById(result.topup._id)).paypalRefundMinor, 200);
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 0);
});

async function httpFixture(t) {
  const app = express();
  app.use(express.json(), cookieParser());
  app.use((req, res, next) => {
    req.user = req.get("x-fixture-user") === String(user._id) ? user : undefined;
    req.isAuthenticated = () => Boolean(req.user);
    next();
  });
  app.get("/api/auth/csrf", issueCsrfToken);
  app.use(csrfProtection);
  app.use("/api", paymentRoutes);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    return res.status(error.status || 500).json({ code: error.code });
  });
  const server = await new Promise((resolve) => { const listener = app.listen(0, "127.0.0.1", () => resolve(listener)); });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const tokenResponse = await originalFetch(base + "/api/auth/csrf");
  const { csrfToken } = await tokenResponse.json();
  const headers = {
    "content-type": "application/json", "x-csrf-token": csrfToken,
    cookie: tokenResponse.headers.get("set-cookie").split(";")[0],
    "x-fixture-user": String(user._id),
  };
  const post = (url, body = {}, overrides = {}) => originalFetch(base + url, { method: "POST", headers: { ...headers, ...overrides }, body: JSON.stringify(body) });
  return { post };
}

test("HTTP capture checks CSRF, login, ownership, validation and request limits", async (t) => {
  const result = await checkout();
  const { post } = await httpFixture(t);
  const path = `/api/payments/paypal/orders/topup/${result.topup._id}/capture`;
  assert.equal((await post(path, {}, { "x-csrf-token": "" })).status, 403);
  assert.equal((await post(path, {}, { "x-fixture-user": "" })).status, 401);
  assert.equal((await post(path.replace(result.topup._id, "000000000000000000000099"))).status, 404);
  assert.equal((await post(path, { amount: 0 })).status, 400);
  result.remote.status = "APPROVED";
  assert.equal((await post(path)).status, 200);
  let response;
  for (let i = 0; i < 31; i += 1) response = await post(path);
  assert.equal(response.status, 429);
  assert.equal(captureRequests().length, 1);
  assert.equal((await User.findById(user._id)).credit, 100);
});

test("HTTP webhook rejects forgery before persistence and durably acknowledges duplicates", async (t) => {
  const result = await checkout();
  result.remote.status = "APPROVED";
  const { post } = await httpFixture(t);
  const headers = {
    "x-fixture-user": "", "x-csrf-token": "", cookie: "",
    "paypal-auth-algo": "SHA256withRSA", "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT1",
    "paypal-transmission-id": "TEST", "paypal-transmission-sig": "SIG", "paypal-transmission-time": new Date().toISOString(),
  };
  const event = { id: "HTTPWEBHOOK1", event_type: "CHECKOUT.ORDER.APPROVED", resource: { id: result.remote.id } };
  verification = "FAILURE";
  assert.equal((await post("/api/payments/paypal/webhook", event, headers)).status, 401);
  assert.equal(await PaypalWebhookEvent.countDocuments({}), 0);
  verification = "SUCCESS";
  assert.equal((await post("/api/payments/paypal/webhook", event, headers)).status, 200);
  assert.equal((await post("/api/payments/paypal/webhook", event, headers)).status, 200);
  assert.equal(await PaypalWebhookEvent.countDocuments({}), 1);
  assert.equal((await User.findById(user._id)).credit, 0);
  await processPaypalWebhookEvent("sandbox:HTTPWEBHOOK1");
  assert.equal((await User.findById(user._id)).credit, 100);
});
