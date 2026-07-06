import MarketplaceCategory from "../models/MarketplaceCategory.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import DownloadSession from "../models/DownloadSession.js";
import ModelDownload from "../models/ModelDownload.js";
import { MARKETPLACE_FILTERS } from "../data/marketplaceFilters.js";
import crypto from "node:crypto";
import zlib from "node:zlib";
import {
  getGoogleDriveFileMetadata,
  listGoogleDriveFolderFiles,
  listGoogleDriveFolderPage,
  readGoogleDriveFileBuffer,
} from "../utils/storageProvider.js";
import { isSafeId, limitedString, rejectUnknownKeys, sanitizeString } from "../utils/validators.js";

const ADMIN_MODEL_PAGE_SIZE = 20;

function slugify(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizePreviewImages(value) {
  function normalizeItem(item) {
    if (typeof item === "string") {
      const [driveFileId, fileName = "", width = "", height = "", size = "", alt = ""] = item
        .split("|")
        .map((part) => part.trim());
      return {
        driveFileId: limitedString(driveFileId, 160),
        fileName: limitedString(fileName, 240),
        width: Math.max(0, Math.round(Number(width || 0))),
        height: Math.max(0, Math.round(Number(height || 0))),
        size: Math.max(0, Number(size || 0)),
        alt: sanitizeString(alt, 120),
      };
    }
    return {
      driveFileId: limitedString(item?.driveFileId || item?.id, 160),
      fileName: limitedString(item?.fileName || item?.name, 240),
      width: Math.max(0, Math.round(Number(item?.width || 0))),
      height: Math.max(0, Math.round(Number(item?.height || 0))),
      size: Math.max(0, Number(item?.size || item?.fileSize || 0)),
      alt: sanitizeString(item?.alt || "", 120),
    };
  }

  if (Array.isArray(value)) {
    return value
      .map(normalizeItem)
      .filter((item) => item.driveFileId)
      .slice(0, 20);
  }
  return String(value || "")
    .split(/\n/)
    .map((line) => normalizeItem(line))
    .filter((item) => item.driveFileId)
    .slice(0, 20);
}

function normalizeCoverImage(value = {}) {
  if (typeof value === "string") {
    const [driveFileId, fileName = "", width = "", height = "", size = "", alt = ""] = value
      .split("|")
      .map((part) => part.trim());
    return {
      driveFileId: limitedString(driveFileId, 160),
      fileName: limitedString(fileName, 240),
      width: Math.max(0, Math.round(Number(width || 0))),
      height: Math.max(0, Math.round(Number(height || 0))),
      size: Math.max(0, Number(size || 0)),
      alt: sanitizeString(alt, 120),
    };
  }
  return {
    driveFileId: limitedString(value?.driveFileId || value?.id, 160),
    fileName: limitedString(value?.fileName || value?.name, 240),
    width: Math.max(0, Math.round(Number(value?.width || 0))),
    height: Math.max(0, Math.round(Number(value?.height || 0))),
    size: Math.max(0, Number(value?.size || value?.fileSize || 0)),
    alt: sanitizeString(value?.alt || "", 120),
  };
}

function normalizeFacetValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/v-ray/g, "vray")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeFacetList(value, maxItems = 24) {
  const items = Array.isArray(value)
    ? value
    : String(value || "").split(/[,\n]/);
  return [...new Set(items.map(normalizeFacetValue).filter(Boolean))].slice(0, maxItems);
}

function normalizeFixedFacetList(value, facetKey, maxItems = 24) {
  const allowed = new Set((MARKETPLACE_FILTERS[facetKey] || []).map((item) => item.value));
  return normalizeFacetList(value, maxItems).filter((item) => allowed.has(item));
}

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeMarketplaceAccessType(value) {
  return String(value || "").trim().toLowerCase() === "free" ? "free" : "member";
}

const REQUIRED_MARKETPLACE_METADATA = [
  { key: "category", label: "Category", isPresent: (model) => Boolean(model.categoryId) },
  { key: "style", label: "Style", isPresent: (model) => Array.isArray(model.styles) && model.styles.length > 0 },
  {
    key: "render",
    label: "Render",
    isPresent: (model) =>
      (Array.isArray(model.renderers) && model.renderers.length > 0) ||
      Boolean(String(model.renderer || "").trim()),
  },
  { key: "form", label: "Form", isPresent: (model) => Array.isArray(model.forms) && model.forms.length > 0 },
  { key: "color", label: "Color", isPresent: (model) => Array.isArray(model.colors) && model.colors.length > 0 },
  { key: "material", label: "Material", isPresent: (model) => Array.isArray(model.materials) && model.materials.length > 0 },
];

function metadataCompleteness(model = {}) {
  const missing = REQUIRED_MARKETPLACE_METADATA
    .filter((field) => !field.isPresent(model))
    .map((field) => field.key);
  return {
    metadataStatus: missing.length ? "incomplete" : "complete",
    metadataMissingFields: missing,
  };
}

function applyMetadataCompleteness(payload, requestedPublish = payload.isPublished) {
  const completeness = metadataCompleteness(payload);
  payload.metadataStatus = completeness.metadataStatus;
  payload.metadataMissingFields = completeness.metadataMissingFields;
  if (requestedPublish === true && completeness.metadataStatus !== "complete") {
    payload.isPublished = false;
  }
  return payload;
}

function extractDriveId(value = "") {
  const raw = String(value || "").trim();
  const match = raw.match(/\/folders\/([^/?#]+)/i) ||
    raw.match(/\/file\/d\/([^/?#]+)/i) ||
    raw.match(/[?&]id=([^&#]+)/i);
  return decodeURIComponent((match?.[1] || raw).trim());
}

function fileExtension(name = "") {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  return match?.[1] || "";
}

function archiveExtension(name = "") {
  const ext = fileExtension(name);
  return ["zip", "rar", "7z"].includes(ext) ? ext : "zip";
}

function normalizedName(name = "") {
  return String(name || "").trim().toLowerCase();
}

function normalizedBaseName(name = "") {
  return normalizedName(name)
    .replace(/\.json\.gz$/, "")
    .replace(/\.[a-z0-9]+$/, "");
}

function naturalCompareName(a, b) {
  return String(a?.name || "").localeCompare(String(b?.name || ""), "en", {
    numeric: true,
    sensitivity: "base",
  });
}

function sourceIdFromFolderName(folderName = "", fallback = "") {
  const value = String(folderName || "").trim();
  const match = value.match(/^(\d{4,})(?:[._\-\s]|$)/) || value.match(/(?:^|[._\-\s])(\d{4,})(?:[._\-\s]|$)/);
  return sanitizeString(match?.[1] || fallback, 80);
}

function titleFromFolderName(folderName = "", sourceModelId = "") {
  let value = String(folderName || "").trim();
  if (sourceModelId) {
    value = value.replace(new RegExp(`^${sourceModelId}[._\\-\\s]*`, "i"), "");
  }
  value = value.replace(/[._\-\s]*[a-f0-9]{10,}$/i, "");
  value = value.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!value || /^[a-f0-9]{8,}$/i.test(value.replace(/\s+/g, ""))) {
    return sourceModelId ? `Model ${sourceModelId}` : String(folderName || "").trim();
  }
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function isDriveFolder(file) {
  return file?.mimeType === "application/vnd.google-apps.folder";
}

function isImageFile(file) {
  const ext = fileExtension(file?.name);
  return String(file?.mimeType || "").startsWith("image/") || ["jpg", "jpeg", "png", "webp"].includes(ext);
}

function isArchiveFile(file) {
  const ext = fileExtension(file?.name);
  const mime = String(file?.mimeType || "").toLowerCase();
  return ["zip", "rar", "7z"].includes(ext) ||
    mime.includes("zip") ||
    mime.includes("rar") ||
    mime.includes("compressed") ||
    mime.includes("7z");
}

function isMetadataFile(file) {
  const name = String(file?.name || "").toLowerCase();
  return name.endsWith(".json") || name.endsWith(".json.gz");
}

function isChecksumFile(file) {
  const name = normalizedName(file?.name);
  return name === "model.sha256" || name === "sha256.txt" || name.endsWith(".sha256");
}

function pickArchiveFile(files = [], sourceModelId = "", folderName = "") {
  const folderBase = normalizedBaseName(folderName);
  const id = normalizedName(sourceModelId);
  return [...files].sort((a, b) => {
    function score(file) {
      const name = normalizedName(file?.name);
      const base = normalizedBaseName(file?.name);
      if (/^model\.(zip|rar|7z)$/.test(name)) return 0;
      if (id && new RegExp(`^${id}\\.(zip|rar|7z)$`).test(name)) return 1;
      if (folderBase && base === folderBase) return 2;
      if (base.includes("model")) return 4;
      return 10;
    }
    const diff = score(a) - score(b);
    if (diff) return diff;
    return Number(b?.size || 0) - Number(a?.size || 0) || naturalCompareName(a, b);
  })[0];
}

function pickMetadataFile(files = [], sourceModelId = "") {
  const id = normalizedName(sourceModelId);
  return [...files].filter(isMetadataFile).sort((a, b) => {
    function score(file) {
      const name = normalizedName(file?.name);
      const base = normalizedBaseName(file?.name);
      if (name === "metadata.json.gz") return 0;
      if (name === "metadata.json") return 1;
      if (id && (name === `${id}.json.gz` || name === `${id}.json`)) return 2;
      if (base.includes("metadata")) return 3;
      return 10;
    }
    return score(a) - score(b) || naturalCompareName(a, b);
  })[0];
}

function pickChecksumFile(files = []) {
  return [...files].filter(isChecksumFile).sort((a, b) => {
    function score(file) {
      const name = normalizedName(file?.name);
      if (name === "model.sha256") return 0;
      if (name === "sha256.txt") return 1;
      return 10;
    }
    return score(a) - score(b) || naturalCompareName(a, b);
  })[0];
}

function firstValue(...values) {
  return values.find((value) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
}

function pathValue(source, path) {
  return String(path || "")
    .split(".")
    .reduce((current, key) => {
      if (current === undefined || current === null) return undefined;
      return current[key];
    }, source);
}

function pickValue(source, paths = []) {
  for (const path of paths) {
    const value = pathValue(source, path);
    if (Array.isArray(value) ? value.length : value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }
  return undefined;
}

function metadataArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      return item?.value || item?.slug || item?.name || item?.title || item?.label || "";
    }).filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value).map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      return item?.value || item?.slug || item?.name || item?.title || item?.label || "";
    }).filter(Boolean);
  }
  return String(value || "").split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

async function readDriveMetadataJson(file) {
  if (!file?.id) return null;
  const buffer = await readGoogleDriveFileBuffer(file.id, {
    fileName: file.name,
    maxBytes: 10 * 1024 * 1024,
  });
  let body = buffer.toString("utf8");
  if (String(file.name || "").toLowerCase().endsWith(".gz")) {
    try {
      body = zlib.gunzipSync(buffer).toString("utf8");
    } catch {
      body = buffer.toString("utf8");
    }
  }
  const parsed = JSON.parse(body);
  return parsed?.model || parsed?.data || parsed;
}

async function readDriveChecksum(file) {
  if (!file?.id) return "";
  const buffer = await readGoogleDriveFileBuffer(file.id, {
    fileName: file.name,
    maxBytes: 64 * 1024,
  });
  return String(buffer.toString("utf8").match(/[a-f0-9]{64}/i)?.[0] || "").toLowerCase();
}

function metadataPayload(rawMetadata = {}, fallback = {}) {
  const sourceModelId = sanitizeString(
    firstValue(
      pickValue(rawMetadata, ["source.modelId", "sourceModelId", "modelId", "id"]),
      fallback.sourceModelId,
    ),
    80,
  );
  const title = sanitizeString(
    firstValue(
      pickValue(rawMetadata, ["title", "name", "modelName", "displayName"]),
      fallback.title,
    ),
    200,
  );
  const sourceSlug = sanitizeString(
    firstValue(
      pickValue(rawMetadata, ["source.slug", "sourceSlug", "slug"]),
      fallback.sourceSlug,
    ),
    160,
  );
  const sourceCategoryId = String(firstValue(
    pickValue(rawMetadata, ["source.categoryId", "sourceCategoryId", "categoryId", "category.slug", "category"]),
    fallback.sourceCategoryId,
  ) || "").trim();
  const accessType = normalizeMarketplaceAccessType(firstValue(
    pickValue(rawMetadata, ["accessType", "access", "tier", "plan"]),
    fallback.accessType,
  ));

  return {
    sourceModelId,
    title,
    sourceSlug,
    sourceCategoryId,
    accessType,
    styles: normalizeFixedFacetList(metadataArray(firstValue(pickValue(rawMetadata, ["styles", "style"]), [])), "style"),
    renderers: normalizeFixedFacetList(metadataArray(firstValue(pickValue(rawMetadata, ["renderers", "renderer", "render"]), [])), "render"),
    forms: normalizeFixedFacetList(metadataArray(firstValue(pickValue(rawMetadata, ["forms", "form", "shape"]), [])), "form"),
    colors: normalizeFixedFacetList(metadataArray(firstValue(pickValue(rawMetadata, ["colors", "color"]), [])), "color"),
    materials: normalizeFixedFacetList(metadataArray(firstValue(pickValue(rawMetadata, ["materials", "material"]), [])), "material"),
    renderer: limitedString(firstValue(pickValue(rawMetadata, ["renderer", "render"]), ""), 80),
    sizeText: limitedString(firstValue(pickValue(rawMetadata, ["sizeText", "size", "fileSizeText"]), ""), 80),
    sha256: String(firstValue(pickValue(rawMetadata, ["sha256", "file.sha256", "checksum"]), ""))
      .trim()
      .toLowerCase()
      .match(/[a-f0-9]{64}/i)?.[0] || "",
  };
}

function driveImageRef(file, alt = "") {
  return {
    driveFileId: limitedString(file?.id, 160),
    fileName: limitedString(file?.name, 240),
    width: Math.max(0, Math.round(Number(file?.imageMediaMetadata?.width || 0))),
    height: Math.max(0, Math.round(Number(file?.imageMediaMetadata?.height || 0))),
    size: Math.max(0, Number(file?.size || 0)),
    alt: sanitizeString(alt, 120),
  };
}

function pickCoverImage(images, sourceModelId = "") {
  const id = normalizedName(sourceModelId);
  return [...images].sort((a, b) => {
    const aName = String(a.name || "").toLowerCase();
    const bName = String(b.name || "").toLowerCase();
    function score(file, name) {
      const base = normalizedBaseName(name);
      const width = Number(file?.imageMediaMetadata?.width || 0);
      if (base === "cover") return 0;
      if (base === "thumb" || base === "thumbnail") return 1;
      if (id && (base === `${id}-cover` || base === `${id}_cover`)) return 2;
      if (base.includes("cover")) return 3;
      if (width > 0 && width <= 640) return 5;
      return 10;
    }
    const diff = score(a, aName) - score(b, bName);
    if (diff) return diff;
    return Number(a.size || 0) - Number(b.size || 0) || naturalCompareName(a, b);
  })[0];
}

function pickPreviewImages(images, cover) {
  const coverId = cover?.id || "";
  return [...images]
    .filter((file) => file.id !== coverId)
    .sort((a, b) => {
      function score(file) {
        const base = normalizedBaseName(file?.name);
        const previewMatch = base.match(/^preview[-_\s]?(\d+)/);
        if (previewMatch) return Number(previewMatch[1]);
        if (base === "preview") return 100;
        if (base.includes("preview")) return 200;
        return 1000;
      }
      return score(a) - score(b) || naturalCompareName(a, b);
    })
    .slice(0, 20);
}

function driveFolderSignature(folder, files = []) {
  const payload = {
    folder: {
      id: folder?.id || "",
      name: folder?.name || "",
      modifiedTime: folder?.modifiedTime || "",
    },
    files: files
      .map((file) => ({
        id: file?.id || "",
        name: file?.name || "",
        mimeType: file?.mimeType || "",
        size: String(file?.size || ""),
        modifiedTime: file?.modifiedTime || "",
      }))
      .sort((a, b) => `${a.name}:${a.id}`.localeCompare(`${b.name}:${b.id}`)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function driveModelLookup({ folderId, folderName, folderSourceModelId, sourceModelId, slug }) {
  const lookup = [
    { driveFolderId: folderId },
    { "source.provider": "drive", "source.modelId": folderId },
    { "source.slug": folderName },
  ];
  const fallbackSlug = slugify(slug || folderName || sourceModelId || folderSourceModelId);
  if (fallbackSlug) lookup.push({ slug: fallbackSlug });
  const ids = [...new Set([sourceModelId, folderSourceModelId].filter(Boolean))];
  ids.forEach((id) => {
    lookup.push({ "source.provider": "3dsky", "source.modelId": id });
    lookup.push({ "source.provider": "catalog", "source.modelId": id });
  });
  return { $or: lookup };
}

async function resolveCategory(sourceCategoryId) {
  const value = String(sourceCategoryId || "").trim();
  if (!value) return { categoryId: null, parentCategoryId: null, categorySourceId: "" };
  const category = await MarketplaceCategory.findOne({
    $or: [
      { sourceCategoryId: value },
      { slug: value.toLowerCase() },
      ...(isSafeId(value) ? [{ _id: value }] : []),
    ],
  });
  if (!category) return { categoryId: null, parentCategoryId: null, categorySourceId: value };
  const hasChildren = await MarketplaceCategory.exists({ parentId: category._id });
  if (hasChildren) {
    return { categoryId: null, parentCategoryId: category._id, categorySourceId: value };
  }
  const parentId = category.parentId || null;
  return { categoryId: category._id, parentCategoryId: parentId, categorySourceId: category.sourceCategoryId };
}

function adminModel(model) {
  const doc = model?.toObject ? model.toObject() : model;
  if (doc?.source?.raw !== undefined) delete doc.source.raw;
  return doc;
}

const marketplaceLegacyUnset = {
  "source.raw": "",
  "source.url": "",
  formats: "",
  format: "",
  version: "",
  polygons: "",
  fileName: "",
  mainMaxFile: "",
  description: "",
  tags: "",
  creditPrice: "",
};

export async function adminListMarketplaceModels(req, res, next) {
  try {
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const search = String(req.query.search || "").trim().slice(0, 120);
    const fileStatus = String(req.query.fileStatus || "all");
    const accessType = String(req.query.accessType || "all");
    const published = String(req.query.published || "all");
    const metadataStatus = String(req.query.metadataStatus || "all");
    const query = {};
    if (["missing", "pending_upload", "ready", "failed"].includes(fileStatus)) query.fileStatus = fileStatus;
    if (accessType === "free") query.accessType = "free";
    if (accessType === "member") query.accessType = "member";
    if (published === "published") query.isPublished = true;
    if (published === "unpublished") query.isPublished = false;
    if (["complete", "incomplete"].includes(metadataStatus)) query.metadataStatus = metadataStatus;
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [{ title: regex }, { slug: regex }, { "source.slug": regex }];
    }
    const total = await MarketplaceModel.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / ADMIN_MODEL_PAGE_SIZE));
    const safePage = Math.min(page, totalPages);
    const models = await MarketplaceModel.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * ADMIN_MODEL_PAGE_SIZE)
      .limit(ADMIN_MODEL_PAGE_SIZE)
      .select("-source.raw")
      .lean();
    res.json({
      models,
      pagination: { page: safePage, pageSize: ADMIN_MODEL_PAGE_SIZE, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminImport3dskyModel(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, [
      "sourceModelId",
      "sourceSlug",
      "sourceCategoryId",
      "title",
      "slug",
      "coverImage",
      "previewImages",
      "styles",
      "renderers",
      "forms",
      "colors",
      "materials",
      "renderer",
      "sizeText",
      "accessType",
      "isPublished",
      "raw",
    ]);
    if (unknownKey) return res.status(400).json({ message: "Invalid model import request" });
    const sourceModelId = sanitizeString(req.body.sourceModelId, 80);
    const title = sanitizeString(req.body.title, 200);
    if (!sourceModelId || !title) {
      return res.status(400).json({ message: "sourceModelId and title are required" });
    }
    const sourceSlug = sanitizeString(req.body.sourceSlug, 160);
    const modelSlug = slugify(req.body.slug || sourceSlug || `${title}-${sourceModelId}`);
    const categoryFields = await resolveCategory(req.body.sourceCategoryId);
    const accessType = normalizeMarketplaceAccessType(req.body.accessType);
    const payload = {
      source: {
        provider: "catalog",
        modelId: sourceModelId,
        slug: sourceSlug,
        categoryId: String(req.body.sourceCategoryId || "").trim(),
        syncedAt: new Date(),
      },
      title,
      slug: modelSlug,
      ...categoryFields,
      styles: normalizeFixedFacetList(req.body.styles, "style"),
      renderers: normalizeFixedFacetList(req.body.renderers || req.body.renderer, "render"),
      forms: normalizeFixedFacetList(req.body.forms, "form"),
      colors: normalizeFixedFacetList(req.body.colors, "color"),
      materials: normalizeFixedFacetList(req.body.materials, "material"),
      renderer: limitedString(req.body.renderer, 80),
      sizeText: limitedString(req.body.sizeText, 80),
      accessType,
      isPublished: Boolean(req.body.isPublished),
    };
    applyMetadataCompleteness(payload, Boolean(req.body.isPublished));
    const model = await MarketplaceModel.findOneAndUpdate(
      { "source.provider": "catalog", "source.modelId": sourceModelId },
      {
        $set: payload,
        $unset: {
          "source.raw": "",
          "source.url": "",
          formats: "",
          format: "",
          version: "",
          polygons: "",
          fileName: "",
          mainMaxFile: "",
          description: "",
          tags: "",
          creditPrice: "",
        },
        $setOnInsert: { fileStatus: "missing" },
      },
      { upsert: true, new: true },
    );
    res.json({ model: adminModel(model) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Model slug or source already exists" });
    next(error);
  }
}

export async function adminUpdateMarketplaceModel(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const allowed = [
      "title",
      "slug",
      "sourceSlug",
      "coverImage",
      "previewImages",
      "styles",
      "renderers",
      "forms",
      "colors",
      "materials",
      "renderer",
      "sizeText",
      "accessType",
      "isPublished",
      "fileStatus",
      "sourceCategoryId",
      "metadataDriveFileId",
      "metadataFileName",
      "metadataSize",
    ];
    const unknownKey = rejectUnknownKeys(req.body, allowed);
    if (unknownKey) return res.status(400).json({ message: "Invalid model update request" });
    const payload = {};
    if (req.body.title !== undefined) payload.title = sanitizeString(req.body.title, 200);
    if (req.body.slug !== undefined) {
      const nextSlug = slugify(req.body.slug);
      if (!nextSlug) return res.status(400).json({ message: "Model slug is required" });
      payload.slug = nextSlug;
    }
    if (req.body.sourceSlug !== undefined) payload["source.slug"] = sanitizeString(req.body.sourceSlug, 160);
    if (req.body.coverImage !== undefined) payload.coverImage = normalizeCoverImage(req.body.coverImage);
    if (req.body.previewImages !== undefined) payload.previewImages = normalizePreviewImages(req.body.previewImages);
    if (req.body.styles !== undefined) payload.styles = normalizeFixedFacetList(req.body.styles, "style");
    if (req.body.renderers !== undefined) payload.renderers = normalizeFixedFacetList(req.body.renderers, "render");
    if (req.body.forms !== undefined) payload.forms = normalizeFixedFacetList(req.body.forms, "form");
    if (req.body.colors !== undefined) payload.colors = normalizeFixedFacetList(req.body.colors, "color");
    if (req.body.materials !== undefined) payload.materials = normalizeFixedFacetList(req.body.materials, "material");
    ["renderer", "sizeText"].forEach((field) => {
      if (req.body[field] !== undefined) payload[field] = limitedString(req.body[field], 80);
    });
    if (req.body.accessType !== undefined) payload.accessType = normalizeMarketplaceAccessType(req.body.accessType);
    if (req.body.isPublished !== undefined) payload.isPublished = Boolean(req.body.isPublished);
    if (["missing", "pending_upload", "ready", "failed"].includes(req.body.fileStatus)) payload.fileStatus = req.body.fileStatus;
    if (req.body.sourceCategoryId !== undefined) Object.assign(payload, await resolveCategory(req.body.sourceCategoryId));
    if (req.body.metadataDriveFileId !== undefined) payload.metadataDriveFileId = limitedString(req.body.metadataDriveFileId, 160);
    if (req.body.metadataFileName !== undefined) payload.metadataFileName = limitedString(req.body.metadataFileName, 240);
    if (req.body.metadataSize !== undefined) payload.metadataSize = Math.max(0, Number(req.body.metadataSize || 0));
    const currentModel = await MarketplaceModel.findById(req.params.id).lean();
    if (!currentModel) return res.status(404).json({ message: "Model not found" });
    const mergedModel = { ...currentModel, ...payload };
    const completeness = metadataCompleteness(mergedModel);
    const requestedPublish = payload.isPublished === undefined ? Boolean(currentModel.isPublished) : payload.isPublished;
    payload.metadataStatus = completeness.metadataStatus;
    payload.metadataMissingFields = completeness.metadataMissingFields;
    if (requestedPublish && completeness.metadataStatus !== "complete") {
      payload.isPublished = false;
    }
    const model = await MarketplaceModel.findByIdAndUpdate(
      req.params.id,
      { $set: payload, $unset: { description: "", tags: "", creditPrice: "" } },
      { new: true },
    );
    if (!model) return res.status(404).json({ message: "Model not found" });
    res.json({ model: adminModel(model) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Model slug or source already exists" });
    next(error);
  }
}

export async function adminAttachMarketplaceFile(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const unknownKey = rejectUnknownKeys(req.body, [
      "storageProvider",
      "storageKey",
      "driveFileId",
      "telegramFileRef",
      "fileName",
      "archiveExt",
      "fileSize",
      "sha256",
      "fileStatus",
    ]);
    if (unknownKey) return res.status(400).json({ message: "Invalid attach file request" });
    const storageProvider = String(req.body.storageProvider || "google_drive").trim();
    if (!["google_drive", "b2", "r2", "local", "telegram"].includes(storageProvider)) {
      return res.status(400).json({ message: "Invalid storage provider" });
    }
    const fileStatus = ["missing", "pending_upload", "ready", "failed"].includes(req.body.fileStatus)
      ? req.body.fileStatus
      : "ready";
    const model = await MarketplaceModel.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          storageProvider,
          storageKey: String(req.body.storageKey || "").trim(),
          driveFileId: String(req.body.driveFileId || "").trim(),
          telegramFileRef: String(req.body.telegramFileRef || "").trim(),
          archiveExt: archiveExtension(req.body.archiveExt || req.body.fileName),
          fileSize: Math.max(0, Number(req.body.fileSize || 0)),
          sha256: String(req.body.sha256 || "").trim().toLowerCase().slice(0, 128),
          fileStatus,
        },
        $unset: { fileName: "", mainMaxFile: "" },
      },
      { new: true },
    );
    if (!model) return res.status(404).json({ message: "Model not found" });
    res.json({ model: adminModel(model) });
  } catch (error) {
    next(error);
  }
}

export async function adminAttachMarketplaceAssets(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const unknownKey = rejectUnknownKeys(req.body, [
      "previewImages",
      "coverImage",
      "coverDriveFileId",
      "coverFileName",
      "coverWidth",
      "coverHeight",
      "coverSize",
      "coverAlt",
      "metadataDriveFileId",
      "metadataFileName",
      "metadataSize",
    ]);
    if (unknownKey) return res.status(400).json({ message: "Invalid attach assets request" });
    const payload = {};
    if (req.body.previewImages !== undefined) {
      payload.previewImages = normalizePreviewImages(req.body.previewImages);
    }
    if (
      req.body.coverImage !== undefined ||
      req.body.coverDriveFileId !== undefined ||
      req.body.coverFileName !== undefined ||
      req.body.coverWidth !== undefined ||
      req.body.coverHeight !== undefined ||
      req.body.coverSize !== undefined ||
      req.body.coverAlt !== undefined
    ) {
      payload.coverImage = normalizeCoverImage(req.body.coverImage ?? {
        driveFileId: req.body.coverDriveFileId,
        fileName: req.body.coverFileName,
        width: req.body.coverWidth,
        height: req.body.coverHeight,
        size: req.body.coverSize,
        alt: req.body.coverAlt,
      });
    }
    if (req.body.metadataDriveFileId !== undefined) {
      payload.metadataDriveFileId = limitedString(req.body.metadataDriveFileId, 160);
    }
    if (req.body.metadataFileName !== undefined) {
      payload.metadataFileName = limitedString(req.body.metadataFileName, 240);
    }
    if (req.body.metadataSize !== undefined) {
      payload.metadataSize = Math.max(0, Number(req.body.metadataSize || 0));
    }
    if (!Object.keys(payload).length) {
      return res.status(400).json({ message: "No marketplace assets provided" });
    }
    const model = await MarketplaceModel.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
    if (!model) return res.status(404).json({ message: "Model not found" });
    res.json({ model: adminModel(model) });
  } catch (error) {
    next(error);
  }
}

export async function adminRescanMarketplaceModelDriveFolder(req, res, next) {
  try {
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const existing = await MarketplaceModel.findById(req.params.id).select("-source.raw").lean();
    if (!existing) return res.status(404).json({ message: "Model not found" });
    if (!existing.driveFolderId) {
      return res.status(400).json({ message: "Model does not have a Drive folder id" });
    }

    const now = new Date();
    const folderMetadata = await getGoogleDriveFileMetadata(existing.driveFolderId, {
      fields: "id,name,mimeType,modifiedTime",
    });
    const folder = {
      id: folderMetadata.id || existing.driveFolderId,
      name: folderMetadata.name || existing.driveFolderName || existing.source?.slug || existing.slug || String(existing._id),
      modifiedTime: folderMetadata.modifiedTime || "",
    };
    const folderName = sanitizeString(folder.name, 200);
    const folderSourceModelId = sourceIdFromFolderName(
      folderName,
      existing.source?.modelId || existing.slug || String(existing._id),
    );
    const files = await listGoogleDriveFolderFiles(folder.id);
    const driveSignature = driveFolderSignature(folder, files);
    const images = files.filter(isImageFile);
    const archives = files.filter(isArchiveFile);
    const metadata = pickMetadataFile(files, folderSourceModelId);
    const checksumFile = pickChecksumFile(files);
    let rawMetadata = null;
    let metadataError = "";

    if (metadata) {
      try {
        rawMetadata = await readDriveMetadataJson(metadata);
      } catch (error) {
        metadataError = error?.message || "metadata_parse_failed";
      }
    }

    const meta = metadataPayload(rawMetadata || {}, {
      sourceModelId: folderSourceModelId,
      sourceSlug: existing.source?.slug || folderName,
      sourceCategoryId: existing.categorySourceId || existing.source?.categoryId || "",
      title: existing.title || titleFromFolderName(folderName, folderSourceModelId),
      accessType: existing.accessType || "member",
    });
    const sourceModelId = meta.sourceModelId || folderSourceModelId;
    const title = meta.title || existing.title || titleFromFolderName(folderName, sourceModelId);
    const archive = pickArchiveFile(archives, sourceModelId, folderName);
    const cover = pickCoverImage(images, sourceModelId);
    const previewImages = pickPreviewImages(images, cover).map((file) => driveImageRef(file, title));
    let sha256FromFile = "";

    if (checksumFile) {
      try {
        sha256FromFile = await readDriveChecksum(checksumFile);
      } catch {
        sha256FromFile = "";
      }
    }

    const categoryFields = await resolveCategory(meta.sourceCategoryId || existing.categorySourceId || existing.source?.categoryId);
    const payload = {
      source: {
        provider: "drive",
        modelId: folder.id,
        slug: meta.sourceSlug || existing.source?.slug || folderName,
        categoryId: meta.sourceCategoryId || existing.categorySourceId || existing.source?.categoryId || "",
        syncedAt: now,
      },
      title,
      slug: existing.slug || slugify(meta.sourceSlug || title || sourceModelId),
      ...categoryFields,
      driveFolderId: folder.id,
      driveFolderName: folderName,
      driveSignature,
      lastDriveScanAt: now,
      lastDriveChangeAt: existing.driveSignature !== driveSignature ? now : existing.lastDriveChangeAt,
      styles: meta.styles?.length ? meta.styles : existing.styles || [],
      renderers: meta.renderers?.length ? meta.renderers : existing.renderers || [],
      forms: meta.forms?.length ? meta.forms : existing.forms || [],
      colors: meta.colors?.length ? meta.colors : existing.colors || [],
      materials: meta.materials?.length ? meta.materials : existing.materials || [],
      renderer: meta.renderer || existing.renderer || "",
      sizeText: meta.sizeText || existing.sizeText || "",
      accessType: meta.accessType || existing.accessType || "member",
      isPublished: Boolean(existing.isPublished),
      fileStatus: archive ? "ready" : "missing",
      storageProvider: archive ? "google_drive" : "",
      driveFileId: archive?.id || "",
      archiveExt: archiveExtension(archive?.name),
      fileSize: Math.max(0, Number(archive?.size || 0)),
      coverImage: cover ? driveImageRef(cover, title) : {},
      previewImages,
      sha256: meta.sha256 || sha256FromFile || existing.sha256 || "",
      metadataDriveFileId: metadata?.id || existing.metadataDriveFileId || "",
      metadataFileName: limitedString(metadata?.name || existing.metadataFileName || "", 240),
      metadataSize: Math.max(0, Number(metadata?.size || existing.metadataSize || 0)),
    };
    applyMetadataCompleteness(payload, Boolean(existing.isPublished));

    const model = await MarketplaceModel.findByIdAndUpdate(
      existing._id,
      {
        $set: payload,
        $unset: marketplaceLegacyUnset,
      },
      { new: true },
    );
    res.json({
      model: adminModel(model),
      scannedFiles: files.length,
      previewCount: previewImages.length,
      changed: existing.driveSignature !== driveSignature,
      metadataError,
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Model slug or source already exists" });
    next(error);
  }
}

export async function adminMarketplaceStats(_req, res, next) {
  try {
    const [models, ready, missing, sessions, downloads] = await Promise.all([
      MarketplaceModel.countDocuments({}),
      MarketplaceModel.countDocuments({ fileStatus: "ready" }),
      MarketplaceModel.countDocuments({ fileStatus: { $ne: "ready" } }),
      DownloadSession.countDocuments({}),
      ModelDownload.countDocuments({}),
    ]);
    const [completeMetadata, incompleteMetadata, published] = await Promise.all([
      MarketplaceModel.countDocuments({ metadataStatus: "complete" }),
      MarketplaceModel.countDocuments({ metadataStatus: "incomplete" }),
      MarketplaceModel.countDocuments({ isPublished: true }),
    ]);
    res.json({
      stats: {
        models,
        ready,
        missing,
        sessions,
        downloads,
        completeMetadata,
        incompleteMetadata,
        published,
        draft: Math.max(0, models - published),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminCleanupMarketplaceRaw(_req, res, next) {
  try {
    const docs = await MarketplaceModel.find({})
      .select("_id source archiveExt")
      .lean();
    let normalizedSources = 0;
    for (const doc of docs) {
      const provider = doc.source?.provider;
      const modelId = String(doc.source?.modelId || "");
      if (provider === "3dsky" || /^\d{4,}$/.test(modelId)) {
        await MarketplaceModel.findByIdAndUpdate(doc._id, {
          $set: {
            "source.provider": "drive",
            "source.modelId": String(doc._id),
          },
        });
        normalizedSources += 1;
      }
    }
    const result = await MarketplaceModel.updateMany(
      {},
      {
        $unset: {
          "source.raw": "",
          "source.url": "",
          formats: "",
          format: "",
          version: "",
          polygons: "",
          fileName: "",
          mainMaxFile: "",
          description: "",
          tags: "",
          creditPrice: "",
        },
      },
    );
    const metadataDocs = await MarketplaceModel.find({})
      .select("_id categoryId styles renderers renderer forms colors materials isPublished metadataStatus metadataMissingFields")
      .lean();
    let normalizedMetadata = 0;
    let unpublishedIncomplete = 0;
    for (const doc of metadataDocs) {
      const completeness = metadataCompleteness(doc);
      const update = {
        metadataStatus: completeness.metadataStatus,
        metadataMissingFields: completeness.metadataMissingFields,
      };
      if (doc.isPublished && completeness.metadataStatus !== "complete") {
        update.isPublished = false;
        unpublishedIncomplete += 1;
      }
      await MarketplaceModel.findByIdAndUpdate(doc._id, { $set: update });
      normalizedMetadata += 1;
    }
    res.json({
      matched: Number(result.matchedCount || 0),
      modified: Number(result.modifiedCount || 0),
      normalizedSources,
      normalizedMetadata,
      unpublishedIncomplete,
    });
  } catch (error) {
    next(error);
  }
}

export async function adminImportDriveFolderModels(req, res, next) {
  try {
    const unknownKey = rejectUnknownKeys(req.body, [
      "rootFolderId",
      "rootFolderUrl",
      "pageToken",
      "limit",
      "accessType",
      "isPublished",
    ]);
    if (unknownKey) return res.status(400).json({ message: "Invalid Drive import request" });

    const rootFolderId = extractDriveId(req.body.rootFolderId || req.body.rootFolderUrl);
    if (!rootFolderId) return res.status(400).json({ message: "Google Drive models folder ID is required" });
    const pageToken = limitedString(req.body.pageToken, 500);
    const defaultAccessType = normalizeMarketplaceAccessType(req.body.accessType);
    const isPublished = normalizeBoolean(req.body.isPublished, true);
    const limit = Math.min(200, Math.max(1, Number(req.body.limit || 20)));

    const page = await listGoogleDriveFolderPage(rootFolderId, { pageToken, pageSize: limit });
    const modelFolders = page.files.filter(isDriveFolder);
    const nextPageToken = page.nextPageToken || "";
    const imported = [];
    const skipped = [];
    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;

    for (const folder of modelFolders) {
      const now = new Date();
      const folderName = sanitizeString(folder.name, 200);
      const folderSourceModelId = sourceIdFromFolderName(folderName, folder.id);
      const files = await listGoogleDriveFolderFiles(folder.id);
      const driveSignature = driveFolderSignature(folder, files);
      let existing = await MarketplaceModel.findOne(driveModelLookup({
        folderId: folder.id,
        folderName,
        folderSourceModelId,
      }))
        .select("_id slug title driveSignature fileStatus archiveExt coverImage previewImages metadataStatus metadataMissingFields metadataFileName")
        .lean();
      if (existing?.driveSignature && existing.driveSignature === driveSignature) {
        const model = await MarketplaceModel.findByIdAndUpdate(
          existing._id,
          {
            $set: {
              driveFolderId: folder.id,
              driveFolderName: folderName,
              lastDriveScanAt: now,
              "source.provider": "drive",
              "source.modelId": folder.id,
              "source.syncedAt": now,
            },
          },
          { new: true },
        );
        unchangedCount += 1;
        imported.push({
          id: model._id,
          action: "unchanged",
          title: model.title,
          catalogKey: model.slug,
          fileStatus: model.fileStatus,
          archiveExt: model.archiveExt || "",
          coverFileName: model.coverImage?.fileName || "",
          previewCount: model.previewImages?.length || 0,
          metadataStatus: model.metadataStatus || "incomplete",
          missingFields: model.metadataMissingFields || [],
          metadataFileName: model.metadataFileName || "",
          metadataError: "",
        });
        continue;
      }
      const images = files.filter(isImageFile);
      const archives = files.filter(isArchiveFile);
      const metadata = pickMetadataFile(files, folderSourceModelId);
      const checksumFile = pickChecksumFile(files);
      let rawMetadata = null;
      let metadataError = "";
      if (metadata) {
        try {
          rawMetadata = await readDriveMetadataJson(metadata);
        } catch (error) {
          metadataError = error?.message || "metadata_parse_failed";
        }
      }
      const meta = metadataPayload(rawMetadata || {}, {
        sourceModelId: folderSourceModelId,
        sourceSlug: folderName,
        title: titleFromFolderName(folderName, folderSourceModelId),
        accessType: defaultAccessType,
      });
      const sourceModelId = meta.sourceModelId || folderSourceModelId;
      if (!sourceModelId) {
        skipped.push({ folderId: folder.id, folderName, reason: "missing_source_model_id" });
        continue;
      }

      let sha256FromFile = "";
      if (checksumFile) {
        try {
          sha256FromFile = await readDriveChecksum(checksumFile);
        } catch {
          sha256FromFile = "";
        }
      }
      const archive = pickArchiveFile(archives, sourceModelId, folderName);
      const cover = pickCoverImage(images, sourceModelId);
      const title = meta.title || folderName;
      const previewImages = pickPreviewImages(images, cover).map((file) => driveImageRef(file, title));
      if (!existing) {
        existing = await MarketplaceModel.findOne(driveModelLookup({
          folderId: folder.id,
          folderName,
          folderSourceModelId,
          sourceModelId,
          slug: meta.sourceSlug || title,
        }))
          .select("_id slug driveSignature")
          .lean();
      }
      const action = existing?._id ? "updated" : "created";
      const categoryFields = await resolveCategory(meta.sourceCategoryId);
      const payload = {
        source: {
          provider: "drive",
          modelId: folder.id,
          slug: meta.sourceSlug || folderName,
          categoryId: meta.sourceCategoryId || "",
          syncedAt: now,
        },
        title,
        slug: existing?.slug || slugify(meta.sourceSlug || title || sourceModelId),
        ...categoryFields,
        driveFolderId: folder.id,
        driveFolderName: folderName,
        driveSignature,
        lastDriveScanAt: now,
        lastDriveChangeAt: action === "created" || existing?.driveSignature !== driveSignature
          ? now
          : existing?.lastDriveChangeAt,
        styles: meta.styles || [],
        renderers: meta.renderers || [],
        forms: meta.forms || [],
        colors: meta.colors || [],
        materials: meta.materials || [],
        renderer: meta.renderer || "",
        sizeText: meta.sizeText || "",
        accessType: meta.accessType || defaultAccessType,
        isPublished,
        fileStatus: archive ? "ready" : "missing",
        storageProvider: archive ? "google_drive" : "",
        driveFileId: archive?.id || "",
        archiveExt: archiveExtension(archive?.name),
        fileSize: Math.max(0, Number(archive?.size || 0)),
        coverImage: cover ? driveImageRef(cover, title) : {},
        previewImages,
        sha256: meta.sha256 || sha256FromFile,
        metadataDriveFileId: metadata?.id || "",
        metadataFileName: limitedString(metadata?.name || "", 240),
        metadataSize: Math.max(0, Number(metadata?.size || 0)),
      };
      applyMetadataCompleteness(payload, isPublished);
      const update = {
        $set: payload,
        $unset: {
          "source.raw": "",
          "source.url": "",
          formats: "",
          format: "",
          version: "",
          polygons: "",
          fileName: "",
          mainMaxFile: "",
          description: "",
          tags: "",
          creditPrice: "",
        },
      };
      const model = existing?._id
        ? await MarketplaceModel.findByIdAndUpdate(existing._id, update, { new: true })
        : await MarketplaceModel.findOneAndUpdate(
          { "source.provider": "drive", "source.modelId": folder.id },
          update,
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
      if (action === "created") createdCount += 1;
      else updatedCount += 1;
      imported.push({
        id: model._id,
        action,
        title: model.title,
        catalogKey: model.slug,
        fileStatus: model.fileStatus,
        archiveExt: model.archiveExt || "",
        coverFileName: model.coverImage?.fileName || "",
        previewCount: model.previewImages?.length || 0,
        metadataStatus: model.metadataStatus || "incomplete",
        missingFields: model.metadataMissingFields || [],
        metadataFileName: model.metadataFileName || "",
        metadataError,
      });
    }

    res.json({
      rootFolderId,
      nextPageToken,
      hasMore: Boolean(nextPageToken),
      scannedFolders: modelFolders.length,
      importedCount: imported.length,
      createdCount,
      updatedCount,
      unchangedCount,
      skipped,
      imported,
    });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Model slug or source already exists" });
    next(error);
  }
}

export async function adminListMarketplaceDownloads(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const clientType = String(req.query.clientType || "all");
    const accessTier = String(req.query.accessTier || "all");
    const query = {};
    if (["web", "plugin"].includes(clientType)) query.clientType = clientType;
    if (["guest", "free", "member", "admin"].includes(accessTier)) query.accessTier = accessTier;
    const total = await ModelDownload.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const downloads = await ModelDownload.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .populate("modelId", "title slug accessType fileStatus source")
      .populate("userId", "name email avatar credit role")
      .lean();
    res.json({
      downloads,
      pagination: { page: safePage, pageSize, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminListMarketplaceDownloadSessions(req, res, next) {
  try {
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const status = String(req.query.status || "all");
    const clientType = String(req.query.clientType || "all");
    const query = {};
    if (["active", "used", "expired", "revoked"].includes(status)) query.status = status;
    if (["web", "plugin"].includes(clientType)) query.clientType = clientType;
    const total = await DownloadSession.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const sessions = await DownloadSession.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .select("-tokenHash")
      .populate("modelId", "title slug accessType fileStatus source")
      .populate("userId", "name email avatar credit role")
      .lean();
    res.json({
      sessions,
      pagination: { page: safePage, pageSize, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
}
