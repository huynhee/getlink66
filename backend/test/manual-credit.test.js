import test from "node:test";
import assert from "node:assert/strict";
import { grantManualCredit } from "../src/utils/manualCreditService.js";

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
