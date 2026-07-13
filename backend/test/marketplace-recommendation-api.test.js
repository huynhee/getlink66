import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const {
  getMarketplaceModel,
  listMarketplaceModelRecommendations,
} = await import("../src/controllers/marketplaceController.js");

function responseCapture() {
  const state = { statusCode: 200, body: null };
  return {
    state,
    response: {
      status(code) {
        state.statusCode = code;
        return this;
      },
      json(value) {
        state.body = value;
        return value;
      },
    },
  };
}

test("model detail returns six recommendations and expansion returns the next 54", async () => {
  await MarketplaceModel.create({
    source: { provider: "drive", modelId: "recommendation-source" },
    title: "Source chair",
    slug: "source-chair",
    categoryId: "chairs",
    parentCategoryId: "furniture",
    renderer: "Corona",
    renderers: ["corona"],
    styles: ["modern"],
    forms: ["organic"],
    colors: ["beige"],
    materials: ["fabric"],
    accessType: "member",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
  });
  await MarketplaceModel.insertMany(Array.from({ length: 60 }, (_, index) => ({
    source: { provider: "drive", modelId: `recommendation-${index}` },
    title: `Recommended chair ${index + 1}`,
    slug: `recommended-chair-${index + 1}`,
    categoryId: "chairs",
    parentCategoryId: "furniture",
    renderer: index % 2 ? "Vray" : "Corona",
    renderers: [index % 2 ? "vray" : "corona"],
    styles: ["modern"],
    forms: ["organic"],
    colors: ["beige"],
    materials: ["fabric"],
    accessType: index % 3 ? "member" : "free",
    metadataStatus: "complete",
    fileStatus: "ready",
    isPublished: true,
    downloadCount: index,
  })));

  const detail = responseCapture();
  await getMarketplaceModel(
    { params: { slug: "source-chair" } },
    detail.response,
    (error) => { throw error; },
  );
  assert.equal(detail.state.statusCode, 200);
  assert.equal(detail.state.body.recommendedModels.length, 6);
  assert.equal(detail.state.body.recommendations.total, 60);
  assert.equal(detail.state.body.recommendations.hasMore, true);

  const expanded = responseCapture();
  await listMarketplaceModelRecommendations(
    { params: { slug: "source-chair" }, query: { offset: "6", limit: "54" } },
    expanded.response,
    (error) => { throw error; },
  );
  assert.equal(expanded.state.statusCode, 200);
  assert.equal(expanded.state.body.models.length, 54);
  assert.equal(expanded.state.body.pagination.total, 60);
  assert.equal(expanded.state.body.pagination.hasMore, false);
});
