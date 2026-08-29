import MarketplaceModel from "../models/MarketplaceModel.js";
import MarketplaceDriveSyncState from "../models/MarketplaceDriveSyncState.js";
import DownloadSession from "../models/DownloadSession.js";
import ModelDownload from "../models/ModelDownload.js";
import zlib from "node:zlib";
import {
  createGoogleDriveFile,
  getGoogleDriveFileMetadata,
  openGoogleDriveFileStream,
  readGoogleDriveFileBuffer,
  renameGoogleDriveFile,
  setGoogleDriveFileTrashed,
  updateGoogleDriveFileContent,
} from "../utils/storageProvider.js";
import {
  inspectMarketplaceModelMetadata,
  syncMarketplaceDriveFolder,
  writeMarketplaceModelMetadata,
} from "../utils/marketplaceDriveService.js";
import { metadataFromMarketplaceModel } from "../utils/marketplaceMetadata.js";
import { isSafeId, limitedString, rejectUnknownKeys, sanitizeString } from "../utils/validators.js";
import { marketplaceAssetTypeFilter, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { hydrateAtlasUserField } from "../utils/crossDatabaseHydration.js";
import {
  marketplaceActiveDeletionQuery,
  marketplaceTrashDeletionQuery,
  isMarketplaceAssetDeleted,
  permanentlyDeleteMarketplaceAsset,
  restoreMarketplaceAsset,
  trashMarketplaceAsset,
} from "../utils/marketplaceDeletionService.js";
import { openMarketplaceCoverCache } from "../utils/marketplaceCoverCache.js";
import MarketplaceReport from "../models/MarketplaceReport.js";
import {
  marketplaceReportCountsForAssets,
  marketplaceReportStats,
} from "./marketplaceReportController.js";
import { scanMarketplaceDriveFolderBatch } from "../utils/marketplaceDriveReconcileService.js";
import {
  MARKETPLACE_ADMIN_PREVIEW_LIMIT,
  marketplacePreviewRenamePlan,
  nextMarketplaceImageName,
  validateMarketplaceImageUpload,
} from "../utils/marketplaceImageAdmin.js";

const ADMIN_MODEL_PAGE_SIZE = 20;

function adminAssetType(req) {
  return normalizeAssetType(req?.marketplaceAssetType || req?.query?.assetType || "model");
}

function driveRootEnv(assetType) {
  return normalizeAssetType(assetType) === "scene" ? "SCENES_DRIVE_ROOT_FOLDER_ID" : "MARKETPLACE_DRIVE_ROOT_FOLDER_ID";
}

function driveBackupEnv(assetType) {
  return normalizeAssetType(assetType) === "scene" ? "SCENES_DRIVE_BACKUP_FOLDER_ID" : "MARKETPLACE_DRIVE_BACKUP_FOLDER_ID";
}

function assetNoun(assetType) {
  return normalizeAssetType(assetType) === "scene" ? "Scene" : "Model";
}

function assertMarketplaceAssetEditable(model) {
  if (!isMarketplaceAssetDeleted(model)) return;
  const error = new Error("Restore this marketplace asset before editing or syncing it.");
  error.status = 409;
  error.code = "MARKETPLACE_ASSET_DELETED";
  throw error;
}

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

function normalizeBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function normalizeMarketplaceAccessType(value) {
  return String(value || "").trim().toLowerCase() === "free" ? "free" : "member";
}

const REQUIRED_MARKETPLACE_METADATA = [
  { key: "category", label: "Category", isPresent: (model) => Boolean(model.categorySourceId) },
];

const OPTIONAL_METADATA_BLOCKERS = new Set([
  "renderer",
  "styles",
  "renderers",
  "forms",
  "colors",
  "materials",
  "platforms",
]);

function requiredPublicationBlockers(model = {}) {
  return [...new Set((model.publicationBlockers || [])
    .map((value) => String(value || "").trim())
    .filter((value) => value && !OPTIONAL_METADATA_BLOCKERS.has(value)))];
}

function metadataCompleteness(model = {}) {
  const missing = REQUIRED_MARKETPLACE_METADATA
    .filter((field) => !field.isPresent(model))
    .map((field) => field.key);
  return {
    metadataStatus: missing.length ? "incomplete" : "complete",
    metadataMissingFields: missing,
  };
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

function adminModel(model) {
  const doc = model?.toObject ? model.toObject() : model;
  if (doc?.source?.raw !== undefined) delete doc.source.raw;
  return doc;
}

async function assertMarketplaceMigrationUnlocked(assetType = "model") {
  const rootFolderId = extractDriveId(process.env[driveRootEnv(assetType)]);
  if (!rootFolderId) return;
  const state = await MarketplaceDriveSyncState.findOne({ rootFolderId }).select("migrationStatus").lean();
  if (!["running", "error"].includes(state?.migrationStatus)) return;
  const error = new Error("Marketplace metadata migration is active. Metadata upload and Drive sync are locked.");
  error.status = 423;
  error.code = "MARKETPLACE_MIGRATION_LOCKED";
  throw error;
}

export async function adminListMarketplaceModels(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    const requestedPage = Number(req.query.page || 1);
    const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
    const search = String(req.query.search || "").trim().slice(0, 120);
    const fileStatus = String(req.query.fileStatus || "all");
    const accessType = String(req.query.accessType || "all");
    const published = String(req.query.published || "all");
    const metadataStatus = String(req.query.metadataStatus || "all");
    const deleted = String(req.query.deleted || "active").trim().toLowerCase();
    const reportedOnly = normalizeBoolean(req.query.reportedOnly, false);
    const query = { assetType };
    if (deleted === "trashed") query.$and = [marketplaceTrashDeletionQuery()];
    else if (deleted !== "all") query.$and = [marketplaceActiveDeletionQuery()];
    if (["missing", "pending_upload", "ready", "failed"].includes(fileStatus)) query.fileStatus = fileStatus;
    if (accessType === "free") query.accessType = "free";
    if (accessType === "member") query.accessType = "member";
    if (published === "published") query.isPublished = true;
    if (published === "unpublished") query.isPublished = false;
    if (["complete", "incomplete"].includes(metadataStatus)) query.metadataStatus = metadataStatus;
    if (reportedOnly) {
      const reportedModelIds = await MarketplaceReport.distinct("modelId", {
        assetType,
        isActive: true,
      });
      query._id = { $in: reportedModelIds };
    }
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      query.$or = [
        { title: regex },
        { slug: regex },
        { "source.slug": regex },
        { "source.assetId": regex },
        { "source.modelId": regex },
        { metadataSourceModelId: regex },
        { driveFolderName: regex },
      ];
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
    const reportCounts = await marketplaceReportCountsForAssets(models);
    res.json({
      assetType,
      deleted,
      models: models.map((model) => ({
        ...model,
        openReportCount: Number(reportCounts.get(String(model._id)) || 0),
      })),
      pagination: { page: safePage, pageSize: ADMIN_MODEL_PAGE_SIZE, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminImport3dskyModel(_req, res) {
  return res.status(410).json({
    message: "Direct Mongo metadata import is disabled. Upload the Drive folder and call drive/sync-folder.",
    code: "DRIVE_CANONICAL_SOURCE_REQUIRED",
  });
}

export async function adminUpdateMarketplaceModel(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const allowed = ["slug", "isPublished", "desiredPublished"];
    const unknownKey = rejectUnknownKeys(req.body, allowed);
    if (unknownKey) return res.status(400).json({ message: "Invalid model update request" });
    const payload = {};
    if (req.body.slug !== undefined) {
      const nextSlug = slugify(req.body.slug);
      if (!nextSlug) return res.status(400).json({ message: "Model slug is required" });
      payload.slug = nextSlug;
    }
    const currentModel = await MarketplaceModel.findById(req.params.id).lean();
    if (!currentModel || normalizeAssetType(currentModel.assetType) !== assetType) return res.status(404).json({ message: `${assetNoun(assetType)} not found` });
    assertMarketplaceAssetEditable(currentModel);
    const requestedPublish = req.body.desiredPublished === undefined
      ? req.body.isPublished === undefined ? Boolean(currentModel.desiredPublished ?? currentModel.isPublished) : Boolean(req.body.isPublished)
      : Boolean(req.body.desiredPublished);
    const completeness = metadataCompleteness(currentModel);
    const blockers = requiredPublicationBlockers(currentModel);
    payload.desiredPublished = requestedPublish;
    payload.metadataStatus = completeness.metadataStatus;
    payload.metadataMissingFields = completeness.metadataMissingFields;
    payload.publicationBlockers = blockers;
    payload.isPublished = requestedPublish &&
      completeness.metadataStatus === "complete" &&
      currentModel.fileStatus === "ready" &&
      blockers.length === 0;
    payload.discoveryStatus = "pending";
    payload.searchStatus = "pending";
    payload.searchError = "";
    payload.discoveryError = "";
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

async function assertDriveFilesBelongToModel(model, fileIds = []) {
  if (!model?.driveFolderId) {
    const error = new Error("Model does not have a Google Drive folder.");
    error.status = 400;
    throw error;
  }
  const uniqueIds = [...new Set(fileIds.map(extractDriveId).filter(Boolean))];
  const files = await Promise.all(uniqueIds.map((fileId) => getGoogleDriveFileMetadata(fileId, {
    fields: "id,name,mimeType,parents,trashed,version,modifiedTime,driveId",
  })));
  const invalid = files.find((file) => file.trashed || !(file.parents || []).includes(model.driveFolderId));
  if (invalid) {
    const error = new Error(`Drive file ${invalid.name || invalid.id} does not belong to the model folder.`);
    error.status = 400;
    error.code = "DRIVE_FILE_PARENT_MISMATCH";
    throw error;
  }
  return files;
}

export async function adminUpdateMarketplaceMetadata(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    await assertMarketplaceMigrationUnlocked(assetType);
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const unknownKey = rejectUnknownKeys(req.body, ["metadata", "expectedMetadataHash", "expectedDriveVersion"]);
    if (unknownKey || !req.body.metadata || typeof req.body.metadata !== "object") {
      return res.status(400).json({ message: "Invalid marketplace metadata request" });
    }
    const model = await MarketplaceModel.findById(req.params.id).lean();
    if (!model || normalizeAssetType(model.assetType) !== assetType) return res.status(404).json({ message: `${assetNoun(assetType)} not found` });
    assertMarketplaceAssetEditable(model);
    const result = await writeMarketplaceModelMetadata(model, req.body.metadata, {
      metadataHash: limitedString(req.body.expectedMetadataHash, 80),
      driveVersion: limitedString(req.body.expectedDriveVersion, 80),
    });
    return res.json({
      model: adminModel(result.model),
      metadata: result.metadata,
      metadataHash: result.metadataHash,
      driveVersion: result.driveVersion,
    });
  } catch (error) {
    if (error?.code === "METADATA_CONFLICT") {
      return res.status(409).json({
        message: error.message,
        code: error.code,
        current: error.current,
        diff: error.diff || [],
      });
    }
    if (error?.code === "METADATA_INVALID") {
      return res.status(error.status || 400).json({ message: error.message, code: error.code, details: error.details || [] });
    }
    return next(error);
  }
}

export async function adminUpdateMarketplaceState(req, res, next) {
  return adminUpdateMarketplaceModel(req, res, next);
}

export async function adminAttachMarketplaceFile(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    await assertMarketplaceMigrationUnlocked(assetType);
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
    const existing = await MarketplaceModel.findById(req.params.id).lean();
    if (!existing || normalizeAssetType(existing.assetType) !== assetType) return res.status(404).json({ message: `${assetNoun(assetType)} not found` });
    assertMarketplaceAssetEditable(existing);
    if (storageProvider === "google_drive" && existing.driveFolderId) {
      const driveFileId = extractDriveId(req.body.driveFileId);
      if (!driveFileId) return res.status(400).json({ message: "Google Drive file id is required" });
      await assertDriveFilesBelongToModel(existing, [driveFileId]);
      const result = await syncMarketplaceDriveFolder({ driveFolderId: existing.driveFolderId, force: true, assetType });
      return res.json({ model: adminModel(result.model), compatibilityMode: true });
    }
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
          ...(fileStatus === "ready" ? {} : { isPublished: false }),
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
    const assetType = adminAssetType(req);
    await assertMarketplaceMigrationUnlocked(assetType);
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
    const existing = await MarketplaceModel.findById(req.params.id).lean();
    if (!existing || normalizeAssetType(existing.assetType) !== assetType) return res.status(404).json({ message: `${assetNoun(assetType)} not found` });
    assertMarketplaceAssetEditable(existing);
    if (existing.driveFolderId) {
      const driveFileIds = [
        payload.coverImage?.driveFileId,
        payload.metadataDriveFileId,
        ...(payload.previewImages || []).map((item) => item.driveFileId),
      ].filter(Boolean);
      if (!driveFileIds.length) return res.status(400).json({ message: "At least one Google Drive file id is required" });
      await assertDriveFilesBelongToModel(existing, driveFileIds);
      const result = await syncMarketplaceDriveFolder({ driveFolderId: existing.driveFolderId, force: true, assetType });
      return res.json({ model: adminModel(result.model), compatibilityMode: true });
    }
    const model = await MarketplaceModel.findByIdAndUpdate(req.params.id, { $set: payload }, { new: true });
    if (!model) return res.status(404).json({ message: "Model not found" });
    res.json({ model: adminModel(model) });
  } catch (error) {
    next(error);
  }
}

export async function rescanMarketplaceModelDrive(existing) {
  if (!existing?.driveFolderId) {
    const error = new Error("Model does not have a Drive folder id");
    error.status = 400;
    throw error;
  }
  return syncMarketplaceDriveFolder({ driveFolderId: existing.driveFolderId, force: true, assetType: existing.assetType });
}

export async function adminRescanMarketplaceModelDriveFolder(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    await assertMarketplaceMigrationUnlocked(assetType);
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid model id" });
    const existing = await MarketplaceModel.findById(req.params.id).select("-source.raw").lean();
    if (!existing || normalizeAssetType(existing.assetType) !== assetType) return res.status(404).json({ message: `${assetNoun(assetType)} not found` });
    assertMarketplaceAssetEditable(existing);
    if (!existing.driveFolderId) {
      return res.status(400).json({ message: "Model does not have a Drive folder id" });
    }
    const result = await rescanMarketplaceModelDrive(existing);
    res.json(result);
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Model slug or source already exists" });
    next(error);
  }
}

function adminImageContentType(fileName = "", fallback = "") {
  const extension = String(fileName).toLowerCase().split(".").pop();
  if (["jpg", "jpeg"].includes(extension)) return "image/jpeg";
  if (extension === "png") return "image/png";
  const error = new Error(`Unsupported marketplace image format${fallback ? ` (${fallback})` : ""}.`);
  error.status = 415;
  error.code = "MARKETPLACE_IMAGE_FORMAT_UNSUPPORTED";
  throw error;
}

async function streamAdminMarketplaceImage(req, res, next, kind) {
  try {
    const assetType = adminAssetType(req);
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: "Invalid marketplace asset id" });
    const model = await MarketplaceModel.findById(req.params.id)
      .select("assetType title coverImage previewImages coverCache deletionStatus")
      .lean();
    if (!model || normalizeAssetType(model.assetType) !== assetType || model.deletionStatus === "purged") {
      return res.status(404).json({ message: `${assetNoun(assetType)} image not found` });
    }
    const index = Math.max(0, Number(req.params.index || 0));
    const image = kind === "cover"
      ? (model.coverImage?.driveFileId ? model.coverImage : model.previewImages?.[0])
      : model.previewImages?.[index];
    if (!image?.driveFileId) return res.status(404).json({ message: "Preview image not found" });
    const cached = kind === "cover" ? await openMarketplaceCoverCache(model) : null;
    if (cached) {
      res.setHeader("cache-control", "private, max-age=300");
      res.setHeader("cross-origin-resource-policy", "same-site");
      res.setHeader("content-type", cached.contentType);
      if (cached.contentLength) res.setHeader("content-length", cached.contentLength);
      cached.stream.on("error", next);
      return cached.stream.pipe(res);
    }
    const contentType = adminImageContentType(image.fileName);
    const file = await openGoogleDriveFileStream(image.driveFileId, image.fileName || `${kind}.jpg`);
    res.setHeader("cache-control", "private, max-age=300");
    // Local development serves the admin UI and API on different ports.
    // Authentication still protects the route; same-site only permits the browser to render it.
    res.setHeader("cross-origin-resource-policy", "same-site");
    res.setHeader("content-type", contentType);
    if (file.contentLength || image.size) res.setHeader("content-length", file.contentLength || image.size);
    file.stream.on("error", next);
    return file.stream.pipe(res);
  } catch (error) {
    return next(error);
  }
}

export function adminStreamMarketplaceCover(req, res, next) {
  return streamAdminMarketplaceImage(req, res, next, "cover");
}

export function adminStreamMarketplacePreview(req, res, next) {
  return streamAdminMarketplaceImage(req, res, next, "preview");
}

async function editableAdminAsset(req) {
  const assetType = adminAssetType(req);
  await assertMarketplaceMigrationUnlocked(assetType);
  if (!isSafeId(req.params.id)) {
    const error = new Error("Invalid marketplace asset id");
    error.status = 400;
    throw error;
  }
  const model = await MarketplaceModel.findById(req.params.id).select("-source.raw").lean();
  if (!model || normalizeAssetType(model.assetType) !== assetType) {
    const error = new Error(`${assetNoun(assetType)} not found`);
    error.status = 404;
    throw error;
  }
  assertMarketplaceAssetEditable(model);
  if (!model.driveFolderId) {
    const error = new Error(`${assetNoun(assetType)} does not have a Google Drive folder.`);
    error.status = 400;
    error.code = "MARKETPLACE_DRIVE_FOLDER_REQUIRED";
    throw error;
  }
  return model;
}

function normalizedImageExtension(fileName) {
  const extension = fileExtension(fileName);
  return extension === "jpeg" ? "jpg" : extension;
}

async function writeMarketplaceCover(model, content, image) {
  const fileName = `cover.${image.extension}`;
  const existingCover = model.coverImage;
  const hasDedicatedCover = existingCover?.driveFileId && /^cover\.(?:jpe?g|png)$/i.test(existingCover.fileName || "");
  if (!hasDedicatedCover) {
    return createGoogleDriveFile({
      folderId: model.driveFolderId,
      fileName,
      content,
      contentType: image.contentType,
    });
  }

  await assertDriveFilesBelongToModel(model, [existingCover.driveFileId]);
  if (normalizedImageExtension(existingCover.fileName) === image.extension) {
    return updateGoogleDriveFileContent(existingCover.driveFileId, content, {
      contentType: image.contentType,
    });
  }

  const replacement = await createGoogleDriveFile({
    folderId: model.driveFolderId,
    fileName,
    content,
    contentType: image.contentType,
  });
  try {
    await setGoogleDriveFileTrashed(existingCover.driveFileId, true);
    return replacement;
  } catch (error) {
    await setGoogleDriveFileTrashed(replacement.id, true).catch(() => {});
    throw error;
  }
}

export async function adminUploadMarketplaceImage(req, res, next) {
  try {
    const model = await editableAdminAsset(req);
    const kind = String(req.query.kind || "preview").trim().toLowerCase();
    if (!["cover", "preview"].includes(kind)) {
      return res.status(400).json({ message: "Image kind must be cover or preview." });
    }
    if (kind === "preview" && (model.previewImages || []).length >= MARKETPLACE_ADMIN_PREVIEW_LIMIT) {
      return res.status(409).json({
        message: `A marketplace asset can contain at most ${MARKETPLACE_ADMIN_PREVIEW_LIMIT} preview images.`,
        code: "MARKETPLACE_PREVIEW_LIMIT_REACHED",
      });
    }
    const image = validateMarketplaceImageUpload(req.body, req.get("content-type"));
    const fileName = nextMarketplaceImageName(kind, image.extension, model.previewImages);
    let driveFile;
    if (kind === "cover") {
      driveFile = await writeMarketplaceCover(model, req.body, image);
    } else {
      driveFile = await createGoogleDriveFile({
        folderId: model.driveFolderId,
        fileName,
        content: req.body,
        contentType: image.contentType,
      });
    }
    const synced = await syncMarketplaceDriveFolder({
      driveFolderId: model.driveFolderId,
      force: true,
      assetType: model.assetType,
    });
    req.auditDetails = { kind, fileName: driveFile?.name || fileName, size: image.size };
    return res.status(201).json({ model: adminModel(synced.model), uploaded: { kind, fileName, size: image.size } });
  } catch (error) {
    return next(error);
  }
}

export async function adminReorderMarketplacePreviews(req, res, next) {
  try {
    const model = await editableAdminAsset(req);
    const unknownKey = rejectUnknownKeys(req.body, ["fileIds"]);
    if (unknownKey || !Array.isArray(req.body.fileIds)) {
      return res.status(400).json({ message: "Preview fileIds are required." });
    }
    const plan = marketplacePreviewRenamePlan(model.previewImages, req.body.fileIds);
    await assertDriveFilesBelongToModel(model, plan.map((item) => item.fileId));
    const temporarilyRenamed = [];
    try {
      for (const item of plan) {
        await renameGoogleDriveFile(item.fileId, item.temporaryName);
        temporarilyRenamed.push(item);
      }
      for (const item of plan) await renameGoogleDriveFile(item.fileId, item.finalName);
    } catch (error) {
      const rollbackPlan = temporarilyRenamed.map((item, index) => ({
        ...item,
        rollbackName: `.rollback-${Date.now()}-${index + 1}-${item.fileId.slice(-8)}`,
      }));
      await Promise.allSettled(rollbackPlan.map((item) => renameGoogleDriveFile(item.fileId, item.rollbackName)));
      for (const item of rollbackPlan) {
        await renameGoogleDriveFile(item.fileId, item.originalName).catch(() => {});
      }
      throw error;
    }
    const synced = await syncMarketplaceDriveFolder({ driveFolderId: model.driveFolderId, force: true, assetType: model.assetType });
    req.auditDetails = { previewCount: plan.length };
    return res.json({ model: adminModel(synced.model) });
  } catch (error) {
    return next(error);
  }
}

export async function adminDeleteMarketplacePreview(req, res, next) {
  try {
    const model = await editableAdminAsset(req);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= (model.previewImages || []).length) {
      return res.status(404).json({ message: "Preview image not found." });
    }
    const image = model.previewImages[index];
    await assertDriveFilesBelongToModel(model, [image.driveFileId]);
    await setGoogleDriveFileTrashed(image.driveFileId, true);
    const synced = await syncMarketplaceDriveFolder({ driveFolderId: model.driveFolderId, force: true, assetType: model.assetType });
    req.auditDetails = { previewIndex: index, fileName: image.fileName };
    return res.json({ model: adminModel(synced.model) });
  } catch (error) {
    return next(error);
  }
}

export async function adminSetMarketplaceCoverFromPreview(req, res, next) {
  try {
    const model = await editableAdminAsset(req);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= (model.previewImages || []).length) {
      return res.status(404).json({ message: "Preview image not found." });
    }
    const source = model.previewImages[index];
    await assertDriveFilesBelongToModel(model, [source.driveFileId]);
    const contentType = adminImageContentType(source.fileName);
    const content = await readGoogleDriveFileBuffer(source.driveFileId, {
      fileName: source.fileName,
      maxBytes: 15 * 1024 * 1024,
    });
    const extension = normalizedImageExtension(source.fileName) === "png" ? "png" : "jpg";
    await writeMarketplaceCover(model, content, { extension, contentType });
    const synced = await syncMarketplaceDriveFolder({ driveFolderId: model.driveFolderId, force: true, assetType: model.assetType });
    req.auditDetails = { previewIndex: index, sourceFileName: source.fileName };
    return res.json({ model: adminModel(synced.model) });
  } catch (error) {
    return next(error);
  }
}

async function adminAssetFromRequest(req) {
  const assetType = adminAssetType(req);
  if (!isSafeId(req.params.id)) {
    const error = new Error("Invalid marketplace asset id");
    error.status = 400;
    throw error;
  }
  const model = await MarketplaceModel.findById(req.params.id).select("-source.raw").lean();
  if (!model || normalizeAssetType(model.assetType) !== assetType) {
    const error = new Error(`${assetNoun(assetType)} not found`);
    error.status = 404;
    throw error;
  }
  return model;
}

function assertDeletionConfirmation(req, model) {
  const confirmation = String(req.body?.confirmation || "").trim();
  if (confirmation === String(model.title || "").trim()) return;
  const error = new Error(`Type the exact ${assetNoun(model.assetType).toLowerCase()} name to confirm.`);
  error.status = 400;
  error.code = "MARKETPLACE_DELETE_CONFIRMATION_REQUIRED";
  throw error;
}

export async function adminTrashMarketplaceAsset(req, res, next) {
  try {
    const model = await adminAssetFromRequest(req);
    assertDeletionConfirmation(req, model);
    if (model.deletionStatus === "purged") return res.status(409).json({ message: "Marketplace asset was permanently deleted." });
    const deleted = model.deletionStatus === "trashed" ? model : await trashMarketplaceAsset(model);
    req.auditDetails = { assetType: model.assetType, title: model.title, deletionStatus: deleted.deletionStatus };
    return res.json({ model: adminModel(deleted) });
  } catch (error) {
    return next(error);
  }
}

export async function adminRestoreMarketplaceAsset(req, res, next) {
  try {
    const model = await adminAssetFromRequest(req);
    const restored = await restoreMarketplaceAsset(model);
    req.auditDetails = { assetType: model.assetType, title: model.title, deletionStatus: restored.deletionStatus };
    return res.json({ model: adminModel(restored) });
  } catch (error) {
    return next(error);
  }
}

export async function adminPurgeMarketplaceAsset(req, res, next) {
  try {
    const model = await adminAssetFromRequest(req);
    assertDeletionConfirmation(req, model);
    const purged = await permanentlyDeleteMarketplaceAsset(model);
    req.auditDetails = { assetType: model.assetType, title: model.title, deletionStatus: purged.deletionStatus };
    return res.json({ model: adminModel(purged) });
  } catch (error) {
    return next(error);
  }
}

export async function adminVerifyMarketplaceFile(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    if (!isSafeId(req.params.id)) return res.status(400).json({ message: `Invalid ${assetNoun(assetType).toLowerCase()} id` });
    const model = await MarketplaceModel.findById(req.params.id).select("assetType storageProvider driveFileId driveFolderId fileName fileSize deletionStatus").lean();
    if (!model || normalizeAssetType(model.assetType) !== assetType) {
      return res.status(404).json({ message: `${assetNoun(assetType)} not found` });
    }
    assertMarketplaceAssetEditable(model);
    if (model.storageProvider !== "google_drive" || !model.driveFileId) {
      return res.status(409).json({
        message: `${assetNoun(assetType)} does not have a Google Drive archive attached.`,
        code: "DRIVE_ARCHIVE_NOT_ATTACHED",
      });
    }

    const metadata = await getGoogleDriveFileMetadata(model.driveFileId, {
      fields: "id,name,mimeType,size,modifiedTime,version,parents,trashed,capabilities(canDownload)",
    });
    if (metadata.trashed) {
      return res.status(404).json({ message: "Google Drive archive is in trash.", code: "DRIVE_ARCHIVE_MISSING" });
    }
    if (metadata.capabilities?.canDownload === false) {
      return res.status(409).json({ message: "Google Drive has disabled downloads for this archive.", code: "DRIVE_DOWNLOAD_DISABLED" });
    }
    const parentMatched = !model.driveFolderId || (metadata.parents || []).includes(model.driveFolderId);
    if (!parentMatched) {
      return res.status(409).json({ message: "Google Drive archive is outside the asset folder.", code: "DRIVE_FILE_PARENT_MISMATCH" });
    }

    return res.json({
      verification: {
        ok: true,
        provider: "google_drive",
        fileName: metadata.name || model.fileName || "",
        mimeType: metadata.mimeType || "",
        fileSize: Number(metadata.size || model.fileSize || 0),
        modifiedTime: metadata.modifiedTime || null,
        canDownload: metadata.capabilities?.canDownload !== false,
        parentMatched,
        checkedAt: new Date(),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminMarketplaceStats(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    const assetQuery = { assetType };
    const catalogQuery = { assetType, $and: [marketplaceActiveDeletionQuery()] };
    const [models, ready, missing, sessions, downloads, trashed, coverCacheErrors, reportStats] = await Promise.all([
      MarketplaceModel.countDocuments(catalogQuery),
      MarketplaceModel.countDocuments({ ...catalogQuery, fileStatus: "ready" }),
      MarketplaceModel.countDocuments({ ...catalogQuery, fileStatus: { $ne: "ready" } }),
      DownloadSession.countDocuments(assetQuery),
      ModelDownload.countDocuments(assetQuery),
      MarketplaceModel.countDocuments({ assetType, ...marketplaceTrashDeletionQuery() }),
      MarketplaceModel.countDocuments({ ...catalogQuery, "coverCache.status": "error" }),
      marketplaceReportStats(assetType),
    ]);
    const [completeMetadata, incompleteMetadata, published] = await Promise.all([
      MarketplaceModel.countDocuments({ ...catalogQuery, metadataStatus: "complete" }),
      MarketplaceModel.countDocuments({ ...catalogQuery, metadataStatus: "incomplete" }),
      MarketplaceModel.countDocuments({ ...catalogQuery, isPublished: true }),
    ]);
    res.json({
      stats: {
        assetType,
        models,
        ready,
        missing,
        sessions,
        downloads,
        completeMetadata,
        incompleteMetadata,
        published,
        draft: Math.max(0, models - published),
        trashed,
        coverCacheErrors,
        activeReports: reportStats.activeReports,
        reportedAssets: reportStats.reportedAssets,
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function adminCleanupMarketplaceRaw(_req, res, next) {
  try {
    const modelOnlyQuery = { assetType: { $ne: "scene" } };
    const docs = await MarketplaceModel.find(modelOnlyQuery)
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
      modelOnlyQuery,
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
      .select("_id categorySourceId styles renderers renderer forms colors materials platforms fileStatus desiredPublished isPublished metadataStatus metadataMissingFields publicationBlockers")
      .lean();
    let normalizedMetadata = 0;
    let unpublishedIncomplete = 0;
    for (const doc of metadataDocs) {
      const completeness = metadataCompleteness(doc);
      const update = {
        metadataStatus: completeness.metadataStatus,
        metadataMissingFields: completeness.metadataMissingFields,
        publicationBlockers: requiredPublicationBlockers(doc),
      };
      const shouldBePublished = Boolean(doc.desiredPublished ?? doc.isPublished) &&
        completeness.metadataStatus === "complete" &&
        doc.fileStatus === "ready" &&
        update.publicationBlockers.length === 0;
      if (Boolean(doc.isPublished) !== shouldBePublished) {
        update.isPublished = shouldBePublished;
      }
      if (doc.isPublished && !shouldBePublished) {
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

export async function adminSyncMarketplaceDriveFolder(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    await assertMarketplaceMigrationUnlocked(assetType);
    const unknownKey = rejectUnknownKeys(req.body, ["driveFolderId", "driveFolderUrl"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid Drive folder sync request" });
    const driveFolderId = extractDriveId(req.body.driveFolderId || req.body.driveFolderUrl);
    if (!driveFolderId) return res.status(400).json({ message: "Google Drive model folder id is required" });
    const folderSnapshot = await getGoogleDriveFileMetadata(driveFolderId, {
      fields: "id,name,mimeType,modifiedTime,version,parents,trashed,driveId",
    });
    const rootEnv = driveRootEnv(assetType);
    const configuredRootId = extractDriveId(process.env[rootEnv]);
    if (configuredRootId && !(folderSnapshot.parents || []).includes(configuredRootId)) {
      return res.status(400).json({
        message: `Drive ${assetType} folder must be a direct child of ${rootEnv}`,
        code: "DRIVE_FOLDER_OUTSIDE_MARKETPLACE_ROOT",
      });
    }
    const result = await syncMarketplaceDriveFolder({ driveFolderId, folderSnapshot, force: true, assetType });
    return res.json({ ...result, model: adminModel(result.model) });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "Model slug or Drive folder already exists" });
    return next(error);
  }
}

export async function adminImportDriveFolderModels(req, res, next) {
  return adminReconcileMarketplaceDrive(req, res, next);
}

export async function adminReconcileMarketplaceDrive(req, res, next) {
  let rootFolderId = "";
  try {
    const assetType = adminAssetType(req);
    await assertMarketplaceMigrationUnlocked(assetType);
    const unknownKey = rejectUnknownKeys(req.body, ["rootFolderId", "rootFolderUrl", "pageToken", "limit", "reset"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid Drive reconciliation request" });
    rootFolderId = extractDriveId(
      req.body.rootFolderId || req.body.rootFolderUrl || process.env[driveRootEnv(assetType)],
    );
    if (!rootFolderId) return res.status(400).json({ message: "Google Drive models folder ID is required" });
    const state = await MarketplaceDriveSyncState.findOne({ rootFolderId }).lean();
    const reset = normalizeBoolean(req.body.reset, false);
    const requestedToken = req.body.pageToken === undefined
      ? state?.reconciliationPageToken || ""
      : limitedString(req.body.pageToken, 500);
    const pageToken = reset ? "" : requestedToken;
    await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId },
      {
        $setOnInsert: { rootFolderId, assetType },
        $set: {
          reconciliationStatus: "running",
          reconciliationError: "",
          ...(reset ? { reconciliationScanned: 0 } : {}),
        },
      },
      { upsert: true },
    );
    const result = await scanMarketplaceDriveFolderBatch({
      rootFolderId,
      assetType,
      pageToken,
      limit: Math.min(200, Math.max(1, Number(req.body.limit || 20))),
    });
    const scannedBefore = reset ? 0 : Number(state?.reconciliationScanned || 0);
    await MarketplaceDriveSyncState.findOneAndUpdate(
      { rootFolderId },
      {
        $set: {
          reconciliationPageToken: result.nextPageToken || "",
          reconciliationStatus: result.hasMore ? "idle" : "complete",
          reconciliationScanned: scannedBefore + result.scannedFolders,
          reconciliationUpdatedAt: new Date(),
          reconciliationError: "",
        },
      },
      { new: true },
    );
    return res.json({ ...result, checkpoint: result.nextPageToken || "", resumed: Boolean(pageToken) });
  } catch (error) {
    if (rootFolderId) {
      await MarketplaceDriveSyncState.findOneAndUpdate(
        { rootFolderId },
        {
          $setOnInsert: { rootFolderId, assetType: adminAssetType(req) },
          $set: {
            reconciliationStatus: "error",
            reconciliationUpdatedAt: new Date(),
            reconciliationError: String(error?.message || "reconciliation_failed").slice(0, 500),
          },
        },
        { upsert: true },
      ).catch(() => {});
    }
    return next(error);
  }
}

export async function adminMigrateMarketplaceDriveMetadata(req, res, next) {
  const assetType = adminAssetType(req);
  const migrationRootFolderId = extractDriveId(process.env[driveRootEnv(assetType)]);
  try {
    const unknownKey = rejectUnknownKeys(req.body, ["page", "limit", "dryRun", "backupFolderId", "reset"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid marketplace metadata migration request" });
    if (!migrationRootFolderId) return res.status(400).json({ message: `${driveRootEnv(assetType)} is not configured` });
    const migrationState = await MarketplaceDriveSyncState.findOne({ rootFolderId: migrationRootFolderId }).lean();
    const reset = normalizeBoolean(req.body.reset, false);
    const page = reset
      ? 1
      : Math.max(1, Math.floor(Number(req.body.page || migrationState?.migrationNextPage || 1)));
    const limit = Math.min(50, Math.max(1, Math.floor(Number(req.body.limit || 20))));
    const dryRun = req.body.dryRun !== false;
    const query = {
      assetType: marketplaceAssetTypeFilter(assetType),
      driveFolderId: { $nin: ["", null] },
    };
    const total = await MarketplaceModel.countDocuments(query);
    const models = await MarketplaceModel.find(query)
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();
    const prepared = [];
    const skipped = [];
    if (!dryRun) {
      await MarketplaceDriveSyncState.findOneAndUpdate(
        { rootFolderId: migrationRootFolderId },
        {
          $setOnInsert: { rootFolderId: migrationRootFolderId, assetType },
          $set: {
            migrationStatus: "running",
            migrationError: "",
            ...(reset ? { migrationMigratedCount: 0, migrationNextPage: 1 } : {}),
          },
        },
        { upsert: true },
      );
    }
    for (const model of models) {
      try {
          if (!dryRun && typeof model.desiredPublished !== "boolean") {
          await MarketplaceModel.findByIdAndUpdate(model._id, {
            $set: { desiredPublished: Boolean(model.isPublished) },
          });
          model.desiredPublished = Boolean(model.isPublished);
        }
        const inspection = await inspectMarketplaceModelMetadata(model);
        if (inspection.errors.length) {
          skipped.push({ id: model._id, title: model.title, reason: "invalid_mongo_metadata", details: inspection.errors });
          continue;
        }
        prepared.push({ model, inspection });
      } catch (error) {
        skipped.push({ id: model._id, title: model.title, reason: error?.message || "inspection_failed" });
      }
    }
    const changed = prepared.filter(({ inspection }) =>
      inspection.diff.length || !inspection.metadataFile || Number(inspection.current.document?.schemaVersion || 0) < 2,
    );
    let backupFile = null;
    const migrated = [];
    if (!dryRun && changed.length) {
      const backupRows = changed
        .filter(({ inspection }) => inspection.current.document)
        .map(({ model, inspection }) => JSON.stringify({
          modelId: String(model._id),
          driveFolderId: model.driveFolderId,
          metadataDriveFileId: inspection.metadataFile?.id || "",
          metadata: inspection.current.rawDocument || inspection.current.document,
        }));
      if (backupRows.length) {
        const backupFolderId = extractDriveId(
          req.body.backupFolderId || process.env[driveBackupEnv(assetType)] || process.env[driveRootEnv(assetType)],
        );
        backupFile = await createGoogleDriveFile({
          folderId: backupFolderId,
          fileName: `metadata-backup-${new Date().toISOString().replace(/[:.]/g, "-")}-p${page}.jsonl.gz`,
          content: zlib.gzipSync(Buffer.from(`${backupRows.join("\n")}\n`), { level: 9 }),
          contentType: "application/gzip",
        });
      }
      for (const item of changed) {
        try {
          const result = await writeMarketplaceModelMetadata(item.model, item.inspection.desired, {
            metadataHash: item.inspection.current.hash,
            driveVersion: String(item.inspection.metadataFile?.version || ""),
            allowSourceModelIdChange: true,
          });
          migrated.push({ id: item.model._id, title: result.model?.title, status: "migrated" });
        } catch (error) {
          skipped.push({ id: item.model._id, title: item.model.title, reason: error?.message || "migration_failed" });
        }
      }
    }
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const hasBlockingFailures = !dryRun && skipped.length > 0;
    const migrationComplete = !hasBlockingFailures && page >= totalPages;
    const nextPage = hasBlockingFailures ? page : page < totalPages ? page + 1 : 1;
    if (!dryRun) {
      await MarketplaceDriveSyncState.findOneAndUpdate(
        { rootFolderId: migrationRootFolderId },
        {
          $set: {
            migrationNextPage: nextPage,
            migrationStatus: hasBlockingFailures ? "error" : migrationComplete ? "complete" : "running",
            migrationUpdatedAt: new Date(),
            migrationError: hasBlockingFailures ? `${skipped.length} model(s) require attention` : "",
            ...(migrationComplete ? { changesPageToken: "", changesInitializedAt: null } : {}),
          },
          $inc: { migrationMigratedCount: migrated.length },
        },
      );
    }
    return res.json({
      dryRun,
      page,
      limit,
      total,
      totalPages,
      nextPage,
      complete: migrationComplete,
      inspected: prepared.length,
      changed: changed.length,
      migrated: migrated.length,
      backupFileId: backupFile?.id || "",
      skipped,
      preview: changed.slice(0, 20).map(({ model, inspection }) => ({
        id: model._id,
        title: model.title,
        hasMetadataFile: Boolean(inspection.metadataFile),
        diff: inspection.diff,
      })),
    });
  } catch (error) {
    if (migrationRootFolderId && req.body?.dryRun === false) {
      await MarketplaceDriveSyncState.findOneAndUpdate(
        { rootFolderId: migrationRootFolderId },
        {
          $setOnInsert: { rootFolderId: migrationRootFolderId, assetType },
          $set: {
            migrationStatus: "error",
            migrationUpdatedAt: new Date(),
            migrationError: String(error?.message || "migration_failed").slice(0, 500),
          },
        },
        { upsert: true },
      ).catch(() => {});
    }
    return next(error);
  }
}

const BULK_MODEL_LIMIT = 50;
const BULK_RESCAN_LIMIT = 10;

export async function adminBulkMarketplaceModels(req, res, next) {
  try {
    const assetType = adminAssetType(req);
    const unknownKey = rejectUnknownKeys(req.body, ["ids", "action", "accessType"]);
    if (unknownKey) return res.status(400).json({ message: "Invalid bulk request" });
    const action = String(req.body.action || "").trim().toLowerCase();
    if (!["publish", "unpublish", "access", "rescan"].includes(action)) {
      return res.status(400).json({ message: "Invalid bulk action" });
    }
    if (["access", "rescan"].includes(action)) await assertMarketplaceMigrationUnlocked(assetType);
    const rawIds = Array.isArray(req.body.ids) ? req.body.ids.map((id) => String(id || "").trim()) : [];
    const ids = [...new Set(rawIds.filter((id) => isSafeId(id)))];
    const maxIds = action === "rescan" ? BULK_RESCAN_LIMIT : BULK_MODEL_LIMIT;
    if (!ids.length) return res.status(400).json({ message: "No model ids provided" });
    if (ids.length > maxIds) {
      return res.status(400).json({ message: `Too many models for bulk ${action} (max ${maxIds})` });
    }

    const results = [];
    let updatedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const id of ids) {
      const model = await MarketplaceModel.findById(id).select("-source.raw").lean();
      if (!model || normalizeAssetType(model.assetType) !== assetType) {
        skippedCount += 1;
        results.push({ id, status: "skipped", reason: "not_found" });
        continue;
      }
      if (isMarketplaceAssetDeleted(model)) {
        skippedCount += 1;
        results.push({ id, status: "skipped", reason: "trashed" });
        continue;
      }
      try {
        if (action === "publish") {
          const completeness = metadataCompleteness(model);
          const blockers = requiredPublicationBlockers(model);
          const online = completeness.metadataStatus === "complete" && model.fileStatus === "ready" && blockers.length === 0;
          await MarketplaceModel.findByIdAndUpdate(id, {
            $set: {
              desiredPublished: true,
              isPublished: online,
              metadataStatus: completeness.metadataStatus,
              metadataMissingFields: completeness.metadataMissingFields,
              publicationBlockers: blockers,
              discoveryStatus: "pending",
              discoveryError: "",
              searchStatus: "pending",
              searchError: "",
            },
          });
          updatedCount += 1;
          results.push({ id, status: "updated", title: model.title, online, blockers });
        } else if (action === "unpublish") {
          await MarketplaceModel.findByIdAndUpdate(id, {
            $set: {
              desiredPublished: false,
              isPublished: false,
              discoveryStatus: "pending",
              discoveryError: "",
              searchStatus: "pending",
              searchError: "",
            },
          });
          updatedCount += 1;
          results.push({ id, status: "updated", title: model.title });
        } else if (action === "access") {
          const accessType = normalizeMarketplaceAccessType(req.body.accessType);
          const metadata = { ...metadataFromMarketplaceModel(model), accessType };
          await writeMarketplaceModelMetadata(model, metadata, {
            metadataHash: model.metadataHash,
            driveVersion: model.metadataDriveVersion,
          });
          updatedCount += 1;
          results.push({ id, status: "updated", title: model.title, accessType });
        } else if (action === "rescan") {
          if (!model.driveFolderId) {
            skippedCount += 1;
            results.push({ id, status: "skipped", reason: "no_drive_folder", title: model.title });
            continue;
          }
          const scan = await rescanMarketplaceModelDrive(model);
          updatedCount += 1;
          results.push({
            id,
            status: "updated",
            title: model.title,
            scannedFiles: scan.scannedFiles,
            previewCount: scan.previewCount,
            changed: scan.changed,
            metadataError: scan.metadataError || "",
          });
        }
      } catch (error) {
        failedCount += 1;
        results.push({ id, status: "failed", reason: error?.message || "bulk_action_failed", title: model.title });
      }
    }

    res.json({ action, total: ids.length, updatedCount, skippedCount, failedCount, results });
  } catch (error) {
    next(error);
  }
}

export async function adminListMarketplaceDownloads(req, res, next) {
  try {
    const requestedAssetType = String(req.query.assetType || req.marketplaceAssetType || "all").trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const clientType = String(req.query.clientType || "all");
    const accessTier = String(req.query.accessTier || "all");
    const paymentMethod = String(req.query.paymentMethod || "all");
    const query = {};
    if (["model", "scene"].includes(requestedAssetType)) query.assetType = requestedAssetType;
    if (["web", "plugin"].includes(clientType)) query.clientType = clientType;
    if (["guest", "free", "member", "admin"].includes(accessTier)) query.accessTier = accessTier;
    if (["free_quota", "pro_quota", "credit"].includes(paymentMethod)) query.paymentMethod = paymentMethod;
    const total = await ModelDownload.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const downloads = await ModelDownload.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .populate("modelId", "assetType title slug accessType fileStatus source")
      .lean();
    await hydrateAtlasUserField(downloads);
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
    const requestedAssetType = String(req.query.assetType || req.marketplaceAssetType || "all").trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.limit || 20)));
    const status = String(req.query.status || "all");
    const clientType = String(req.query.clientType || "all");
    const paymentMethod = String(req.query.paymentMethod || "all");
    const query = {};
    if (["model", "scene"].includes(requestedAssetType)) query.assetType = requestedAssetType;
    if (["active", "used", "expired", "revoked"].includes(status)) query.status = status;
    if (["web", "plugin"].includes(clientType)) query.clientType = clientType;
    if (["free_quota", "pro_quota", "credit"].includes(paymentMethod)) query.paymentMethod = paymentMethod;
    const total = await DownloadSession.countDocuments(query);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const sessions = await DownloadSession.find(query)
      .sort({ createdAt: -1 })
      .skip((safePage - 1) * pageSize)
      .limit(pageSize)
      .select("-tokenHash")
      .populate("modelId", "assetType title slug accessType fileStatus source")
      .lean();
    await hydrateAtlasUserField(sessions);
    res.json({
      sessions,
      pagination: { page: safePage, pageSize, total, totalPages },
    });
  } catch (error) {
    next(error);
  }
}
