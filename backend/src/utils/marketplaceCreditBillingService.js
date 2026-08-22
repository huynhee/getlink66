import crypto from "node:crypto";
import mongoose from "mongoose";
import CreditLedgerEntry from "../models/CreditLedgerEntry.js";
import MarketplaceCreditEntitlement from "../models/MarketplaceCreditEntitlement.js";
import User from "../models/User.js";
import { isMemoryDb } from "../config/memoryStore.js";
import { addCredit, deductCredit } from "./creditService.js";
import logger from "./logger.js";

const ENTITLEMENT_TTL_MS = 24 * 60 * 60 * 1000;
const ENTITLEMENT_PURGE_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const compensationLocks = new Map();

function identity(userId, assetType, assetId) {
  return {
    userId,
    assetType: assetType === "scene" ? "scene" : "model",
    assetId: String(assetId),
  };
}

function activeEntitlementQuery(userId, assetType, assetId, now = new Date()) {
  return { ...identity(userId, assetType, assetId), validUntil: { $gt: now } };
}

function insufficientCreditError(balance, required) {
  const error = new Error("Insufficient Credit for this download.");
  error.status = 402;
  error.code = "INSUFFICIENT_CREDIT";
  error.details = { balance: Number(balance || 0), required, topupUrl: "/topup?mode=credit" };
  error.publicDetails = error.details;
  return error;
}

function ledgerPayload({ user, cost, model, entitlementId, operationId }) {
  return {
    userId: user._id,
    direction: "debit",
    amount: cost,
    balanceBefore: Number(user.credit || 0) + cost,
    balanceAfter: Number(user.credit || 0),
    type: "marketplace_download",
    asset: {
      assetType: model.assetType === "scene" ? "scene" : "model",
      assetId: String(model._id),
      sourceAssetId: String(model.source?.assetId || model.source?.modelId || ""),
      title: String(model.title || "").slice(0, 300),
      slug: String(model.slug || "").slice(0, 300),
    },
    idempotencyKey: operationId,
    entitlementId: String(entitlementId || ""),
  };
}

export async function getMarketplaceCreditEntitlement({ userId, assetType, assetId, now = new Date() }) {
  return MarketplaceCreditEntitlement.findOne(activeEntitlementQuery(userId, assetType, assetId, now)).lean();
}

async function existingBillingResult(entitlement, operationId) {
  const chargedByThisOperation = Boolean(
    operationId && String(entitlement?.lastTransactionId || "") === String(operationId),
  );
  const ledger = chargedByThisOperation
    ? await CreditLedgerEntry.findOne({ idempotencyKey: operationId })
    : null;
  return {
    charged: chargedByThisOperation,
    reused: !chargedByThisOperation,
    entitlement,
    ledger,
  };
}

async function withCompensationLock(lockKey, callback) {
  const previous = compensationLocks.get(lockKey) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  compensationLocks.set(lockKey, current);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (compensationLocks.get(lockKey) === current) compensationLocks.delete(lockKey);
  }
}

async function chargeWithTransaction({ userId, model, cost, now, operationId }) {
  const databaseSession = await mongoose.startSession();
  let result = null;
  try {
    await databaseSession.withTransaction(async () => {
      const query = activeEntitlementQuery(userId, model.assetType, model._id, now);
      const existing = await MarketplaceCreditEntitlement.findOne(query).session(databaseSession);
      if (existing) {
        const chargedByThisOperation = String(existing.lastTransactionId || "") === String(operationId);
        const ledger = chargedByThisOperation
          ? await CreditLedgerEntry.findOne({ idempotencyKey: operationId }).session(databaseSession)
          : null;
        result = {
          charged: chargedByThisOperation,
          reused: !chargedByThisOperation,
          entitlement: existing,
          ledger,
        };
        return;
      }

      const user = await User.findOneAndUpdate(
        { _id: userId, credit: { $gte: cost } },
        { $inc: { credit: -cost } },
        { new: true, session: databaseSession },
      );
      if (!user) {
        const current = await User.findById(userId).session(databaseSession).select("credit");
        throw insufficientCreditError(current?.credit, cost);
      }

      const validUntil = new Date(now.getTime() + ENTITLEMENT_TTL_MS);
      const purgeAt = new Date(validUntil.getTime() + ENTITLEMENT_PURGE_DELAY_MS);
      const entitlement = await MarketplaceCreditEntitlement.findOneAndUpdate(
        identity(userId, model.assetType, model._id),
        {
          $set: {
            creditCost: cost,
            chargedAt: now,
            validUntil,
            purgeAt,
            lastTransactionId: operationId,
          },
          $inc: { version: 1 },
        },
        { upsert: true, new: true, session: databaseSession },
      );
      const [ledger] = await CreditLedgerEntry.create([
        ledgerPayload({ user, cost, model, entitlementId: entitlement._id, operationId }),
      ], { session: databaseSession });
      result = { charged: true, reused: false, entitlement, ledger, user };
    });
    return result;
  } finally {
    await databaseSession.endSession();
  }
}

async function chargeWithCompensation({ userId, model, cost, now, operationId }) {
  const existing = await getMarketplaceCreditEntitlement({
    userId,
    assetType: model.assetType,
    assetId: model._id,
    now,
  });
  if (existing) return existingBillingResult(existing, operationId);

  const user = await deductCredit(userId, cost).catch(async (error) => {
    if (error?.status !== 402) throw error;
    const current = await User.findById(userId);
    throw insufficientCreditError(current?.credit, cost);
  });
  let ledger = null;
  let entitlement = null;
  try {
    const validUntil = new Date(now.getTime() + ENTITLEMENT_TTL_MS);
    entitlement = await MarketplaceCreditEntitlement.findOneAndUpdate(
      identity(userId, model.assetType, model._id),
      {
        $set: {
          creditCost: cost,
          chargedAt: now,
          validUntil,
          purgeAt: new Date(validUntil.getTime() + ENTITLEMENT_PURGE_DELAY_MS),
          lastTransactionId: operationId,
        },
        $inc: { version: 1 },
      },
      { upsert: true, new: true },
    );
    ledger = await CreditLedgerEntry.create(
      ledgerPayload({ user, cost, model, entitlementId: entitlement._id, operationId }),
    );
    return { charged: true, reused: false, entitlement, ledger, user };
  } catch (error) {
    await Promise.all([
      ledger?._id ? CreditLedgerEntry.findByIdAndDelete(ledger._id).catch(() => {}) : Promise.resolve(),
      entitlement?._id ? MarketplaceCreditEntitlement.findByIdAndDelete(entitlement._id).catch(() => {}) : Promise.resolve(),
      addCredit(userId, cost).catch((compensationError) => {
        logger.error({ err: compensationError, userId: String(userId), cost }, "Marketplace Credit compensation failed");
      }),
    ]);
    throw error;
  }
}

export async function ensureMarketplaceCreditBillingIndexes() {
  await Promise.all(
    [CreditLedgerEntry, MarketplaceCreditEntitlement]
      .filter((model) => typeof model.init === "function")
      .map((model) => model.init()),
  );
}

export async function ensureMarketplaceCreditEntitlement({
  userId,
  model,
  cost,
  now = new Date(),
  operationId: requestedOperationId = "",
}) {
  const safeCost = Math.max(1, Math.floor(Number(cost || 0)));
  const operationId = requestedOperationId
    || `marketplace:${userId}:${model.assetType}:${model._id}:${crypto.randomUUID()}`;
  const existing = await getMarketplaceCreditEntitlement({
    userId,
    assetType: model.assetType,
    assetId: model._id,
    now,
  });
  if (existing) return existingBillingResult(existing, operationId);
  if (isMemoryDb() || process.env.NODE_ENV !== "production") {
    const lockKey = `${userId}:${model.assetType}:${model._id}`;
    return withCompensationLock(lockKey, async () => {
      const lockedExisting = await getMarketplaceCreditEntitlement({
        userId,
        assetType: model.assetType,
        assetId: model._id,
        now,
      });
      if (lockedExisting) return existingBillingResult(lockedExisting, operationId);
      return chargeWithCompensation({ userId, model, cost: safeCost, now, operationId });
    });
  }
  return chargeWithTransaction({ userId, model, cost: safeCost, now, operationId });
}
