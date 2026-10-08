import test from "node:test";
import assert from "node:assert/strict";
import { formatReferralReward, referralInviteTitle } from "../../frontend/src/utils/referralPresentation.js";
import { referralRewardAmount, validReferralRewardAmount } from "../src/utils/referralRewardSettings.js";

test("referral copy uses configured reward amounts in Vietnamese and English", () => {
  const reward = { proDays: 1, credit: 7, modelDownloads: 20 };
  assert.equal(formatReferralReward(reward, "vi"), "Pro hôm nay (20 lượt Model) + 7 credit");
  assert.equal(formatReferralReward(reward, "en"), "Pro today (20 Model downloads) + 7 credits");
  assert.match(referralInviteTitle(reward, "en"), /both receive/);
  assert.match(referralInviteTitle({ ...reward, mode: "referrer_only" }, "en"), /Invite friends to receive/);
});

test("Credit-only and quota-only copy omit disabled benefits", () => {
  assert.equal(formatReferralReward({ credit: 11 }, "en"), "11 credits");
  assert.equal(formatReferralReward({ proDays: 1, modelDownloads: 50 }, "en"), "Pro today (50 Model downloads)");
  assert.equal(formatReferralReward({ proDays: 1 }, "en"), "Pro today (100 Model downloads)");
});

test("reward settings safely default old or invalid values and accept bounds", () => {
  for (const field of ["referralRewardCredit", "referralRewardModelDownloads"]) {
    assert.equal(validReferralRewardAmount(1, field), true);
    assert.equal(validReferralRewardAmount("100000", field), true);
    assert.equal(validReferralRewardAmount(100001, field), false);
    assert.equal(validReferralRewardAmount(null, field), false);
    assert.equal(validReferralRewardAmount(true, field), false);
    assert.equal(validReferralRewardAmount(1.1, field), false);
  }
  assert.equal(referralRewardAmount(undefined, "referralRewardCredit"), 28);
  assert.equal(referralRewardAmount(0, "referralRewardModelDownloads"), 100);
});
