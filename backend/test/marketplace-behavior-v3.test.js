import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceBehaviorEvent } = await import("../src/models/MarketplaceBehaviorEvent.js");
const { default: MarketplaceInterestProfile } = await import("../src/models/MarketplaceInterestProfile.js");
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { recordMarketplaceBehavior } = await import("../src/utils/marketplaceBehaviorService.js");

test("duplicate marketplace behavior is stored and scored once", async () => {
  const model = await MarketplaceModel.create({
    source: { provider: "drive", modelId: "behavior-v3-chair" },
    assetType: "model",
    title: "Behavior V3 chair",
    slug: "behavior-v3-chair",
    categorySourceId: "arm-chair",
    parentCategorySourceId: "furniture",
    renderer: "Corona",
    styles: ["modern"],
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });
  const input = {
    actorKey: "anon:behavior-v3-test",
    modelId: model._id,
    assetType: "model",
    eventType: "click",
    queryId: "query-v3",
    position: 2,
    source: "search",
    eventId: "behavior-v3-event",
  };

  const first = await recordMarketplaceBehavior(input);
  const duplicate = await recordMarketplaceBehavior(input);
  const events = await MarketplaceBehaviorEvent.find({ actorKey: input.actorKey }).lean();
  const profile = await MarketplaceInterestProfile.findOne({ actorKey: input.actorKey }).lean();
  const updatedModel = await MarketplaceModel.findById(model._id).lean();

  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(events.length, 1);
  assert.equal(profile.eventCount, 1);
  assert.equal(profile.weights["category:arm-chair"], 3);
  assert.equal(updatedModel.behaviorMetrics.clicks, 1);
});
