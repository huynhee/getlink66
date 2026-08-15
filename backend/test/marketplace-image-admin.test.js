import assert from "node:assert/strict";
import test from "node:test";
import {
  marketplacePreviewRenamePlan,
  nextMarketplaceImageName,
  validateMarketplaceImageUpload,
} from "../src/utils/marketplaceImageAdmin.js";

test("admin image upload validates content signatures instead of trusting MIME alone", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.deepEqual(validateMarketplaceImageUpload(jpeg, "image/jpeg"), {
    contentType: "image/jpeg",
    extension: "jpg",
    size: jpeg.length,
  });
  assert.equal(validateMarketplaceImageUpload(png, "image/png").extension, "png");
  assert.throws(
    () => validateMarketplaceImageUpload(Buffer.from("not-an-image"), "image/jpeg"),
    (error) => error.code === "MARKETPLACE_IMAGE_FORMAT_UNSUPPORTED" && error.status === 415,
  );
});

test("preview upload names fill the first available stable slot", () => {
  const images = [
    { fileName: "preview-01.jpg" },
    { fileName: "preview-03.png" },
  ];
  assert.equal(nextMarketplaceImageName("preview", "jpg", images), "preview-02.jpg");
  assert.equal(nextMarketplaceImageName("cover", "png", images), "cover.png");
});

test("preview reorder requires every current image and produces deterministic names", () => {
  const images = [
    { driveFileId: "file-a", fileName: "preview-01.jpg" },
    { driveFileId: "file-b", fileName: "preview-02.png" },
  ];
  const plan = marketplacePreviewRenamePlan(images, ["file-b", "file-a"]);
  assert.deepEqual(plan.map(({ fileId, finalName }) => ({ fileId, finalName })), [
    { fileId: "file-b", finalName: "preview-01.png" },
    { fileId: "file-a", finalName: "preview-02.jpg" },
  ]);
  assert.throws(
    () => marketplacePreviewRenamePlan(images, ["file-a"]),
    (error) => error.code === "MARKETPLACE_PREVIEW_ORDER_INVALID",
  );
});
