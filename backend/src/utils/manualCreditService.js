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
