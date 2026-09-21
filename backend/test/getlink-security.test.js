import test from "node:test";
import assert from "node:assert/strict";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.PUBLIC_BASE_URL = "http://localhost:5000";

const { default: Getlink } = await import("../src/models/Getlink.js");
const {
  getlinkHistory,
  hasUsablePreviewSource,
  resolvePreviewImageUrl,
} = await import("../src/controllers/getlinkController.js");
const { request3D66File } = await import("../src/utils/3d66Service.js");

test("history response does not expose upstream or resolved URLs", async () => {
  const user = { _id: "audit-user-123" };
  await Getlink.create({
    userId: user._id,
    productId: "AUDIT123456",
    fileUrl: "https://download.3d66.com/audit.zip",
    sourceUrl: "https://3d.3d66.com/item?sof=AUDIT123456",
    resolvedSourceUrl:
      "https://3d.3d66.com/item?sof=AUDIT123456&sign=internal-marker",
  });

  let payload;
  await getlinkHistory(
    { user, protocol: "http", get: () => "localhost:5000" },
    { json(value) { payload = JSON.parse(JSON.stringify(value)); } },
    (error) => {
      throw error;
    },
  );

  const item = payload.history[0];
  assert.equal(Object.hasOwn(item, "fileUrl"), false);
  assert.equal(Object.hasOwn(item, "sourceUrl"), false);
  assert.equal(Object.hasOwn(item, "resolvedSourceUrl"), false);
});

test("preview images reject non-3D66 hosts and unsafe protocols", () => {
  assert.throws(
    () => resolvePreviewImageUrl("http://127.0.0.1/internal"),
    /not allowed/,
  );
  assert.throws(
    () => resolvePreviewImageUrl("https://example.com/image.jpg"),
    /not allowed/,
  );
  assert.equal(
    resolvePreviewImageUrl("https://respic.3d66.com/image.jpg"),
    "https://respic.3d66.com/image.jpg",
  );
});

test("preview cache rejects its own proxy URL and accepts upstream images", () => {
  assert.equal(hasUsablePreviewSource("https://respic.3d66.com/image.jpg"), true);
  assert.equal(hasUsablePreviewSource("https://3dipl.org/api/plugin/getlink/preview-cache/123"), false);
  assert.equal(hasUsablePreviewSource("/api/getlink/preview-cache/123"), false);
  assert.equal(hasUsablePreviewSource(""), false);
  assert.equal(hasUsablePreviewSource(undefined), false);
});

test("file proxy rejects a non-3D66 download host before fetching", async () => {
  const cookie = "PHPSESSID=a; login_token=b; login_sign=c";
  await assert.rejects(
    request3D66File("https://example.com/file.zip", cookie),
    /Only 3d66.com download links are supported/,
  );
});
