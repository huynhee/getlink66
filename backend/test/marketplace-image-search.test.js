import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();

const { default: User } = await import("../src/models/User.js");
const { default: DailyImageSearchQuota } = await import("../src/models/DailyImageSearchQuota.js");
const { searchMarketplaceByImage } = await import("../src/controllers/marketplaceController.js");
const {
  normalizeImageSearchMatches,
  searchMarketplaceImage,
} = await import("../src/utils/marketplaceImageSearchProvider.js");

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("image match normalization keeps provider order and removes duplicate IDs", () => {
  const matches = normalizeImageSearchMatches({
    matches: [
      { modelId: "100", score: 0.98 },
      { sourceModelId: "200", similarity: 0.91 },
      { modelId: "100", score: 0.5 },
      "300",
    ],
  }, 3);

  assert.deepEqual(matches.map((item) => item.modelId), ["100", "200", "300"]);
  assert.equal(matches[0].score, 0.98);
  assert.equal(matches[1].score, 0.91);
});

test("external image provider sends the image and returns normalized matches", async () => {
  const previousUrl = process.env.MARKETPLACE_IMAGE_SEARCH_URL;
  const previousKey = process.env.MARKETPLACE_IMAGE_SEARCH_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.MARKETPLACE_IMAGE_SEARCH_URL = "https://image-search.example.test/query";
  process.env.MARKETPLACE_IMAGE_SEARCH_API_KEY = "test-key";
  let request = null;
  globalThis.fetch = async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ matches: [{ modelId: "6373049", score: 0.95 }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const result = await searchMarketplaceImage({
      imageData: "data:image/jpeg;base64,aW1hZ2U=",
      imageHash: "abc123",
      limit: 10,
    });
    assert.equal(result.provider, "external_http");
    assert.equal(result.matches[0].modelId, "6373049");
    assert.equal(request.url, process.env.MARKETPLACE_IMAGE_SEARCH_URL);
    assert.equal(request.options.headers.authorization, "Bearer test-key");
    assert.equal(request.body.imageHash, "abc123");
  } finally {
    globalThis.fetch = previousFetch;
    restoreEnv("MARKETPLACE_IMAGE_SEARCH_URL", previousUrl);
    restoreEnv("MARKETPLACE_IMAGE_SEARCH_API_KEY", previousKey);
  }
});

test("unconfigured image search does not charge daily quota", async () => {
  const previousUrl = process.env.MARKETPLACE_IMAGE_SEARCH_URL;
  delete process.env.MARKETPLACE_IMAGE_SEARCH_URL;
  const user = await User.create({ email: "image-search@example.test", name: "Image search" });
  let capturedError = null;
  try {
    await searchMarketplaceByImage({
      user,
      body: {
        imageData: "data:image/png;base64,aW1hZ2U=",
        limit: 20,
      },
    }, {
      json() {
        throw new Error("The unconfigured provider must not return a response.");
      },
    }, (error) => {
      capturedError = error;
    });
    assert.equal(capturedError?.status, 503);
    assert.match(capturedError?.message || "", /not configured/);
    assert.equal(await DailyImageSearchQuota.countDocuments({ userId: user._id }), 0);
  } finally {
    restoreEnv("MARKETPLACE_IMAGE_SEARCH_URL", previousUrl);
  }
});
