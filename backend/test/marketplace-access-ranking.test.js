import test from "node:test";
import assert from "node:assert/strict";
import {
  isExactMarketplaceTitleOrSlug,
  marketplaceAccessSlots,
  marketplaceModelFreeInterval,
  marketplaceRankingMetadata,
  mixMarketplaceAccessRankedModels,
  shouldPrioritizeMarketplacePro,
} from "../src/utils/marketplaceAccessRanking.js";

function model(id, accessType = "member", title = `Model ${id}`) {
  return { _id: id, accessType, title, slug: title.toLowerCase().replace(/\s+/g, "-") };
}

test("model discovery uses a bounded 9 Pro to 1 Free sequence", () => {
  const members = Array.from({ length: 18 }, (_, index) => model(`pro-${index}`));
  const free = Array.from({ length: 4 }, (_, index) => model(`free-${index}`, "free"));
  const mixed = mixMarketplaceAccessRankedModels([...members, ...free], { interval: 10 });

  assert.deepEqual(mixed.slice(0, 10).map((item) => item.accessType), [
    "member", "member", "member", "member", "member",
    "member", "member", "member", "member", "free",
  ]);
  assert.equal(mixed[19].accessType, "free");
  assert.equal(new Set(mixed.map((item) => item._id)).size, mixed.length);
});

test("access slots stay stable across page boundaries", () => {
  const first = marketplaceAccessSlots({
    memberTotal: 30,
    freeTotal: 8,
    offset: 0,
    limit: 10,
    interval: 10,
  });
  const second = marketplaceAccessSlots({
    memberTotal: 30,
    freeTotal: 8,
    offset: 10,
    limit: 10,
    interval: 10,
  });

  assert.equal(first.filter((slot) => slot.accessType === "free").length, 1);
  assert.equal(second.filter((slot) => slot.accessType === "free").length, 1);
  assert.equal(first.at(-1).index, 0);
  assert.equal(second.at(-1).index, 1);
});

test("an exact Free title can be pinned before the Pro-first sequence", () => {
  const exact = model("exact-free", "free", "Ghế bành");
  const mixed = mixMarketplaceAccessRankedModels([
    model("pro-1"),
    exact,
    model("free-2", "free"),
    ...Array.from({ length: 10 }, (_, index) => model(`pro-${index + 2}`)),
  ], {
    interval: 10,
    pinnedPredicate: (candidate) => (
      candidate.accessType === "free" && isExactMarketplaceTitleOrSlug(candidate, "ghe banh")
    ),
  });

  assert.equal(mixed[0]._id, exact._id);
  assert.equal(isExactMarketplaceTitleOrSlug(exact, "ghế bành"), true);
});

test("Free results remain usable when no Pro candidate exists", () => {
  const free = Array.from({ length: 12 }, (_, index) => model(`free-${index}`, "free"));
  assert.deepEqual(
    mixMarketplaceAccessRankedModels(free, { interval: 10 }).map((item) => item._id),
    free.map((item) => item._id),
  );
});

test("the policy only applies to unfiltered Model discovery", () => {
  assert.equal(shouldPrioritizeMarketplacePro("model", ""), true);
  assert.equal(shouldPrioritizeMarketplacePro("model", "free"), false);
  assert.equal(shouldPrioritizeMarketplacePro("model", "member"), false);
  assert.equal(shouldPrioritizeMarketplacePro("scene", ""), false);
  assert.equal(marketplaceRankingMetadata({ applied: false, accessType: "free" }).reason, "access_filter");
});

test("the Free interval is configurable within safe bounds", () => {
  const previous = process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL;
  try {
    process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL = "1";
    assert.equal(marketplaceModelFreeInterval(), 2);
    process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL = "100";
    assert.equal(marketplaceModelFreeInterval(), 50);
    process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL = "invalid";
    assert.equal(marketplaceModelFreeInterval(), 10);
  } finally {
    if (previous === undefined) delete process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL;
    else process.env.MARKETPLACE_MODEL_FREE_SEARCH_INTERVAL = previous;
  }
});
