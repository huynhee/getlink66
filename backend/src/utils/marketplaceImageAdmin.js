const IMAGE_TYPES = {
  "image/jpeg": { extension: "jpg", signatures: [[0xff, 0xd8, 0xff]] },
  "image/jpg": { extension: "jpg", signatures: [[0xff, 0xd8, 0xff]] },
  "image/png": { extension: "png", signatures: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
};

export const MARKETPLACE_ADMIN_IMAGE_MAX_BYTES = 15 * 1024 * 1024;
export const MARKETPLACE_ADMIN_PREVIEW_LIMIT = 20;

function matchesSignature(buffer, signature) {
  return signature.every((byte, index) => buffer[index] === byte);
}

export function validateMarketplaceImageUpload(buffer, contentType = "") {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    const error = new Error("Image file is required.");
    error.status = 400;
    error.code = "MARKETPLACE_IMAGE_REQUIRED";
    throw error;
  }
  if (buffer.length > MARKETPLACE_ADMIN_IMAGE_MAX_BYTES) {
    const error = new Error("Image must not exceed 15 MB.");
    error.status = 413;
    error.code = "MARKETPLACE_IMAGE_TOO_LARGE";
    throw error;
  }
  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  const definition = IMAGE_TYPES[normalizedType];
  if (!definition || !definition.signatures.some((signature) => matchesSignature(buffer, signature))) {
    const error = new Error("Only valid JPG, JPEG or PNG images are supported.");
    error.status = 415;
    error.code = "MARKETPLACE_IMAGE_FORMAT_UNSUPPORTED";
    throw error;
  }
  return { contentType: normalizedType, extension: definition.extension, size: buffer.length };
}

export function nextMarketplaceImageName(kind, extension, existingImages = []) {
  const safeExtension = extension === "png" ? "png" : "jpg";
  if (kind === "cover") return `cover.${safeExtension}`;
  const used = new Set((existingImages || []).map((image) => String(image?.fileName || "").toLowerCase()));
  for (let index = 1; index <= MARKETPLACE_ADMIN_PREVIEW_LIMIT; index += 1) {
    const stem = `preview-${String(index).padStart(2, "0")}`;
    if (!["jpg", "jpeg", "png"].some((ext) => used.has(`${stem}.${ext}`))) {
      return `${stem}.${safeExtension}`;
    }
  }
  const error = new Error(`A marketplace asset can contain at most ${MARKETPLACE_ADMIN_PREVIEW_LIMIT} preview images.`);
  error.status = 409;
  error.code = "MARKETPLACE_PREVIEW_LIMIT_REACHED";
  throw error;
}

export function marketplacePreviewRenamePlan(images = [], orderedFileIds = []) {
  const byId = new Map((images || []).map((image) => [String(image?.driveFileId || ""), image]));
  const normalizedOrder = [...new Set((orderedFileIds || []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (normalizedOrder.length !== byId.size || normalizedOrder.some((fileId) => !byId.has(fileId))) {
    const error = new Error("Preview order must contain every current preview exactly once.");
    error.status = 400;
    error.code = "MARKETPLACE_PREVIEW_ORDER_INVALID";
    throw error;
  }
  return normalizedOrder.map((fileId, index) => {
    const image = byId.get(fileId);
    const extension = String(image.fileName || "").toLowerCase().match(/\.(jpe?g|png)$/)?.[1] || "jpg";
    return {
      fileId,
      originalName: String(image.fileName || "").trim(),
      temporaryName: `.reorder-${Date.now()}-${index + 1}-${fileId.slice(-8)}.${extension}`,
      finalName: `preview-${String(index + 1).padStart(2, "0")}.${extension === "jpeg" ? "jpg" : extension}`,
    };
  });
}
