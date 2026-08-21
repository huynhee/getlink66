import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { convertPreviewImageToJpeg } from "../src/controllers/getlinkController.js";

test("getlink preview downloads are converted to JPEG", async () => {
  const png = await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 4,
      background: { r: 20, g: 120, b: 220, alpha: 0.5 },
    },
  }).png().toBuffer();

  const jpeg = await convertPreviewImageToJpeg(png);
  const metadata = await sharp(jpeg).metadata();

  assert.equal(metadata.format, "jpeg");
  assert.equal(metadata.width, 8);
  assert.equal(metadata.height, 6);
  assert.equal(metadata.hasAlpha, false);
});
