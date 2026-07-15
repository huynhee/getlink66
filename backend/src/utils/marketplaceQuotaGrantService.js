import { isMemoryDb } from "../config/memoryStore.js";
import { marketplaceDbConnection } from "../config/db.js";
import DailyDownloadQuota from "../models/DailyDownloadQuota.js";
import MarketplaceQuotaGrant from "../models/MarketplaceQuotaGrant.js";
import MembershipOrder from "../models/MembershipOrder.js";

function resetAtForDayKey(dayKey) {
  const [year, month, day] = String(dayKey || "").split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day, 17, 0, 0, 0));
}

async function applyOnMarketplace(order, databaseSession = null) {
  const existing = await MarketplaceQuotaGrant.findOne({ membershipOrderId: order._id });
  if (existing) return { grant: existing, applied: false };
  const dayKey = String(order.quotaBoostDayKey || "");
  const resetAt = resetAtForDayKey(dayKey);
  const amount = Math.max(1, Math.floor(Number(order.quotaBoostAmount || order.dailyDownloadLimit || 100)));
  if (!dayKey || !resetAt) throw new Error("Daily Pro add-on is missing a valid quota day.");
  const payload = {
    membershipOrderId: order._id,
    userId: order.userId,
    dayKey,
    amount,
    appliedAt: new Date(),
  };
  let grant;
  try {
    if (databaseSession) {
      [grant] = await MarketplaceQuotaGrant.create([payload], { session: databaseSession });
    } else {
      grant = await MarketplaceQuotaGrant.create(payload);
    }
  } catch (error) {
    if (Number(error?.code) === 11000) {
      const duplicate = await MarketplaceQuotaGrant.findOne({ membershipOrderId: order._id });
      return { grant: duplicate, applied: false };
    }
    throw error;
  }
  try {
    await DailyDownloadQuota.findOneAndUpdate(
      { dayKey, userId: order.userId, guestKey: "", tier: "member" },
      {
        $setOnInsert: { dayKey, userId: order.userId, guestKey: "", tier: "member" },
        $set: { resetAt },
        $inc: { bonusLimit: amount },
      },
      { upsert: true, new: true, ...(databaseSession ? { session: databaseSession } : {}) },
    );
    return { grant, applied: true };
  } catch (error) {
    if (!databaseSession && grant?._id) {
      await MarketplaceQuotaGrant.findByIdAndDelete(grant._id).catch(() => {});
    }
    throw error;
  }
}

async function applyGrant(order) {
  if (isMemoryDb()) return applyOnMarketplace(order);
  const session = await marketplaceDbConnection().startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await applyOnMarketplace(order, session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export async function synchronizeMarketplaceQuotaGrant(order) {
  if (!order?.isQuotaAddon) return { order, applied: false, required: false };
  if (order.status !== "approved") return { order, applied: false, required: true };
  try {
    const result = await applyGrant(order);
    const updated = await MembershipOrder.findByIdAndUpdate(
      order._id,
      {
        $set: {
          quotaSyncStatus: "applied",
          quotaSyncedAt: result.grant?.appliedAt || new Date(),
          quotaSyncError: "",
        },
      },
      { new: true },
    );
    return { order: updated || order, applied: result.applied, required: true };
  } catch (error) {
    const message = String(error?.message || "quota_sync_failed").slice(0, 500);
    const updated = await MembershipOrder.findByIdAndUpdate(
      order._id,
      { $set: { quotaSyncStatus: "error", quotaSyncError: message } },
      { new: true },
    ).catch(() => null);
    error.order = updated || order;
    throw error;
  }
}

export async function retryPendingMarketplaceQuotaGrants(limit = 50) {
  const orders = await MembershipOrder.find({
    status: "approved",
    isQuotaAddon: true,
    quotaSyncStatus: { $in: ["pending", "error", null] },
  })
    .sort({ paidAt: 1 })
    .limit(Math.min(200, Math.max(1, Number(limit || 50))));
  let applied = 0;
  const errors = [];
  for (const order of orders) {
    try {
      await synchronizeMarketplaceQuotaGrant(order);
      applied += 1;
    } catch (error) {
      errors.push({ orderId: String(order._id), message: String(error.message || "quota_sync_failed") });
    }
  }
  return { inspected: orders.length, applied, errors };
}
