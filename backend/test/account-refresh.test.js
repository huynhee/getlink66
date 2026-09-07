import test from "node:test";
import assert from "node:assert/strict";
import { createAccountRefresh } from "../../frontend/src/utils/accountRefresh.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("account refresh coalesces readers without applying a pre-payment snapshot", async () => {
  const first = deferred();
  const committed = [];
  let calls = 0;
  const account = createAccountRefresh({
    load: () => ++calls === 1 ? first.promise : Promise.resolve({ credit: 105 }),
    commit: (value) => { committed.push(value); return value; },
  });
  const pending = account.refresh();
  assert.equal(account.refresh(), pending);
  assert.equal(account.refresh({ fresh: true }), pending);
  first.resolve({ credit: 5 });
  assert.deepEqual(await pending, { credit: 105 });
  assert.deepEqual(committed, [{ credit: 105 }]);
  assert.equal(calls, 2);
});

test("a stale failed account request cannot discard a newer login", async () => {
  const first = deferred();
  let calls = 0;
  const account = createAccountRefresh({
    load: () => ++calls === 1 ? first.promise : Promise.resolve({ _id: "new-user" }),
    commit: (value) => value,
  });
  const pending = account.refresh();
  account.invalidate();
  first.reject(new Error("Old session expired"));
  assert.deepEqual(await pending, { _id: "new-user" });
});

test("account refresh recovers after an actual network error", async () => {
  let calls = 0;
  const account = createAccountRefresh({
    load: async () => { if (++calls === 1) throw new Error("offline"); return null; },
    commit: (value) => value,
  });
  await assert.rejects(account.refresh(), /offline/);
  assert.equal(await account.refresh(), null);
});
