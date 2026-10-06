import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";

const { default: Plan } = await import("../src/models/MembershipPlan.js");
const { default: Settings } = await import("../src/models/SiteSetting.js");
const { default: User } = await import("../src/models/User.js");
const { default: Order } = await import("../src/models/MembershipOrder.js");
const { default: Period } = await import("../src/models/SubscriptionPeriod.js");
const { adminCreateMembershipPlan, adminUpdateMembershipPlan } = await import("../src/controllers/adminV1Controller.js");
const { createMembershipCheckout, listMembershipPlans } = await import("../src/controllers/membershipController.js");
const { activateSubscriptionCatalog, prepareSubscriptionCatalog, subscriptionBillingPeriod } = await import("../src/utils/subscriptionCatalogService.js");
const { initializeMembershipPlans, approvePendingMembershipOrder } = await import("../src/utils/membershipService.js");
const { subscriptionCheckoutDescription } = await import("../../frontend/src/utils/membershipPresentation.js");

beforeEach(async () => {
  for (const model of [Plan, Settings, User, Order, Period]) await model.deleteMany({});
});

async function invoke(handler, req = {}) {
  let status = 200, payload;
  await handler({ body: {}, params: {}, get: () => "", ...req }, {
    status(code) { status = code; return this; }, json(value) { payload = value; },
  }, (error) => { status = error.status || 500; payload = { code: error.code, message: error.message }; });
  return { status, payload };
}

async function newPlan(fields = {}) {
  return Plan.create({ code: "PLAN", name: "Monthly 50", billingPeriod: "month", durationDays: 30,
    dailyDownloadLimit: 50, price: 0, isActive: true, catalogVersion: 1, ...fields });
}

test("public catalog sells enabled plans together regardless of catalog settings or plan version", async () => {
  const old = await newPlan({ code: "OLD", sortOrder: 20 });
  const recent = await newPlan({ code: "NEW", catalogVersion: 2, sortOrder: 10 });
  const unversioned = await newPlan({ code: "UNVERSIONED", catalogVersion: undefined, sortOrder: 30 });
  await newPlan({ code: "OFF", isActive: false });
  await newPlan({ code: "ARCHIVED", isArchived: true });
  await newPlan({ code: "BLANK", price: null });
  await newPlan({ code: "MISSING", price: undefined });
  for (const version of [undefined, 1, 2]) {
    await Settings.deleteMany({});
    if (version) await Settings.create({ key: "homepage", subscriptionCatalogVersion: version });
    const result = await invoke(listMembershipPlans);
    assert.deepEqual(result.payload.plans.map((plan) => plan._id), [recent._id, old._id, unversioned._id]);
  }
});

test("admin-created Daily 100 is immediately purchasable without applying a catalog", async () => {
  await Settings.create({ key: "homepage", subscriptionCatalogVersion: 1 });
  const created = await invoke(adminCreateMembershipPlan, { body: { code: "DAILY100", name: "Daily 100",
    billingPeriod: "day", durationDays: 1, dailyDownloadLimit: 100, price: 0, isActive: true } });
  assert.equal(created.status, 200);
  assert.equal((await invoke(listMembershipPlans)).payload.plans[0]._id, created.payload.plan._id);
  const user = await User.create({ email: "daily100@example.test" });
  const checkout = await invoke(createMembershipCheckout, { user, body: { planId: created.payload.plan._id } });
  assert.equal(checkout.status, 200);
  assert.equal(checkout.payload.status, "approved");
  assert.equal(checkout.payload.membership.dailyDownloadLimit, 100);
});

test("admin can disable and reopen legacy or recent plans under either historical catalog", async () => {
  for (const version of [1, 2]) {
    await Settings.findOneAndUpdate({ key: "homepage" }, { $set: { subscriptionCatalogVersion: version } }, { upsert: true });
    for (const planVersion of [1, 2]) {
      const plan = await newPlan({ code: `PLAN_${version}_${planVersion}`, catalogVersion: planVersion, catalogRetired: true });
      for (const isActive of [false, true]) {
        const edited = await invoke(adminUpdateMembershipPlan, { params: { id: plan._id }, body: { isActive } });
        assert.equal(edited.status, 200);
        assert.equal(edited.payload.plan.isActive, isActive);
        const available = (await invoke(listMembershipPlans)).payload.plans;
        assert.equal(available.some((item) => item._id === plan._id), isActive);
      }
    }
  }
});

test("blank price cannot be enabled, and archived plans cannot be reopened", async () => {
  const blank = await newPlan({ price: null, isActive: false });
  assert.equal((await invoke(adminUpdateMembershipPlan, { params: { id: blank._id }, body: { isActive: true } })).payload.code, "SUBSCRIPTION_PRICE_REQUIRED");
  assert.equal((await Plan.findById(blank._id)).isActive, false);
  const archived = await newPlan({ code: "ARCHIVED", isArchived: true, isActive: false });
  assert.equal((await invoke(adminUpdateMembershipPlan, { params: { id: archived._id }, body: { isActive: true } })).status, 404);
});

test("explicit billing period is respected for older plans with custom duration", async () => {
  const plan = await newPlan({ billingPeriod: "day", durationDays: 7 });
  assert.equal(subscriptionBillingPeriod(plan), "day");
  const result = await invoke(adminUpdateMembershipPlan, { params: { id: plan._id }, body: { isActive: false } });
  assert.equal(result.payload.plan.billingPeriod, "day");
  assert.equal(result.payload.plan.durationDays, 7);
  assert.equal(subscriptionBillingPeriod({ durationDays: 365 }), "year");
});

test("new purchases share FIFO scheduling for both plan versions while old snapshots remain unchanged", async () => {
  await Settings.create({ key: "homepage", subscriptionCatalogVersion: 2 });
  const first = await newPlan({ dailyDownloadLimit: 20 });
  const second = await newPlan({ code: "NEW", catalogVersion: 2, dailyDownloadLimit: 100 });
  const user = await User.create({ email: "fifo@example.test" });
  for (const plan of [first, second]) {
    const result = await invoke(createMembershipCheckout, { user, body: { planId: plan._id } });
    assert.equal(result.status, 200);
    assert.equal(result.payload.order.subscriptionPolicyVersion, 2);
    assert.equal(result.payload.order.subscriptionQueued, plan === second);
    assert.equal(result.payload.membership.dailyDownloadLimit, 20);
  }
  assert.equal(await Period.countDocuments({ userId: user._id }), 2);
  assert.match(subscriptionCheckoutDescription(first, { active: true }, "en"), /after/i);
  const oldUser = await User.create({ email: "old-snapshot@example.test" });
  const oldOrder = await Order.create({ userId: oldUser._id, planId: first._id, planCode: first.code,
    planName: first.name, status: "pending", amount: 10000, durationDays: 30, dailyDownloadLimit: 50,
    billingPeriod: "month", subscriptionPolicyVersion: 1 });
  await approvePendingMembershipOrder(oldOrder);
  assert.equal((await Order.findById(oldOrder._id)).subscriptionPolicyVersion, 1);
  assert.equal((await User.findById(oldUser._id)).proDailyDownloadLimit, 50);
});

test("disabled plans or a paused checkout cannot create orders, regardless of version", async () => {
  const user = await User.create({ email: "blocked@example.test" });
  for (const catalogVersion of [1, 2]) {
    const plan = await newPlan({ code: `OFF${catalogVersion}`, catalogVersion, isActive: false });
    assert.equal((await invoke(createMembershipCheckout, { user, body: { planId: plan._id } })).status, 400);
  }
  const active = await newPlan({ code: "ACTIVE" });
  await Settings.create({ key: "homepage", subscriptionCheckoutEnabled: false });
  assert.equal((await invoke(createMembershipCheckout, { user, body: { planId: active._id } })).status, 503);
  assert.equal(await Order.countDocuments({}), 0);
});

test("fresh plan revalidation rejects disable or price changes before order creation", async () => {
  const user = await User.create({ email: "race@example.test" });
  for (const change of [{ isActive: false }, { price: 10000 }]) {
    const plan = await newPlan({ code: change.isActive === false ? "DISABLE" : "PRICE" });
    const find = Plan.findById;
    let reads = 0;
    Plan.findById = function(id) {
      if (++reads !== 2) return find.call(this, id);
      return { session: async () => {
        await Plan.findByIdAndUpdate(id, { $set: change });
        return find.call(Plan, id);
      } };
    };
    try {
      const result = await invoke(createMembershipCheckout, { user, body: { planId: plan._id } });
      assert.equal(result.status, 409);
      assert.equal(result.payload.code, "SUBSCRIPTION_PLAN_CHANGED");
    } finally { Plan.findById = find; }
  }
  assert.equal(await Order.countDocuments({}), 0);
});

test("draft preparation and old activation requests never overwrite admin flags or prices", async () => {
  const existing = await newPlan({ code: "SUB_DAY_100", price: 9876, dailyDownloadLimit: 75, isActive: false });
  const sold = await newPlan({ code: "CUSTOM", price: 1234 });
  await prepareSubscriptionCatalog();
  await Promise.all([prepareSubscriptionCatalog(), activateSubscriptionCatalog(), activateSubscriptionCatalog()]);
  assert.equal(await Plan.countDocuments({ code: existing.code }), 1);
  assert.equal((await Plan.findById(existing._id)).price, 9876);
  assert.equal((await Plan.findById(existing._id)).dailyDownloadLimit, 75);
  assert.equal((await Plan.findById(existing._id)).isActive, false);
  assert.equal((await Plan.findById(sold._id)).isActive, true);
  assert.equal((await Plan.findById(sold._id)).catalogRetired ?? false, false);
});

test("startup leaves an existing admin-managed catalog untouched", async () => {
  const off = await newPlan({ isActive: false, price: 3456 });
  await initializeMembershipPlans();
  assert.equal(await Plan.countDocuments({}), 1);
  assert.equal((await Plan.findById(off._id)).isActive, false);
  assert.equal((await Plan.findById(off._id)).price, 3456);
});
