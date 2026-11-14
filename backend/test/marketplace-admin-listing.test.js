import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createMemoryModel, useMemoryDb } from "../src/config/memoryStore.js";
import { ADMIN_ASSET_INDEX, adminListingError, listAdminAssets } from "../src/utils/marketplaceAdminListing.js";

useMemoryDb();
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { default: MarketplaceReport } = await import("../src/models/MarketplaceReport.js");
const { adminListMarketplaceModels } = await import("../src/controllers/marketplaceAdminController.js");

function aggregateFixture(results, calls = []) {
  return {
    aggregate(pipeline) {
      return { async option(options) { calls.push({ pipeline, options }); return results.shift(); } };
    },
  };
}

test("admin listing uses one bounded, hinted scan for both the exact count and page", async () => {
  const calls = [];
  const query = { assetType: "model", $or: [{ title: /chair/i }] };
  const signal = new AbortController().signal;
  const result = await listAdminAssets(aggregateFixture([
    [{ total: [{ value: 42 }], models: [{ _id: "chair" }] }],
  ], calls), query, 2, { signal });
  assert.deepEqual(result.pagination, { page: 2, pageSize: 20, total: 42, totalPages: 3 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.hint, ADMIN_ASSET_INDEX);
  assert.ok(calls[0].options.maxTimeMS > 0 && calls[0].options.maxTimeMS <= 10_000);
  assert.equal(calls[0].options.signal, signal);
  assert.deepEqual(calls[0].pipeline, [
    { $match: query }, { $sort: { createdAt: -1, _id: -1 } },
    { $facet: { total: [{ $count: "value" }], models: [
      { $skip: 20 }, { $limit: 20 }, { $project: { "source.raw": 0 } },
    ] } },
  ]);
});

test("out-of-range pages clamp to the last page without a second count", async () => {
  const calls = [];
  const result = await listAdminAssets(aggregateFixture([
    [{ total: [{ value: 21 }], models: [] }], [{ _id: "last" }],
  ], calls), { assetType: "scene" }, 999);
  assert.equal(result.pagination.page, 2);
  assert.equal(result.models[0]._id, "last");
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].pipeline[2], { $skip: 20 });
  assert.ok(calls[1].options.maxTimeMS <= calls[0].options.maxTimeMS);
});

test("empty catalogs and invalid pages keep the existing pagination contract", async () => {
  for (const page of [1, 99, -1, NaN, 1.2, Infinity]) {
    const calls = [];
    const result = await listAdminAssets(aggregateFixture([[{ total: [], models: [] }]], calls), { assetType: "scene" }, page);
    assert.deepEqual(result.pagination, { page: 1, pageSize: 20, total: 0, totalPages: 1 });
    assert.equal(calls.length, 1);
  }
});

test("database timeouts are typed without retrying the expensive query", async () => {
  for (const error of [{ code: 50 }, { code: 262 }, { name: "MongoNetworkTimeoutError" }]) {
    const mapped = adminListingError(error);
    assert.equal(mapped.status, 504);
    assert.equal(mapped.code, "ADMIN_MARKETPLACE_QUERY_TIMEOUT");
    assert.equal(mapped.cause, error);
  }
  const missing = adminListingError({ code: 2, message: "hint provided does not correspond to an existing index" });
  assert.equal(missing.code, "ADMIN_MARKETPLACE_INDEX_REQUIRED");
  const unrelated = new Error("unrelated");
  assert.equal(adminListingError(unrelated), unrelated);
});

test("aborted requests never execute or return stale results", async () => {
  const controller = new AbortController();
  controller.abort();
  const calls = [];
  await assert.rejects(listAdminAssets(aggregateFixture([], calls), {}, 1, { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls.length, 0);
  const active = new AbortController();
  await assert.rejects(listAdminAssets({ aggregate() { return { async option() {
    active.abort(); return [{ total: [], models: [] }];
  } }; } }, {}, 1, { signal: active.signal }), { name: "AbortError" });
});

test("memory pagination is stable for equal timestamps", async () => {
  const Model = createMemoryModel("AdminListingPagingFixture");
  for (let index = 1; index <= 21; index += 1) {
    const id = String(index).padStart(24, "0");
    await Model.create({ _id: id, assetType: "model" });
    await Model.updateMany({ _id: id }, { $set: { createdAt: "2026-11-14T00:00:00Z" } });
  }
  const first = await listAdminAssets(Model, { assetType: "model" }, 1, { memory: true });
  const last = await listAdminAssets(Model, { assetType: "model" }, 50, { memory: true });
  assert.equal(first.models.length, 20);
  assert.equal(first.models[0]._id, "000000000000000000000021");
  assert.equal(last.models[0]._id, "000000000000000000000001");
  assert.equal(last.pagination.page, 2);
});

test("admin filters preserve legacy active assets, scenes, literal searches and reports", async () => {
  await MarketplaceModel.deleteMany({});
  await MarketplaceReport.deleteMany({});
  const base = { assetType: "model", title: "Chair (A)", fileStatus: "ready", accessType: "free", isPublished: false, metadataStatus: "incomplete" };
  const expected = await MarketplaceModel.create({ ...base, source: { raw: { private: true }, assetId: "asset-id" } });
  await MarketplaceModel.create({ ...base, title: "Chair A", deletionStatus: "active" });
  await MarketplaceModel.create({ ...base, deletionStatus: "trashed" });
  const scene = await MarketplaceModel.create({ ...base, assetType: "scene", deletionStatus: "active" });
  await MarketplaceReport.create({ modelId: expected._id, assetType: "model", isActive: true });
  const list = async (query, assetType = "model") => {
    let payload;
    await adminListMarketplaceModels({ query, marketplaceAssetType: assetType }, { json(data) { payload = data; } }, (error) => { throw error; });
    return payload;
  };
  const filtered = await list({ search: "Chair (A)", reportedOnly: "true", published: "unpublished", accessType: "free", fileStatus: "ready", metadataStatus: "incomplete" });
  assert.equal(filtered.models.length, 1);
  assert.equal(filtered.models[0]._id, expected._id);
  assert.equal(filtered.models[0].source.raw, undefined);
  assert.equal(filtered.models[0].openReportCount, 1);
  assert.equal((await list({ deleted: "trashed" })).models.length, 1);
  assert.equal((await list({ deleted: "all" })).pagination.total, 3);
  assert.equal((await list({}, "scene")).models[0]._id, scene._id);
});

test("the controller detaches its disconnect listener after returning", async () => {
  const res = new EventEmitter();
  res.json = () => { res.writableEnded = true; res.emit("close"); };
  await adminListMarketplaceModels({ query: {} }, res, (error) => { throw error; });
  assert.equal(res.listenerCount("close"), 0);
});

test("disconnects cancel the controller without logging an internal server error", async () => {
  const original = MarketplaceModel.countDocuments;
  let release;
  MarketplaceModel.countDocuments = () => new Promise((resolve) => { release = resolve; });
  const res = new EventEmitter();
  res.json = () => assert.fail("Disconnected requests must not send a result");
  try {
    const task = adminListMarketplaceModels({ query: {} }, res, () => assert.fail("A client disconnect is not a server error"));
    res.emit("close");
    release(0);
    await task;
    assert.equal(res.listenerCount("close"), 0);
  } finally {
    MarketplaceModel.countDocuments = original;
  }
});
