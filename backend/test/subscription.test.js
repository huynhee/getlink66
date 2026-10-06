import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";
useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: Order } = await import("../src/models/MembershipOrder.js");
const { default: Plan } = await import("../src/models/MembershipPlan.js");
const { default: Period } = await import("../src/models/SubscriptionPeriod.js");
const { default: Quota } = await import("../src/models/DailyDownloadQuota.js");
const { default: Settings } = await import("../src/models/SiteSetting.js");
const { default: Backup } = await import("../src/models/BackupRun.js");
const { default: CoreGrant } = await import("../src/models/SubscriptionQuotaGrant.js");
const { approvePendingMembershipOrder, vietnamDayKey, initializeMembershipPlans } = await import("../src/utils/membershipService.js");
const { activateSubscriptionOrder, subscriptionDetails, refreshSubscriptionUser, migrateSubscriptionUser, adjustSubscription } = await import("../src/utils/subscriptionScheduleService.js");
const { subscriptionEnd, nextVietnamReset } = await import("../src/utils/subscriptionTime.js");
const { transitionDueSubscriptions } = await import("../src/utils/subscriptionScheduleJob.js");
const { prepareSubscriptionCatalog, activateSubscriptionCatalog, getSubscriptionCatalog, setSubscriptionCheckoutEnabled } = await import("../src/utils/subscriptionCatalogService.js");
const { createMembershipCheckout, listMembershipPlans } = await import("../src/controllers/membershipController.js");
const { normalizePlanPayload } = await import("../src/controllers/adminV1Controller.js");
const { awardReferralSignup } = await import("../src/utils/referralService.js");
const { retryPendingMarketplaceQuotaGrants } = await import("../src/utils/marketplaceQuotaGrantService.js");
const { migrateSubscriptions } = await import("../src/utils/subscriptionMigrationService.js");
const { paypalPrice } = await import("../src/utils/paymentMoney.js");
const { default: Asset } = await import("../src/models/MarketplaceModel.js");
const { createMarketplaceDownloadSession, getMarketplaceDownloadOptions } = await import("../src/utils/marketplaceDownloadService.js");
const { initialSubscriptionSelection, subscriptionPlanPrice, subscriptionApprovalMessage } = await import("../../frontend/src/utils/membershipPresentation.js");

let sequence = 0;
const at = new Date("2026-01-30T08:00:00Z");
async function newUser(fields = {}) {
  return User.create({ email: `subscription-${++sequence}@example.test`, name: "Subscription", credit: 0, ...fields });
}
async function newOrder(user, quota = 50, fields = {}) {
  return Order.create({ userId: user._id, planId: "test-plan", planCode: "SUB_MONTH_50", planName: "Month 50",
    amount: 10000, paymentCode: `PROTEST${++sequence}`, durationDays: 30, dailyDownloadLimit: quota,
    billingPeriod: "month", subscriptionPolicyVersion: 2, status: "pending", ...fields });
}
async function schedule(user, quota, starts = at, fields = {}) {
  const order = await newOrder(user, quota, { status: "approved", ...fields });
  return activateSubscriptionOrder(order, user, { at: starts });
}
async function invoke(handler, req) {
  let status = 200, payload;
  await handler(req, { status(code) { status = code; return this; }, json(value) { payload = value; } }, (error) => { throw error; });
  return { status, payload };
}

test("calendar includes purchase day and crosses short months/leap years", () => {
  assert.equal(subscriptionEnd(at, 30).toISOString(), "2026-02-28T17:00:00.000Z");
  assert.equal(subscriptionEnd(new Date("2024-02-28T10:00:00Z"), 365).toISOString(), "2025-02-26T17:00:00.000Z");
  assert.equal(subscriptionEnd(new Date("2026-01-30T17:00:00Z"), 1).toISOString(), "2026-01-31T17:00:00.000Z");
  assert.throws(() => subscriptionEnd(at, 1.5));
});

test("FIFO periods preserve 20/50/100 quotas and advance on-demand without worker", async () => {
  const user = await newUser();
  const first = await schedule(user, 20);
  const second = await schedule(first.user, 50);
  const third = await schedule(second.user, 100, at, { billingPeriod: "year", durationDays: 365 });
  const details = await subscriptionDetails(third.user, { at });
  assert.equal(details.user.proDailyDownloadLimit, 20);
  assert.equal(details.upcomingPeriods.length, 2);
  assert.equal(second.order.activatedFrom, new Date(new Date(first.order.activatedUntil).getTime() + 1).toISOString());
  assert.equal(second.order.subscriptionQueued, true);
  const changed = await refreshSubscriptionUser(third.user, { at: new Date(second.order.activatedFrom) });
  assert.equal(changed.proDailyDownloadLimit, 50);
  assert.equal(changed.proUntil, third.user.proUntil);
  const year = await refreshSubscriptionUser(changed, { at: new Date(third.order.activatedFrom) });
  assert.equal(year.proDailyDownloadLimit, 100);
  const expired = await refreshSubscriptionUser(year, { at: new Date(new Date(third.order.activatedUntil).getTime() + 1) });
  assert.equal(expired.proUntil, null);
});

test("same-quota periods remain separate and duplicate payment creates one period", async () => {
  const user = await newUser();
  const orders = await Promise.all([newOrder(user, 50), newOrder(user, 50)]);
  const results = await Promise.all(orders.map((order) => approvePendingMembershipOrder(order)));
  assert.equal(await Period.countDocuments({ userId: user._id }), 2);
  assert.equal((await User.findById(user._id)).proDailyDownloadLimit, 50);
  assert.equal(await approvePendingMembershipOrder(orders[0]), null);
  assert.equal(await Period.countDocuments({ userId: user._id }), 2);
  assert.equal(results.filter((result) => result.order.subscriptionQueued).length, 1);
});

test("new payment preserves exact legacy expiry and quota as baseline", async () => {
  const expiry = new Date(Date.now() + 86400000 * 5 + 1234);
  const user = await newUser({ proUntil: expiry, proDailyDownloadLimit: 20 });
  const result = await approvePendingMembershipOrder(await newOrder(user, 100));
  const periods = await Period.find({ userId: user._id }).sort({ startsAt: 1 });
  assert.equal(periods[0].dailyDownloadLimit, 20);
  assert.equal(new Date(periods[0].endsAt).getTime(), expiry.getTime() + 1);
  assert.equal(result.user.proDailyDownloadLimit, 20);
  assert.equal(new Date(result.order.activatedFrom).getTime(), expiry.getTime() + 1);
});

test("Model and Scene use current 20/50/100 quota without spending Credit", async () => {
  for (const limit of [20, 50, 100]) {
    const result = await schedule(await newUser({ credit: 80 }), limit, new Date());
    const request = () => ({ user: result.user, body: { paymentMethod: "pro_quota", clientRequestId: `subscription-${++sequence}` },
      ip: "127.0.0.90", get: () => "subscription-test" });
    for (const assetType of ["model", "scene"]) {
      const asset = await Asset.create({ assetType, title: `Subscription ${assetType}`, slug: `sub-asset-${++sequence}`,
        accessType: "member", metadataStatus: "complete", fileStatus: "ready", isPublished: true,
        storageProvider: "google_drive", driveFileId: `fixture-${sequence}`, source: { provider: "google_drive", assetId: `fixture-${sequence}` } });
      const options = await getMarketplaceDownloadOptions({ req: request(), modelId: asset._id, expectedAssetType: assetType });
      assert.equal(options.quota.limit, limit);
      const download = await createMarketplaceDownloadSession({ req: request(), modelId: asset._id, expectedAssetType: assetType });
      assert.equal(download.quotaCost, assetType === "scene" ? 5 : 1);
    }
    assert.equal((await Quota.findOne({ userId: result.user._id, tier: "member", dayKey: vietnamDayKey() })).count, 6);
    assert.equal((await User.findById(result.user._id)).credit, 80);
  }
});

test("failed schedule activation restores order and leaves no orphan period", async () => {
  const user = await newUser();
  const order = await newOrder(user, 20);
  const update = User.findByIdAndUpdate;
  let failed = false;
  User.findByIdAndUpdate = function(id, changes, options) {
    if (!failed && Object.hasOwn(changes.$set || {}, "subscriptionCurrentPeriod")) {
      failed = true;
      throw new Error("Projection unavailable");
    }
    return update.call(this, id, changes, options);
  };
  try {
    await assert.rejects(approvePendingMembershipOrder(order), /Projection unavailable/);
  } finally { User.findByIdAndUpdate = update; }
  assert.equal(await Period.countDocuments({ userId: user._id }), 0);
  assert.equal((await Order.findById(order._id)).status, "pending");
  assert.equal((await User.findById(user._id)).proUntil ?? null, null);
  await approvePendingMembershipOrder(order);
  assert.equal(await Period.countDocuments({ userId: user._id }), 1);
});

test("presentation opens requested period and distinguishes missing USD from explicit free", () => {
  const plans = [{ _id: "year", billingPeriod: "year", price: 10000, paypalPriceCents: null },
    { _id: "month", billingPeriod: "month", price: 0, paypalPriceCents: null }];
  assert.deepEqual(initialSubscriptionSelection(plans), { period: "month", planId: "month" });
  assert.deepEqual(initialSubscriptionSelection(plans, "year"), { period: "year", planId: "year" });
  assert.equal(subscriptionPlanPrice(plans[0], "en"), null);
  assert.equal(subscriptionPlanPrice(plans[1], "en"), 0);
  assert.equal(subscriptionPlanPrice({ price: null }, "vi"), null);
  assert.match(subscriptionApprovalMessage({ order: { subscriptionQueued: true, activatedFrom: new Date(Date.now() + 86400000) } }, "en"), /waiting to start/);
  assert.doesNotMatch(subscriptionApprovalMessage({ order: { subscriptionQueued: true, activatedFrom: new Date(Date.now() - 86400000) } }, "en"), /waiting to start/);
});

test("Day purchase adds today only, does not shift queue, and retry does not add twice", async () => {
  let user = await newUser();
  user = (await schedule(user, 20, new Date())).user;
  const future = await schedule(user, 100, new Date());
  const order = await newOrder(future.user, 50, { billingPeriod: "day", durationDays: 1 });
  const result = await approvePendingMembershipOrder(order);
  assert.equal(result.order.isQuotaAddon, true);
  assert.equal(result.user.proUntil, future.user.proUntil);
  assert.equal(result.user.proDailyDownloadLimit, 20);
  assert.equal((await Quota.findOne({ userId: user._id, tier: "member", dayKey: vietnamDayKey() })).bonusLimit, 50);
  await approvePendingMembershipOrder(order);
  assert.equal((await Quota.findOne({ userId: user._id, tier: "member", dayKey: vietnamDayKey() })).bonusLimit, 50);
  assert.equal(await Quota.findOne({ userId: user._id, tier: "member", dayKey: vietnamDayKey(nextVietnamReset()) }), null);
});

test("Day for Free expires tonight even when plan has a custom duration", async () => {
  const user = await newUser();
  const result = await schedule(user, 20, at, { billingPeriod: "day", durationDays: 7 });
  assert.equal(result.order.activatedUntil, "2026-01-30T16:59:59.999Z");
});

test("admin shifts upcoming calendar durations and clear cancels all without resurrection", async () => {
  const first = await schedule(await newUser(), 20);
  const second = await schedule(first.user, 50);
  const result = await adjustSubscription(first.user._id, { proUntil: "2026-02-10T09:00:00Z", proDailyDownloadLimit: 75 }, { at });
  const details = await subscriptionDetails(result, { at });
  assert.equal(details.currentPeriod.dailyDownloadLimit, 75);
  assert.equal(details.upcomingPeriods[0].startsAt, "2026-02-10T17:00:00.000Z");
  assert.equal(details.upcomingPeriods[0].endsAt, subscriptionEnd(new Date("2026-02-10T17:00:00Z"), 30).toISOString());
  assert.equal((await Order.findById(second.order._id)).dailyDownloadLimit, 50);
  const cleared = await adjustSubscription(first.user._id, { clearPro: true }, { at });
  await transitionDueSubscriptions({ at: new Date("2026-03-01T00:00:00Z") });
  assert.equal((await refreshSubscriptionUser(cleared, { at: new Date("2026-03-01T00:00:00Z"), force: true })).proUntil, null);
});

test("migration is dry-run, requires reviewed fresh backup, and is idempotent", async () => {
  const expiry = new Date("2026-02-10T10:15:00Z");
  const user = await newUser({ proUntil: expiry, proDailyDownloadLimit: 50 });
  await migrateSubscriptions({ at });
  assert.equal(await Period.countDocuments({ userId: user._id }), 0);
  await assert.rejects(migrateSubscriptions({ at, execute: true }), /MIGRATION_CONFIRM/);
  await assert.rejects(migrateSubscriptions({ at, execute: true, confirm: "subscription-calendar-v2" }), /verified Core backup/);
  const backup = await Backup.create({ kind: "core", status: "verified", artifactDriveFileId: "mock", sourceSha256: "mock", verifiedAt: at });
  await migrateSubscriptions({ at, execute: true, confirm: "subscription-calendar-v2", backupId: backup._id });
  const baseline = await User.findById(user._id);
  assert.equal(baseline.proUntil, expiry.toISOString());
  assert.equal(baseline.proDailyDownloadLimit, 50);
  await migrateSubscriptionUser(user._id, { at });
  assert.equal(await Period.countDocuments({ userId: user._id }), 1);
});

test("blank prices cannot activate, explicit zero may be free, and integer fields are strict", () => {
  const base = { code: "X", name: "X", durationDays: 30, dailyDownloadLimit: 75, isActive: false };
  assert.equal(normalizePlanPayload({ ...base, price: "" }).price, null);
  assert.equal(normalizePlanPayload({ ...base, price: 0 }).price, 0);
  assert.throws(() => normalizePlanPayload({ ...base, dailyDownloadLimit: 1.5 }));
  assert.throws(() => normalizePlanPayload({ ...base, durationDays: 0 }));
  assert.throws(() => paypalPrice({ price: null, paypalPriceCents: null }, { freeTrial: true }));
});

test("catalog prepares inactive drafts alongside enabled plans and never resets prices or availability", async () => {
  await Plan.deleteMany({}); await Settings.deleteMany({});
  await initializeMembershipPlans();
  const legacyCount = await Plan.countDocuments({});
  await prepareSubscriptionCatalog();
  const plans = await Plan.find({ catalogVersion: 2 });
  assert.equal(plans.length, 9);
  assert.equal(plans.every((plan) => plan.price === null && plan.isActive === false), true);
  assert.equal((await activateSubscriptionCatalog()).mode, "unified");
  const chosen = plans.find((plan) => plan.code === "SUB_MONTH_20");
  await Plan.findByIdAndUpdate(chosen._id, { $set: { price: 12345, isActive: true, dailyDownloadLimit: 75 } });
  await prepareSubscriptionCatalog();
  assert.equal((await Plan.findById(chosen._id)).price, 12345);
  const oldList = await invoke(listMembershipPlans, {});
  assert.equal(oldList.payload.plans.some((plan) => plan._id === chosen._id), true);
  assert.equal(oldList.payload.plans.length, legacyCount + 1);
  await Promise.all([activateSubscriptionCatalog(), activateSubscriptionCatalog()]);
  assert.equal((await getSubscriptionCatalog()).mode, "unified");
  assert.equal((await Plan.find({ catalogVersion: { $ne: 2 } })).every((plan) => plan.isActive === true), true);
  await initializeMembershipPlans();
  assert.equal((await Plan.find({ catalogVersion: { $ne: 2 } })).every((plan) => plan.isActive === true), true);
  const list = await invoke(listMembershipPlans, {});
  assert.equal(list.payload.plans.length, legacyCount + 1);
  const user = await newUser();
  await setSubscriptionCheckoutEnabled(false);
  const req = { user, body: { planId: chosen._id }, get: () => "" };
  assert.equal((await invoke(createMembershipCheckout, req)).status, 503);
  await setSubscriptionCheckoutEnabled(true);
});

test("paid pending order survives disabling its plan and keeps its immutable benefits", async () => {
  const old = await Plan.create({ code: `LEGACY${++sequence}`, name: "Old monthly", price: 10000, isActive: true,
    catalogVersion: 1, durationDays: 30, dailyDownloadLimit: 50 });
  await Settings.findOneAndUpdate({ key: "homepage" }, { $set: { subscriptionCatalogVersion: 1 } });
  const keys = ["SEPAY_ENABLED", "SEPAY_ENV", "SEPAY_MERCHANT_ID", "SEPAY_SECRET_KEY", "CLIENT_URL"];
  const before = keys.map((key) => process.env[key]);
  Object.assign(process.env, { SEPAY_ENABLED: "true", SEPAY_ENV: "sandbox", SEPAY_MERCHANT_ID: "fixture-merchant",
    SEPAY_SECRET_KEY: "fixture-secret", CLIENT_URL: "http://localhost:5173" });
  try {
    const user = await newUser();
    const req = { user, body: { planId: old._id }, get: () => "subscription-immutable-0001" };
    const { payload } = await invoke(createMembershipCheckout, req);
    await Plan.findByIdAndUpdate(old._id, { $set: { price: 20000, dailyDownloadLimit: 100, durationDays: 365, isActive: false } });
    await activateSubscriptionCatalog();
    assert.equal((await Plan.findById(old._id)).isActive, false);
    await Order.findByIdAndUpdate(payload.order._id, { $set: { status: "rejected", rejectionReason: "expired" } });
    const late = await approvePendingMembershipOrder(await Order.findById(payload.order._id));
    assert.equal(late.order.amount, 10000);
    assert.equal(late.user.proDailyDownloadLimit, 50);
    assert.equal(late.order.durationDays, 30);
    const replay = await invoke(createMembershipCheckout, req);
    assert.equal(replay.payload.idempotentReplay, true);
    assert.equal(replay.payload.order._id, payload.order._id);
  } finally {
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
  }
});

test("referral floor adds difference today and preserves paid extra downloads, retry is idempotent", async () => {
  await Settings.findOneAndUpdate({ key: "homepage" }, { $set: { referralMode: "both", referralRewardProEnabled: true, referralRewardCreditEnabled: true } });
  const first = await schedule(await newUser({ referralCode: "SUBREF1234" }), 20, new Date());
  await Quota.create({ userId: first.user._id, tier: "member", dayKey: vietnamDayKey(), guestKey: "", count: 1, bonusLimit: 50 });
  const referred = await newUser();
  await awardReferralSignup(referred, "SUBREF1234");
  assert.equal((await User.findById(first.user._id)).proDailyDownloadLimit, 20);
  assert.equal((await Quota.findOne({ userId: first.user._id, tier: "member", dayKey: vietnamDayKey() })).bonusLimit, 130);
  await awardReferralSignup(await newUser(), "SUBREF1234");
  await retryPendingMarketplaceQuotaGrants();
  assert.equal((await Quota.findOne({ userId: first.user._id, tier: "member", dayKey: vietnamDayKey() })).bonusLimit, 130);
  assert.equal(await CoreGrant.countDocuments({ userId: first.user._id }), 1);
  assert.equal((await User.findById(first.user._id)).proUntil, first.user.proUntil);
});

test("referral survives VPS failure and retries without duplicating credit or quota", async () => {
  const first = await schedule(await newUser({ referralCode: "RETRYREF123" }), 50, new Date());
  const invited = await newUser();
  const original = Quota.findOneAndUpdate;
  Quota.findOneAndUpdate = async () => { throw new Error("VPS unavailable"); };
  try { await awardReferralSignup(invited, "RETRYREF123"); }
  finally { Quota.findOneAndUpdate = original; }
  assert.equal((await CoreGrant.findOne({ userId: first.user._id })).status, "error");
  await retryPendingMarketplaceQuotaGrants();
  await retryPendingMarketplaceQuotaGrants();
  assert.equal((await Quota.findOne({ userId: first.user._id, tier: "member", dayKey: vietnamDayKey() })).bonusLimit, 50);
  assert.equal((await User.findById(first.user._id)).credit, 28);
});
