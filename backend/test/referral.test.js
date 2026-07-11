import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.REFERRAL_REWARD_CREDIT = "28";

const { default: User } = await import("../src/models/User.js");
const { default: Referral } = await import("../src/models/Referral.js");
const { default: SiteSetting } = await import("../src/models/SiteSetting.js");
const { awardReferralSignup } = await import("../src/utils/referralService.js");

test("referral rewards are idempotent in memory fallback mode", async () => {
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
  const second = await awardReferralSignup(freshReferred, "REFERRAL28");

  assert.equal(first.referrerCredit, 28);
  assert.equal(second, null);
  assert.equal((await User.findById(referrer._id)).credit, 28);
  assert.equal((await User.findById(referred._id)).credit, 28);
  assert.equal(await Referral.countDocuments({ referredUserId: referred._id }), 1);
});
