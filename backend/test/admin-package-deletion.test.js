import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.TELEGRAM_NOTIFICATIONS_ENABLED = "false";
process.env.TOPUP_PACKAGE_CATALOG_MIGRATION_ENABLED = "true";

const { default: Package } = await import("../src/models/TopupPackage.js");
const { default: Plan } = await import("../src/models/MembershipPlan.js");
const { default: User } = await import("../src/models/User.js");
const { default: Topup } = await import("../src/models/Topup.js");
const { default: Order } = await import("../src/models/MembershipOrder.js");
const { default: Period } = await import("../src/models/SubscriptionPeriod.js");
const { default: Settings } = await import("../src/models/SiteSetting.js");
const { deleteTopupPackage, listTopupPackages, reorderTopupPackages, updateTopupPackage } = await import("../src/controllers/adminController.js");
const { adminDeleteMembershipPlan, adminListMembershipPlans, adminReorderMembershipPlans, adminUpdateMembershipPlan } = await import("../src/controllers/adminV1Controller.js");
const { adminPrepareSubscriptionCatalog } = await import("../src/controllers/subscriptionCatalogController.js");
const { createTopup, getPackages } = await import("../src/controllers/topupController.js");
const { createMembershipCheckout, listMembershipPlans } = await import("../src/controllers/membershipController.js");
const { approvePendingMembershipOrder, initializeMembershipPlans } = await import("../src/utils/membershipService.js");
const { approvePendingTopup } = await import("../src/utils/topupApprovalService.js");
const { activateSubscriptionCatalog } = await import("../src/utils/subscriptionCatalogService.js");

beforeEach(async () => {
  for (const model of [Package, Plan, User, Topup, Order, Period, Settings]) await model.deleteMany({});
});

async function invoke(handler, req = {}) {
  let status = 200, payload;
  await handler({ body: {}, params: {}, get: () => "", ...req }, {
    status(code) { status = code; return this; },
    json(value) { payload = value; },
  }, (error) => { status = error.status || 500; payload = { message: error.message, code: error.code }; });
  return { status, payload };
}

function deleting(id) { return { params: { id } }; }
async function newPlan(fields = {}) {
  return Plan.create({ code: "CUSTOM", name: "Monthly 50", price: 10000, durationDays: 30,
    billingPeriod: "month", dailyDownloadLimit: 50, catalogVersion: 1, isActive: true, ...fields });
}

test("delete validates IDs and reports missing packages without success", async () => {
  for (const handler of [deleteTopupPackage, adminDeleteMembershipPlan]) {
    assert.equal((await invoke(handler, deleting("bad"))).status, 400);
    assert.equal((await invoke(handler, deleting("aaaaaaaaaaaaaaaaaaaaaaaa"))).status, 404);
  }
});

test("Subscription deletion hides the plan but keeps ordinary inactive drafts editable", async () => {
  const sold = await newPlan();
  const draft = await newPlan({ code: "DRAFT", price: null, isActive: false });
  const result = await invoke(adminDeleteMembershipPlan, deleting(sold._id));
  assert.equal(result.status, 200);
  assert.equal(result.payload.archived, true);
  assert.ok(result.payload.catalog);
  const stored = await Plan.findById(sold._id);
  assert.equal(stored.isActive, false);
  assert.equal(stored.isArchived, true);
  assert.ok(stored.archivedAt);
  assert.deepEqual((await invoke(adminListMembershipPlans)).payload.plans.map((p) => p._id), [draft._id]);
  assert.equal((await invoke(listMembershipPlans)).payload.plans.length, 0);
  const reordered = await invoke(adminReorderMembershipPlans, { body: { orderedIds: [sold._id, draft._id] } });
  assert.deepEqual(reordered.payload.plans.map((p) => p._id), [draft._id]);
});

test("Credit deletion survives default catalog refresh and preserves the reserved code", async () => {
  const seeded = (await invoke(getPackages)).payload.packages;
  const pack = seeded.find((p) => p.code === "EXPERIENCE");
  await Package.findByIdAndUpdate(pack._id, { defaultRevision: 0 });
  const result = await invoke(deleteTopupPackage, deleting(pack._id));
  assert.equal(result.payload.archived, true);
  for (let i = 0; i < 2; i++) {
    const refreshed = (await invoke(getPackages)).payload.packages;
    assert.equal(refreshed.length, 4);
    assert.equal(refreshed.some((p) => p.code === "EXPERIENCE"), false);
  }
  const stored = await Package.findById(pack._id);
  assert.equal(stored.isArchived, true);
  assert.equal(stored.isActive, false);
  assert.equal(stored.defaultRevision, 0);
  assert.equal(await Package.countDocuments({ code: "EXPERIENCE" }), 1);
  assert.equal((await invoke(listTopupPackages)).payload.packages.length, 4);
  const reordered = await invoke(reorderTopupPackages, { body: { orderedIds: seeded.map((p) => p._id) } });
  assert.equal(reordered.payload.packages.some((p) => p._id === pack._id), false);
});

test("Subscription seeds and prepare do not recreate an archived plan", async () => {
  await initializeMembershipPlans();
  const legacy = await Plan.findOne();
  await invoke(adminDeleteMembershipPlan, deleting(legacy._id));
  await initializeMembershipPlans();
  assert.equal((await Plan.findById(legacy._id)).isArchived, true);
  assert.equal((await Plan.findById(legacy._id)).isActive, false);
  const prepared = await invoke(adminPrepareSubscriptionCatalog);
  const draft = prepared.payload.plans.find((p) => p.code === "SUB_MONTH_50");
  await invoke(adminDeleteMembershipPlan, deleting(draft._id));
  const repeated = await invoke(adminPrepareSubscriptionCatalog);
  assert.equal(repeated.payload.plans.some((p) => p._id === draft._id || p._id === legacy._id), false);
  assert.equal(repeated.payload.catalog.prepared, true);
  assert.equal(await Plan.countDocuments({ code: draft.code }), 1);
});

test("repeated concurrent deletes preserve the first archive timestamp", async () => {
  for (const [model, handler, fields] of [
    [Package, deleteTopupPackage, { name: "Credit", price: 10000, credit: 28 }],
    [Plan, adminDeleteMembershipPlan, { code: "MONTH", name: "Month", price: 10000, durationDays: 30 }],
  ]) {
    const item = await model.create(fields);
    const results = await Promise.all([invoke(handler, deleting(item._id)), invoke(handler, deleting(item._id))]);
    assert.ok(results.every((result) => result.status === 200 && result.payload.archived));
    const at = new Date((await model.findById(item._id)).archivedAt).getTime();
    await invoke(handler, deleting(item._id));
    assert.equal(new Date((await model.findById(item._id)).archivedAt).getTime(), at);
    assert.equal(await model.countDocuments({ _id: item._id }), 1);
  }
});

test("archived packages cannot be edited back into the catalog or purchased", async () => {
  const user = await User.create({ email: "archived@example.test", credit: 0 });
  const pack = await Package.create({ name: "Credit", price: 10000, credit: 28 });
  const plan = await newPlan();
  await invoke(deleteTopupPackage, deleting(pack._id));
  await invoke(adminDeleteMembershipPlan, deleting(plan._id));
  assert.equal((await invoke(updateTopupPackage, { ...deleting(pack._id), body: { name: "Credit", price: 10000, credit: 28, isActive: true } })).status, 404);
  assert.equal((await invoke(adminUpdateMembershipPlan, { ...deleting(plan._id), body: { isActive: true } })).status, 404);
  assert.equal((await invoke(createTopup, { user, body: { packageId: pack._id } })).status, 400);
  assert.equal((await invoke(createMembershipCheckout, { user, body: { planId: plan._id } })).status, 400);
  assert.equal(await Topup.countDocuments({}), 0);
  assert.equal(await Order.countDocuments({}), 0);
});

test("pending payments still settle once using the purchased snapshot after deletion", async () => {
  const user = await User.create({ email: "pending@example.test", credit: 3 });
  const pack = await Package.create({ name: "Purchased Credit", price: 10000, credit: 28 });
  const plan = await newPlan();
  const topup = await Topup.create({ userId: user._id, packageId: pack._id, amount: 10000, credit: 28, status: "pending" });
  const order = await Order.create({ userId: user._id, planId: plan._id, planCode: plan.code, planName: plan.name,
    amount: 10000, durationDays: 30, billingPeriod: "month", subscriptionPolicyVersion: 2, dailyDownloadLimit: 50, status: "pending" });
  await invoke(deleteTopupPackage, deleting(pack._id));
  await invoke(adminDeleteMembershipPlan, deleting(plan._id));
  const paidCredit = await approvePendingTopup(topup);
  const paidPlan = await approvePendingMembershipOrder(order);
  assert.equal(paidCredit.user.credit, 31);
  assert.equal(paidPlan.user.proDailyDownloadLimit, 50);
  assert.equal(paidPlan.order.planName, "Monthly 50");
  const rights = await Period.find({ userId: user._id }).lean();
  assert.equal(rights.length, 1);
  await invoke(adminDeleteMembershipPlan, deleting(plan._id));
  assert.deepEqual(await Period.find({ userId: user._id }).lean(), rights);
  assert.equal(await approvePendingTopup(topup), null);
  assert.equal(await approvePendingMembershipOrder(order), null);
  assert.equal((await User.findById(user._id)).credit, 31);
  assert.equal((await Package.findById(pack._id)).name, "Purchased Credit");
});

test("archive flag independently prevents sale even after legacy catalog activation requests", async () => {
  await newPlan({ catalogVersion: 2, isActive: true, isArchived: true });
  const user = await User.create({ email: "hidden@example.test" });
  const plan = await Plan.findOne();
  assert.equal((await invoke(createMembershipCheckout, { user, body: { planId: plan._id } })).status, 400);
  await activateSubscriptionCatalog();
  await Settings.findOneAndUpdate({ key: "homepage" }, { $set: { subscriptionCatalogVersion: 2 } });
  assert.equal((await Plan.findById(plan._id)).isArchived, true);
  assert.equal((await invoke(listMembershipPlans)).payload.plans.length, 0);
  const pack = await Package.create({ name: "Hidden", price: 11000, credit: 30, isActive: true, isArchived: true });
  assert.equal((await invoke(createTopup, { user, body: { packageId: pack._id } })).status, 400);
  assert.equal((await invoke(getPackages)).payload.packages.some((p) => p._id === pack._id), false);
});
