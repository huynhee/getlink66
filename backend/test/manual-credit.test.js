import test from "node:test";
import assert from "node:assert/strict";
import { grantManualCredit, setManualCredit } from "../src/utils/manualCreditService.js";

test("manual credit is restored when ledger creation fails", async () => {
  let credit = 10;
  const userModel = {
    async findOneAndUpdate(_query, update) {
      credit += update.$inc.credit;
      return { _id: "user-1", credit };
    },
    async findByIdAndUpdate(_id, update) {
      credit += update.$inc.credit;
      return { _id: "user-1", credit };
    },
  };

  await assert.rejects(
    grantManualCredit(
      { userId: "user-1", amount: 5, maxStoredCredit: 100 },
      {
        forceNonTransactional: true,
        userModel,
        topupModel: {
          async create() {
            throw new Error("ledger failed");
          },
        },
      },
    ),
    /ledger failed/,
  );
  assert.equal(credit, 10);
});

test("setting manual credit records the exact balance delta", async () => {
  let credit = 10;
  let ledger = null;
  const userModel = {
    async findById() {
      return { _id: "user-2", credit };
    },
    async findOneAndUpdate(query, update) {
      if (Number(query.credit) !== credit) return null;
      credit = Number(update.$set.credit);
      return { _id: "user-2", credit };
    },
  };

  const result = await setManualCredit(
    { userId: "user-2", targetCredit: 4 },
    {
      forceNonTransactional: true,
      userModel,
      topupModel: {
        async create(data) {
          ledger = data;
          return { ...data, _id: "ledger-2" };
        },
      },
    },
  );

  assert.equal(credit, 4);
  assert.equal(result.delta, -6);
  assert.equal(ledger.credit, -6);
  assert.equal(ledger.manualBalanceBefore, 10);
  assert.equal(ledger.manualBalanceAfter, 4);
});

test("setting manual credit restores the old balance when ledger creation fails", async () => {
  let credit = 10;
  const userModel = {
    async findById() {
      return { _id: "user-3", credit };
    },
    async findOneAndUpdate(query, update) {
      if (Number(query.credit) !== credit) return null;
      credit = Number(update.$set.credit);
      return { _id: "user-3", credit };
    },
  };

  await assert.rejects(
    setManualCredit(
      { userId: "user-3", targetCredit: 25 },
      {
        forceNonTransactional: true,
        userModel,
        topupModel: {
          async create() {
            throw new Error("set ledger failed");
          },
        },
      },
    ),
    /set ledger failed/,
  );
  assert.equal(credit, 10);
});
