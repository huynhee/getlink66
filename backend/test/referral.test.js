import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: Referral } = await import("../src/models/Referral.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { awardReferralSignup } = await import("../src/utils/referralService.js");
const { endOfVietnamDay } = await import("../src/utils/membershipService.js");

test("referral grants one Pro day and 28 credits to both users exactly once", async () => {
  await SiteSetting.create({ key: "homepage", referralMode: "both" });
  const referrer = await User.create({
    email: "referrer@example.test",
    name: "Referrer",
    credit: 0,
    referralCode: "REFERRAL28",
  });
  const referred = await User.create({
    email: "referred@example.test",
    name: "Referred",
    credit: 0,
  });

  const first = await awardReferralSignup(referred, "REFERRAL28");
  const freshReferred = await User.findById(referred._id);
  const firstReferrer = await User.findById(referrer._id);
  const second = await awardReferralSignup(freshReferred, "REFERRAL28");

  assert.equal(first.rewardType, "pro");
  assert.equal(first.referrerProDays, 1);
  assert.equal(first.referredProDays, 1);
  assert.equal(second, null);
  assert.equal((await User.findById(referrer._id)).credit, 28);
  assert.equal((await User.findById(referred._id)).credit, 28);
  assert.equal(
    new Date((await User.findById(referrer._id)).proUntil).getTime(),
    new Date(firstReferrer.proUntil).getTime(),
  );
  assert.ok(new Date(firstReferrer.proUntil).getTime() > Date.now() + 24 * 60 * 60 * 1000);
  assert.equal(new Date(firstReferrer.proUntil).toISOString().slice(11), "16:59:59.999Z");
  assert.equal(await Referral.countDocuments({ referredUserId: referred._id }), 1);
  const reward = await Referral.findOne({ referredUserId: referred._id });
  assert.equal(reward.rewardType, "pro");
  assert.equal(reward.rewardProDays, 1);
  assert.equal(reward.referrerRewardCredit, 28);
  assert.equal(reward.referredRewardCredit, 28);
});

test("referral Pro reward extends an existing membership without replacing it", async () => {
  const originalUntil = endOfVietnamDay(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000));
  const referrer = await User.create({
    email: "active-referrer@example.test",
    name: "Active Referrer",
    credit: 7,
    referralCode: "ACTIVEPRO1",
    proUntil: originalUntil,
    proDailyDownloadLimit: 150,
  });
  const referred = await User.create({
    email: "active-referred@example.test",
    name: "Active Referred",
    credit: 5,
  });

  await awardReferralSignup(referred, "ACTIVEPRO1");

  const updatedReferrer = await User.findById(referrer._id);
  assert.equal(
    new Date(updatedReferrer.proUntil).getTime(),
    originalUntil.getTime() + 24 * 60 * 60 * 1000,
  );
  assert.equal(updatedReferrer.proDailyDownloadLimit, 150);
  assert.equal(updatedReferrer.credit, 35);
  assert.equal((await User.findById(referred._id)).credit, 33);
});

test("referrer-only mode does not grant Pro to the invited user", async () => {
  await SiteSetting.findOneAndUpdate(
    { key: "homepage" },
    { $set: { referralMode: "referrer_only" } },
    { new: true, upsert: true },
  );
  const referrer = await User.create({
    email: "solo-referrer@example.test",
    name: "Solo Referrer",
    referralCode: "SOLOPRO1",
  });
  const referred = await User.create({
    email: "solo-referred@example.test",
    name: "Solo Referred",
  });

  const result = await awardReferralSignup(referred, "SOLOPRO1");
  const updatedReferrer = await User.findById(referrer._id);
  const updatedReferred = await User.findById(referred._id);
  const reward = await Referral.findOne({ referredUserId: referred._id });

  assert.equal(result.referrerProDays, 1);
  assert.equal(result.referredProDays, 0);
  assert.ok(new Date(updatedReferrer.proUntil).getTime() > Date.now());
  assert.equal(updatedReferred.proUntil, undefined);
  assert.equal(updatedReferrer.credit, 28);
  assert.equal(Number(updatedReferred.credit || 0), 0);
  assert.equal(reward.referrerRewardCredit, 28);
  assert.equal(reward.referredRewardCredit, 0);
  assert.equal(reward.referredRewardProDays, 0);
});
