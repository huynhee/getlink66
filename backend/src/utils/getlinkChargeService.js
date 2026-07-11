import mongoose from "mongoose";
import { isMemoryDb } from "../config/memoryStore.js";
import Getlink from "../models/Getlink.js";
import { addCredit, deductCredit } from "./creditService.js";
import logger from "./logger.js";

function transactionUnsupported(error) {
  const text = String(error?.message || error || "").toLowerCase();
  return (
    text.includes("transaction numbers are only allowed") ||
    text.includes("replica set member or mongos") ||
    text.includes("transactions are not supported")
  );
}

async function createWithCompensation(
  { userId, creditCost, historyPayload },
  { getlinkModel, deduct, add },
) {
  const user = await deduct(userId, creditCost);
  try {
    const history = await getlinkModel.create(historyPayload);
    return { user, history, transactional: false };
  } catch (error) {
    try {
      await add(userId, creditCost);
    } catch (compensationError) {
      logger.error(
        {
          err: compensationError,
          userId: String(userId),
          creditCost,
          originalError: error.message,
        },
        "Getlink credit compensation failed",
      );
      error.compensationFailed = true;
    }
    throw error;
  }
}

export async function chargeAndCreateGetlink(
  { userId, creditCost, historyPayload },
  {
    getlinkModel = Getlink,
    deduct = deductCredit,
    add = addCredit,
    forceNonTransactional = false,
  } = {},
) {
  const input = { userId, creditCost, historyPayload };
  const dependencies = { getlinkModel, deduct, add };
  if (forceNonTransactional || isMemoryDb()) {
    return createWithCompensation(input, dependencies);
  }

  const session = await mongoose.startSession();
  let result = null;
  try {
    await session.withTransaction(async () => {
      const user = await deduct(userId, creditCost, { session });
      const [history] = await getlinkModel.create([historyPayload], { session });
      result = { user, history, transactional: true };
    });
    return result;
  } catch (error) {
    if (!transactionUnsupported(error)) throw error;
    logger.warn(
      { message: error.message },
      "MongoDB transactions unavailable; using compensated getlink write",
    );
    return createWithCompensation(input, dependencies);
  } finally {
    await session.endSession();
  }
}
