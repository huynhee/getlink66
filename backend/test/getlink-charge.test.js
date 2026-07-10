import test from "node:test";
import assert from "node:assert/strict";
import { chargeAndCreateGetlink } from "../src/utils/getlinkChargeService.js";

test("restores credit when a non-transactional history insert fails", async () => {
  const calls = [];
  const insertError = new Error("history insert failed");

  await assert.rejects(
    chargeAndCreateGetlink(
      {
        userId: "user-1",
        creditCost: 5,
        historyPayload: { productId: "MODEL-1" },
      },
      {
        forceNonTransactional: true,
        deduct: async (userId, amount) => {
          calls.push(["deduct", userId, amount]);
          return { _id: userId, credit: 5 };
        },
        add: async (userId, amount) => {
          calls.push(["restore", userId, amount]);
          return { _id: userId, credit: 10 };
        },
        getlinkModel: {
          async create() {
            throw insertError;
          },
        },
      },
    ),
    insertError,
  );

  assert.deepEqual(calls, [
    ["deduct", "user-1", 5],
    ["restore", "user-1", 5],
  ]);
});

test("returns both user and history on a compensated-mode success", async () => {
  const result = await chargeAndCreateGetlink(
    {
      userId: "user-1",
      creditCost: 2,
      historyPayload: { productId: "MODEL-2" },
    },
    {
      forceNonTransactional: true,
      deduct: async () => ({ _id: "user-1", credit: 8 }),
      add: async () => {
        throw new Error("restore must not run");
      },
      getlinkModel: {
        async create(payload) {
          return { _id: "history-1", ...payload };
        },
      },
    },
  );

  assert.equal(result.user.credit, 8);
  assert.equal(result.history.productId, "MODEL-2");
});
