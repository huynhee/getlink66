import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
Object.assign(process.env, { TELEGRAM_NOTIFICATIONS_ENABLED: "false", SEPAY_ENABLED: "true",
  SEPAY_ENV: "sandbox", SEPAY_MERCHANT_ID: "fixture-merchant", SEPAY_SECRET_KEY: "fixture-secret", CLIENT_URL: "http://localhost:5173" });

const { default: Plan } = await import("../src/models/MembershipPlan.js");
const { default: Voucher } = await import("../src/models/Voucher.js");
const { default: User } = await import("../src/models/User.js");
const { default: Order } = await import("../src/models/MembershipOrder.js");
const { default: Reservation } = await import("../src/models/PaymentBenefitReservation.js");
const { createVoucher, updateVoucher, listVouchers } = await import("../src/controllers/adminController.js");
const { applyVoucher } = await import("../src/controllers/voucherController.js");
const { createMembershipCheckout } = await import("../src/controllers/membershipController.js");
const { assertVoucherTarget, safeVoucherPayload } = await import("../src/utils/voucherCheckoutService.js");
const { reservePaymentBenefits } = await import("../src/utils/paymentBenefitService.js");
const { subscriptionVoucherApplies } = await import("../../frontend/src/utils/membershipPresentation.js");

let allowed, other, user;
beforeEach(async () => {
  for (const model of [Plan, Voucher, User, Order, Reservation]) await model.deleteMany({});
  allowed = await Plan.create({ code: "DAILY100", name: "Daily 100", price: 10000, isActive: true,
    billingPeriod: "day", durationDays: 1, dailyDownloadLimit: 100 });
  other = await Plan.create({ code: "MONTH50", name: "Month 50", price: 20000, isActive: true,
    billingPeriod: "month", durationDays: 30, dailyDownloadLimit: 50 });
  user = await User.create({ email: "voucher-scope@example.test", credit: 0 });
});

function payload(fields = {}) {
  return { code: "SCOPE10", targetKind: "pro", discountPercent: 10, creditBonus: 0, usageLimit: 20,
    perUserLimit: 0, expireAt: new Date(Date.now() + 86400000).toISOString(), isActive: true,
    applicablePackageIds: [], applicablePlanIds: [allowed._id], ...fields };
}

async function invoke(handler, req = {}) {
  let status = 200, body;
  await handler({ body: {}, params: {}, user, get: () => "", ...req }, {
    status(code) { status = code; return this; }, json(value) { body = value; },
  }, (error) => { status = error.status || 500; body = { message: error.message, code: error.code }; });
  return { status, body };
}

async function scopedVoucher(fields = {}) {
  return Voucher.create({ ...payload(fields), usedCount: 0 });
}

test("admin saves, lists and edits selected Subscription plans with populated names", async () => {
  const created = await invoke(createVoucher, { body: payload({ applicablePlanIds: [allowed._id, allowed._id] }) });
  assert.equal(created.status, 200);
  assert.deepEqual(created.body.voucher.applicablePlanIds, [allowed._id]);
  const listed = await invoke(listVouchers);
  assert.equal(listed.body.vouchers[0].applicablePlanIds[0].name, "Daily 100");
  const edited = await invoke(updateVoucher, { params: { id: created.body.voucher._id }, body: payload({ applicablePlanIds: [other._id] }) });
  assert.equal(edited.status, 200);
  assert.equal(String(edited.body.voucher.applicablePlanIds[0]?._id || edited.body.voucher.applicablePlanIds[0]), other._id);
  assert.equal((await invoke(listVouchers)).body.vouchers[0].applicablePlanIds[0].name, "Month 50");
  assert.deepEqual((await Voucher.findById(created.body.voucher._id)).applicablePlanIds, [other._id]);
});

test("admin rejects malformed, nonexistent, archived or wrong-domain plan scopes", async () => {
  await Plan.findByIdAndUpdate(other._id, { isArchived: true });
  for (const fields of [
    { applicablePlanIds: "bad" }, { applicablePlanIds: ["bad"] },
    { applicablePlanIds: ["aaaaaaaaaaaaaaaaaaaaaaaa"] }, { applicablePlanIds: [other._id] },
    { targetKind: "credit" }, { targetKind: "all" },
  ]) assert.equal((await invoke(createVoucher, { body: payload(fields) })).status, 400);
  assert.equal(await Voucher.countDocuments({}), 0);
});

test("multiple selected plans are allowed, and clearing the list restores all-plan applicability", async () => {
  const third = await Plan.create({ code: "YEAR20", name: "Year 20", price: 50000, isActive: true,
    billingPeriod: "year", durationDays: 365, dailyDownloadLimit: 20 });
  const created = await invoke(createVoucher, { body: payload({ applicablePlanIds: [allowed._id, other._id] }) });
  assert.equal(created.status, 200);
  for (const planId of [allowed._id, other._id]) {
    assert.equal((await invoke(applyVoucher, { body: { code: "SCOPE10", target: "membership", planId } })).status, 200);
  }
  assert.equal((await invoke(applyVoucher, { body: { code: "SCOPE10", target: "membership", planId: third._id } })).status, 400);
  const edited = await invoke(updateVoucher, { params: { id: created.body.voucher._id }, body: payload({ applicablePlanIds: [] }) });
  assert.equal(edited.status, 200);
  assert.deepEqual((await Voucher.findById(created.body.voucher._id)).applicablePlanIds, []);
  assert.equal((await invoke(applyVoucher, { body: { code: "SCOPE10", target: "membership", planId: third._id } })).status, 200);
});

test("disabled plans may be selected, and existing archived scopes survive older admin updates", async () => {
  await Plan.findByIdAndUpdate(allowed._id, { isActive: false });
  const created = await invoke(createVoucher, { body: payload() });
  assert.equal(created.status, 200);
  await Plan.findByIdAndUpdate(allowed._id, { isArchived: true });
  const body = payload({ description: "Updated description" });
  delete body.applicablePlanIds;
  const edited = await invoke(updateVoucher, { params: { id: created.body.voucher._id }, body });
  assert.equal(edited.status, 200);
  assert.deepEqual((await Voucher.findById(created.body.voucher._id)).applicablePlanIds, [allowed._id]);
});

test("scope enforcement handles raw/populated IDs and retains unscoped legacy vouchers", () => {
  for (const ids of [[allowed._id], [{ _id: allowed._id, name: "Daily 100" }]]) {
    const voucher = payload({ applicablePlanIds: ids });
    assert.doesNotThrow(() => assertVoucherTarget(voucher, { target: "membership", planId: allowed._id }));
    assert.throws(() => assertVoucherTarget(voucher, { target: "membership", planId: other._id }), /Subscription/);
    assert.throws(() => assertVoucherTarget(voucher, { target: "membership" }), /Subscription/);
    assert.throws(() => assertVoucherTarget(voucher, { target: "topup", packageId: allowed._id }), /Pro/);
    assert.deepEqual(safeVoucherPayload(voucher).applicablePlanIds, [allowed._id]);
  }
  for (const voucher of [{ targetKind: "pro", discountPercent: 10 }, { discountPercent: 10 }]) {
    assert.doesNotThrow(() => assertVoucherTarget(voucher, { target: "membership" }));
  }
});

test("apply preview accepts the selected plan and rejects other, missing or invalid plans", async () => {
  await scopedVoucher();
  const req = { code: "SCOPE10", target: "membership" };
  const result = await invoke(applyVoucher, { body: { ...req, planId: allowed._id } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.voucher.applicablePlanIds, [allowed._id]);
  for (const planId of [other._id, undefined, "invalid"]) {
    assert.equal((await invoke(applyVoucher, { body: { ...req, planId } })).status, 400);
  }
  assert.equal((await invoke(applyVoucher, { body: { ...req, target: "topup", planId: allowed._id } })).status, 400);
  assert.equal((await Voucher.findOne()).usedCount, 0);
});

test("checkout rejects a forged plan before creating an order or consuming voucher uses", async () => {
  await scopedVoucher();
  const bad = await invoke(createMembershipCheckout, { body: { planId: other._id, voucherCode: "SCOPE10" } });
  assert.equal(bad.status, 400);
  assert.equal(await Order.countDocuments({}), 0);
  assert.equal((await Voucher.findOne()).usedCount, 0);
  const good = await invoke(createMembershipCheckout, { body: { planId: allowed._id, voucherCode: "SCOPE10" } });
  assert.equal(good.status, 200);
  assert.equal(good.body.order.amount, 9000);
  assert.equal(good.body.order.originalAmount, 10000);
  assert.equal(good.body.order.voucherCode, "SCOPE10");
});

test("pre-capture reservations enforce plan scope without consuming a refused voucher", async () => {
  await scopedVoucher();
  const bad = await Order.create({ userId: user._id, planId: other._id, status: "pending", voucherCode: "SCOPE10" });
  await assert.rejects(reservePaymentBenefits("membership", bad), /Subscription/);
  assert.equal(await Reservation.countDocuments({}), 0);
  assert.equal((await Voucher.findOne()).usedCount, 0);
  const good = await Order.create({ userId: user._id, planId: allowed._id, status: "pending", voucherCode: "SCOPE10" });
  await reservePaymentBenefits("membership", good);
  await reservePaymentBenefits("membership", good);
  assert.equal(await Reservation.countDocuments({}), 1);
  assert.equal((await Voucher.findOne()).usedCount, 1);
});

test("card and checkout discounts only match selected plans after switching selection", () => {
  const voucher = safeVoucherPayload(payload());
  assert.equal(subscriptionVoucherApplies(voucher, allowed), true);
  assert.equal(subscriptionVoucherApplies(voucher, other), false);
  assert.equal(subscriptionVoucherApplies(voucher, null), false);
  assert.equal(subscriptionVoucherApplies({ ...voucher, targetKind: "credit" }, allowed), false);
  assert.equal(subscriptionVoucherApplies({ ...voucher, applicablePlanIds: [] }, other), true);
});
