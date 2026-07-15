import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: MembershipOrder } = await import("../src/models/MembershipOrder.js");
const { default: DailyDownloadQuota } = await import("../src/models/DailyDownloadQuota.js");
const { default: MarketplaceQuotaGrant } = await import("../src/models/MarketplaceQuotaGrant.js");
const { synchronizeMarketplaceQuotaGrant } = await import("../src/utils/marketplaceQuotaGrantService.js");

test("a daily Pro order grants marketplace quota exactly once", async () => {
  const user = await User.create({ email: "quota-grant@example.test", name: "Quota grant" });
  const order = await MembershipOrder.create({
    userId: user._id,
    planId: "daily-addon-plan",
    planCode: "DAILY",
    planName: "Daily add-on",
    amount: 50000,
    durationDays: 1,
    dailyDownloadLimit: 50,
    status: "approved",
    isQuotaAddon: true,
    quotaBoostAmount: 50,
    quotaBoostDayKey: "2026-07-15",
    quotaSyncStatus: "pending",
  });

  const first = await synchronizeMarketplaceQuotaGrant(order);
  const second = await synchronizeMarketplaceQuotaGrant(await MembershipOrder.findById(order._id));
  const quota = await DailyDownloadQuota.findOne({
    dayKey: "2026-07-15",
    userId: user._id,
    tier: "member",
  });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(quota.bonusLimit, 50);
  assert.equal(await MarketplaceQuotaGrant.countDocuments({ membershipOrderId: order._id }), 1);
  assert.equal((await MembershipOrder.findById(order._id)).quotaSyncStatus, "applied");
});
