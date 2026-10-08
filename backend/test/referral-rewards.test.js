import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: Settings } = await import("../src/models/SiteSetting.js");
const { default: Referral } = await import("../src/models/Referral.js");
const { default: Period } = await import("../src/models/SubscriptionPeriod.js");
const { default: Grant } = await import("../src/models/SubscriptionQuotaGrant.js");
const { default: Quota } = await import("../src/models/DailyDownloadQuota.js");
const { default: Notification } = await import("../src/models/Notification.js");
const { awardReferralSignup, getReferralSummary } = await import("../src/utils/referralService.js");
const { referralHistory } = await import("../src/controllers/referralController.js");
const { getSettings, updateSettings } = await import("../src/controllers/settingsController.js");
const { buildUserTimeline } = await import("../src/utils/timelineService.js");
const { endOfVietnamDay, vietnamDayKey } = await import("../src/utils/membershipService.js");
const { refreshSubscriptionUser } = await import("../src/utils/subscriptionScheduleService.js");
const { nextVietnamReset } = await import("../src/utils/subscriptionTime.js");
const { retryPendingMarketplaceQuotaGrants } = await import("../src/utils/marketplaceQuotaGrantService.js");

let sequence = 0;
async function user(fields = {}) {
  return User.create({ email: `referral-config-${++sequence}@example.test`, credit: 0, ...fields });
}
async function configure(fields = {}) {
  return Settings.findOneAndUpdate({ key: "homepage" }, { $set: {
    referralMode: "both", referralRewardCreditEnabled: true, referralRewardProEnabled: true,
    referralRewardCredit: 7, referralRewardModelDownloads: 20, ...fields,
  } }, { new: true, upsert: true });
}
async function invoke(handler, req) {
  let status = 200, payload;
  await handler(req, { status(code) { status = code; return this; }, json(value) { payload = value; } }, (error) => { throw error; });
  return { status, payload };
}

test("old settings expose the unchanged default referral amounts", async () => {
  await Settings.create({ key: "homepage" });
  const { payload } = await invoke(getSettings, { user: null });
  assert.equal(payload.settings.referralRewardCredit, 28);
  assert.equal(payload.settings.referralRewardModelDownloads, 100);
});

test("admin saves integer reward amounts and guests receive their public values", async () => {
  const result = await invoke(updateSettings, { body: { referralRewardCredit: "9", referralRewardModelDownloads: 50 } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.settings.referralRewardCredit, 9);
  assert.equal(result.payload.settings.referralRewardModelDownloads, 50);
  const { payload } = await invoke(getSettings, { user: null });
  assert.equal(payload.settings.referralRewardCredit, 9);
  assert.equal(payload.settings.referralRewardModelDownloads, 50);
});

test("invalid reward settings reject the entire update without changing stored amounts", async () => {
  await configure();
  for (const field of ["referralRewardCredit", "referralRewardModelDownloads"]) {
    for (const value of [null, true, [], {}, "", "1e3", "1.5", 0, -1, 1.5, 100001, Number.MAX_SAFE_INTEGER]) {
      const result = await invoke(updateSettings, { body: {
        referralRewardCredit: 15, referralRewardModelDownloads: 50, [field]: value,
      } });
      assert.equal(result.status, 400, `${field}: ${JSON.stringify(value)}`);
      assert.equal(result.payload.code, "INVALID_REFERRAL_REWARD");
      const stored = await Settings.findOne({ key: "homepage" });
      assert.equal(stored.referralRewardCredit, 7);
      assert.equal(stored.referralRewardModelDownloads, 20);
    }
  }
});

test("custom rewards grant both users Credit and a today-only Model quota once", async () => {
  await configure();
  const referrer = await user({ referralCode: "CUSTOMREWARD1" });
  const referred = await user();
  const results = await Promise.all([
    awardReferralSignup(referred, referrer.referralCode), awardReferralSignup(referred, referrer.referralCode),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  for (const id of [referrer._id, referred._id]) {
    const fresh = await User.findById(id);
    assert.equal(fresh.credit, 7);
    assert.equal(fresh.proDailyDownloadLimit, 20);
    assert.equal(new Date(fresh.proUntil).getTime(), endOfVietnamDay().getTime());
    assert.equal((await Period.findOne({ userId: id })).dailyDownloadLimit, 20);
    const expired = await refreshSubscriptionUser(fresh, { at: nextVietnamReset(), force: true });
    assert.equal(expired.proUntil, null);
  }
  assert.equal(await Referral.countDocuments({ referredUserId: referred._id }), 1);
  const notice = await Notification.findOne({ userIds: referrer._id });
  assert.match(notice.body, /20 lượt Model/);
  assert.match(notice.body, /7 credit/);
});

test("changing settings affects new referrals, not reward history or retry", async () => {
  await configure();
  const referrer = await user({ referralCode: "SNAPSHOTREWARD1" });
  const referred = await user();
  await awardReferralSignup(referred, referrer.referralCode);
  await configure({ referralRewardCredit: 11, referralRewardModelDownloads: 50 });
  assert.equal(await awardReferralSignup(referred, referrer.referralCode), null);
  assert.equal((await User.findById(referrer._id)).credit, 7);
  const summary = await getReferralSummary(referrer, "https://example.test");
  assert.equal(summary.rewardCredit, 11);
  assert.equal(summary.rewardModelDownloads, 50);
  assert.equal(summary.invitedUsers[0].rewardCredit, 7);
  assert.equal(summary.invitedUsers[0].rewardModelDownloads, 20);
  for (const owner of [referrer, referred]) {
    const { payload } = await invoke(referralHistory, { user: owner });
    assert.equal(payload.history[0].credit, 7);
    assert.equal(payload.history[0].modelDownloads, 20);
    const timeline = await buildUserTimeline({ userId: owner._id, type: "referral" });
    assert.equal(timeline.events[0].metadata.modelDownloads, 20);
    assert.equal(timeline.events[0].metadata.rewardCredit, 7);
  }
  await awardReferralSignup(await user(), referrer.referralCode);
  assert.equal((await User.findById(referrer._id)).credit, 18);
  assert.equal((await Quota.findOne({ userId: referrer._id, dayKey: vietnamDayKey() })).bonusLimit, 30);
});

test("custom referrer-only, Credit-only and quota-only rewards respect toggles", async () => {
  for (const [index, fields] of [
    { referralMode: "referrer_only" }, { referralRewardProEnabled: false }, { referralRewardCreditEnabled: false },
  ].entries()) {
    await configure(fields);
    const referrer = await user({ referralCode: `SELECTREWARD${index}` });
    const referred = await user();
    await awardReferralSignup(referred, referrer.referralCode);
    const record = await Referral.findOne({ referredUserId: referred._id });
    const fresh = await User.findById(referred._id);
    assert.equal(record.referrerRewardCredit, fields.referralRewardCreditEnabled === false ? 0 : 7);
    assert.equal(record.referrerRewardModelDownloads, fields.referralRewardProEnabled === false ? 0 : 20);
    if (fields.referralMode === "referrer_only") {
      assert.equal(record.referredRewardModelDownloads, 0);
      assert.equal(fresh.credit, 0);
      assert.equal(fresh.proUntil, undefined);
    } else if (fields.referralRewardProEnabled === false) {
      assert.equal(fresh.credit, 7);
      assert.equal(fresh.proUntil, undefined);
    } else {
      assert.equal(fresh.credit, 0);
      assert.equal(fresh.proDailyDownloadLimit, 20);
    }
  }
});

test("configured quota floor preserves paid extra downloads and existing Subscription", async () => {
  await configure({ referralRewardModelDownloads: 70 });
  const expiry = new Date(Date.now() + 10 * 86400000);
  const referrer = await user({ referralCode: "QUOTAFLOOR1", proUntil: expiry, proDailyDownloadLimit: 50 });
  await Quota.create({ userId: referrer._id, dayKey: vietnamDayKey(), guestKey: "", tier: "member", bonusLimit: 40, count: 10 });
  for (const target of [70, 70, 100, 30, 100]) {
    await configure({ referralRewardModelDownloads: target });
    await awardReferralSignup(await user(), referrer.referralCode);
  }
  const fresh = await User.findById(referrer._id);
  assert.equal(fresh.proDailyDownloadLimit, 50);
  assert.equal(new Date(fresh.proUntil).getTime(), expiry.getTime());
  const quota = await Quota.findOne({ userId: referrer._id, dayKey: vietnamDayKey() });
  assert.equal(quota.bonusLimit, 90);
  assert.equal(quota.count, 10);
  assert.equal(await Grant.countDocuments({ userId: referrer._id }), 2);
  assert.equal(await Quota.findOne({ userId: referrer._id, dayKey: vietnamDayKey(nextVietnamReset()) }), null);
});

test("VPS retry uses the original grant amount even after configuration changes", async () => {
  await configure({ referralRewardModelDownloads: 70 });
  const referrer = await user({ referralCode: "QUOTARETRY1", proUntil: new Date(Date.now() + 86400000), proDailyDownloadLimit: 50 });
  const original = Quota.findOneAndUpdate;
  Quota.findOneAndUpdate = () => { throw new Error("Fixture VPS unavailable"); };
  try {
    await awardReferralSignup(await user(), referrer.referralCode);
    await awardReferralSignup(await user(), referrer.referralCode);
  } finally { Quota.findOneAndUpdate = original; }
  const grant = await Grant.findOne({ userId: referrer._id });
  assert.equal(grant.amount, 20);
  assert.equal(grant.status, "error");
  assert.equal(await Grant.countDocuments({ userId: referrer._id }), 1);
  await configure({ referralRewardCredit: 99, referralRewardModelDownloads: 100 });
  await retryPendingMarketplaceQuotaGrants();
  await retryPendingMarketplaceQuotaGrants();
  assert.equal((await Quota.findOne({ userId: referrer._id, dayKey: vietnamDayKey() })).bonusLimit, 20);
  assert.equal((await User.findById(referrer._id)).credit, 14);
});

test("simultaneous referrals share one quota floor and preserve a changed base quota", async () => {
  await configure({ referralRewardModelDownloads: 70 });
  const referrer = await user({ referralCode: "SHAREDFLOOR1", proUntil: new Date(Date.now() + 86400000), proDailyDownloadLimit: 50 });
  const invites = [await user(), await user()];
  await Promise.all(invites.map((referred) => awardReferralSignup(referred, referrer.referralCode)));
  assert.equal(await Grant.countDocuments({ userId: referrer._id }), 1);
  assert.equal((await Quota.findOne({ userId: referrer._id, dayKey: vietnamDayKey() })).bonusLimit, 20);
  await User.findByIdAndUpdate(referrer._id, { $set: { proDailyDownloadLimit: 20 } });
  await awardReferralSignup(await user(), referrer.referralCode);
  assert.equal(await Grant.countDocuments({ userId: referrer._id }), 2);
  assert.equal((await Quota.findOne({ userId: referrer._id, dayKey: vietnamDayKey() })).bonusLimit, 50);
  assert.equal((await User.findById(referrer._id)).proDailyDownloadLimit, 20);
});

test("legacy referral records retain their original quota in history", async () => {
  await configure({ referralRewardModelDownloads: 20 });
  const referrer = await user();
  const referred = await user();
  await Referral.create({ referrerId: referrer._id, referredUserId: referred._id, referralCode: "LEGACYREWARD1",
    status: "rewarded", rewardType: "pro", referrerRewardProDays: 1, referrerRewardCredit: 28 });
  const { payload } = await invoke(referralHistory, { user: referrer });
  assert.equal(payload.history[0].modelDownloads, 100);
  assert.equal(payload.history[0].credit, 28);
});
