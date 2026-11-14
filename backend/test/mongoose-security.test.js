import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";

function fixture(t, policy) {
  const instance = new mongoose.Mongoose();
  if (policy === "global") instance.set("sanitizeFilter", true);
  const connection = instance.createConnection();
  // The native driver stores createConnection's sanitizeFilter option in config.
  if (policy === "connection") connection.config.sanitizeFilter = true;
  const schema = new instance.Schema({ username: String, password: String }, {
    bufferCommands: false, autoCreate: false, autoIndex: false,
  });
  const Model = connection.model("SecurityFixture", schema);
  const calls = [];
  t.mock.method(Model.collection, "countDocuments", async filter => {
    calls.push(structuredClone(filter));
    return 0;
  });
  t.mock.method(Model.collection, "findOne", async filter => {
    calls.push(structuredClone(filter));
    return null;
  });
  return {
    calls,
    query(operation, filter) {
      const query = Model[operation](filter);
      return policy === "query" ? query.setOptions({ sanitizeFilter: true }) : query;
    },
  };
}

for (const policy of ["global", "connection", "query"]) {
  for (const operation of ["countDocuments", "findOne"]) {
    test(`Mongoose ${operation} honors ${policy} sanitizeFilter before reaching the driver`, async t => {
      const state = fixture(t, policy);
      await assert.rejects(
        state.query(operation, { username: "fixture", password: { $ne: null } }).exec(),
        error => error instanceof mongoose.Error.CastError && error.path === "password",
      );
      assert.equal(state.calls.length, 0);
      const query = state.query(operation, { username: "fixture", password: "literal-value" });
      assert.equal(await query.exec(), operation === "countDocuments" ? 0 : null);
      assert.deepEqual(state.calls, [{ username: "fixture", password: "literal-value" }]);
    });
  }
}
