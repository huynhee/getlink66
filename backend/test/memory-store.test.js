import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryModel } from "../src/config/memoryStore.js";

test("memory store supports operators used by production services", async () => {
  const Model = createMemoryModel("MemoryStoreContractTest");
  const first = await Model.create({
    name: "Alpha",
    usedCount: 1,
    usageLimit: 2,
    nested: { removable: true },
  });
  await Model.create({ name: "Beta", usedCount: 2, usageLimit: 2 });

  const regexMatches = await Model.find({ name: /^alp/i });
  assert.equal(regexMatches.length, 1);

  const available = await Model.find({
    $expr: { $lt: ["$usedCount", "$usageLimit"] },
  });
  assert.deepEqual(available.map((item) => item.name), ["Alpha"]);

  await Model.findByIdAndUpdate(first._id, {
    $set: { "nested.kept": true },
    $unset: { "nested.removable": "" },
  });
  const updated = await Model.findById(first._id);
  assert.equal(updated.nested.kept, true);
  assert.equal(Object.hasOwn(updated.nested, "removable"), false);

  const skipped = await Model.find().sort({ createdAt: 1 }).skip(1).limit(1);
  assert.equal(skipped.length, 1);

  const deleted = await Model.deleteOne({ name: "Beta" });
  assert.equal(deleted.deletedCount, 1);
  assert.equal(await Model.countDocuments(), 1);
});
