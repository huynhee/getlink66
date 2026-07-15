import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import Topup from "../models/Topup.js";
import User from "../models/User.js";
import logger from "./logger.js";

function transactionUnsupported(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("transaction numbers are only allowed") ||
    text.includes("replica set member or mongos") ||
    text.includes("transactions are not supported")
  );
}

async function grantWithCompensation(
  { userId, amount, maxStoredCredit },
  { userModel, topupModel },
) {
  const user = await userModel.findOneAndUpdate(
    { _id: userId, credit: { $lte: maxStoredCredit - amount } },
    { $inc: { credit: amount } },
    { new: true },
  );
  if (!user) return null;

  try {
    const topup = await topupModel.create({
      userId,
      amount: 0,
      credit: amount,
      type: "manual",
      status: "approved",
      paidAt: new Date(),
      manualBalanceBefore: Number(user.credit || 0) - amount,
      manualBalanceAfter: Number(user.credit || 0),
    });
    return { user, topup, transactional: false };
  } catch (error) {
    try {
      await userModel.findByIdAndUpdate(userId, { $inc: { credit: -amount } });
    } catch (compensationError) {
      logger.error(
        { err: compensationError, userId: String(userId), amount },
        "Manual credit compensation failed",
      );
      error.compensationFailed = true;
    }
    throw error;
  }
}

function creditConflict() {
  const error = new Error("Credit changed while the adjustment was being saved");
  error.status = 409;
  error.code = "CREDIT_CONFLICT";
  return error;
}

function adjustmentLedger({ userId, delta, before, after }) {
  return {
    userId,
    amount: 0,
    credit: delta,
    type: "manual",
    status: "approved",
    paidAt: new Date(),
    manualBalanceBefore: before,
    manualBalanceAfter: after,
  };
}

async function setWithCompensation(
  { userId, targetCredit },
  { userModel, topupModel },
) {
  const current = await userModel.findById(userId);
  if (!current) return null;
  const before = Number(current.credit || 0);
  const after = Number(targetCredit);
  const delta = after - before;
  if (delta === 0) {
    return { user: current, topup: null, transactional: false, before, after, delta };
  }

  const user = await userModel.findOneAndUpdate(
    { _id: userId, credit: before },
    { $set: { credit: after } },
    { new: true },
  );
  if (!user) throw creditConflict();

  try {
    const topup = await topupModel.create(adjustmentLedger({ userId, delta, before, after }));
    return { user, topup, transactional: false, before, after, delta };
  } catch (error) {
    try {
      const restored = await userModel.findOneAndUpdate(
        { _id: userId, credit: after },
        { $set: { credit: before } },
        { new: true },
      );
      if (!restored) throw creditConflict();
    } catch (compensationError) {
      logger.error(
        { err: compensationError, userId: String(userId), before, after, delta },
        "Manual credit set compensation failed",
      );
      error.compensationFailed = true;
    }
    throw error;
  }
}

export async function grantManualCredit(
  input,
  {
    userModel = User,
    topupModel = Topup,
    forceNonTransactional = false,
  } = {},
) {
  const dependencies = { userModel, topupModel };
  if (forceNonTransactional || isMemoryDb()) {
    return grantWithCompensation(input, dependencies);
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const user = await userModel.findOneAndUpdate(
        {
          _id: input.userId,
          credit: { $lte: input.maxStoredCredit - input.amount },
        },
        { $inc: { credit: input.amount } },
        { new: true, session },
      );
      if (!user) return;
      const [topup] = await topupModel.create(
        [{
          userId: input.userId,
          amount: 0,
          credit: input.amount,
          type: "manual",
          status: "approved",
          paidAt: new Date(),
          manualBalanceBefore: Number(user.credit || 0) - input.amount,
          manualBalanceAfter: Number(user.credit || 0),
        }],
        { session },
      );
      result = { user, topup, transactional: true };
    });
    return result;
  } catch (error) {
    if (!transactionUnsupported(error)) throw error;
    logger.warn(
      { message: error.message },
      "MongoDB transactions unavailable; using compensated manual credit write",
    );
    return grantWithCompensation(input, dependencies);
  } finally {
    await session.endSession();
  }
}

export async function setManualCredit(
  input,
  {
    userModel = User,
    topupModel = Topup,
    forceNonTransactional = false,
  } = {},
) {
  const dependencies = { userModel, topupModel };
  if (forceNonTransactional || isMemoryDb()) {
    return setWithCompensation(input, dependencies);
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const currentQuery = userModel.findById(input.userId);
      const current = typeof currentQuery?.session === "function"
        ? await currentQuery.session(session)
        : await currentQuery;
      if (!current) return;

      const before = Number(current.credit || 0);
      const after = Number(input.targetCredit);
      const delta = after - before;
      if (delta === 0) {
        result = { user: current, topup: null, transactional: true, before, after, delta };
        return;
      }

      const user = await userModel.findOneAndUpdate(
        { _id: input.userId, credit: before },
        { $set: { credit: after } },
        { new: true, session },
      );
      if (!user) throw creditConflict();
      const [topup] = await topupModel.create(
        [adjustmentLedger({ userId: input.userId, delta, before, after })],
        { session },
      );
      result = { user, topup, transactional: true, before, after, delta };
    });
    return result;
  } catch (error) {
    if (!transactionUnsupported(error)) throw error;
    logger.warn(
      { message: error.message },
      "MongoDB transactions unavailable; using compensated manual credit set",
    );
    return setWithCompensation(input, dependencies);
  } finally {
    await session.endSession();
  }
}
