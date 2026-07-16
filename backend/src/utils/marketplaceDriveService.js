import crypto from "node:crypto";
import zlib from "node:zlib";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { normalizeMarketplaceTitle } from "./marketplaceSort.js";
import {
  createGoogleDriveFile,
  getGoogleDriveFileMetadata,
  listGoogleDriveFolderFiles,
  readGoogleDriveFileBuffer,
  updateGoogleDriveFileContent,
} from "./storageProvider.js";
import {
  MARKETPLACE_METADATA_MAX_BYTES,
  marketplaceMetadataDiff,
  marketplaceMetadataDocument,
  marketplaceMetadataHash,
  metadataFromMarketplaceModel,
  normalizeMarketplaceMetadata,
  serializeMarketplaceMetadata,
} from "./marketplaceMetadata.js";
import { marketplaceAssetTypeFilter, normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { resolveMarketplaceCategory, validateMarketplaceTaxonomy } from "./marketplaceTaxonomy.js";

const FOLDER_MIME = "application/vnd.google-apps.folder";

function clean(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

function slugify(value = "") {
  return clean(value, 200)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function extension(name = "") {
  return String(name).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function baseName(name = "") {
  return String(name).trim().toLowerCase().replace(/\.json\.gz$/, "").replace(/\.[a-z0-9]+$/, "");
}

function naturalName(a, b) {
  return String(a?.name || "").localeCompare(String(b?.name || ""), "en", { numeric: true });
}

function isImage(file) {
  return String(file?.mimeType || "").startsWith("image/") || ["jpg", "jpeg", "png"].includes(extension(file?.name));
}

function isArchive(file) {
  const ext = extension(file?.name);
  const mime = String(file?.mimeType || "").toLowerCase();
  return ["zip", "rar", "7z"].includes(ext) ||
    mime === "application/zip" ||
    mime.endsWith("+zip") ||
    mime.includes("rar") ||
    mime.includes("x-7z");
}

function pickMetadata(files = []) {
  return files.filter((file) => /\.json(?:\.gz)?$/i.test(String(file?.name || ""))).sort((a, b) => {
    const score = (file) => {
      const name = String(file?.name || "").toLowerCase();
      if (name === "metadata.json.gz") return 0;
      if (name === "metadata.json") return 1;
      return name.includes("metadata") ? 2 : 10;
    };
    return score(a) - score(b) || naturalName(a, b);
  })[0];
}

function pickChecksum(files = []) {
  return files.filter((file) => /(?:model\.sha256|sha256\.txt|\.sha256)$/i.test(String(file?.name || ""))).sort(naturalName)[0];
}

function pickArchive(files = [], assetType = "model") {
  return files.filter(isArchive).sort((a, b) => {
    const preferred = normalizeAssetType(assetType) === "scene" ? "scene" : "model";
    const score = (file) => new RegExp(`^${preferred}\\.(zip|rar|7z)$`, "i").test(String(file?.name || "")) ? 0 : 1;
    return score(a) - score(b) || Number(b?.size || 0) - Number(a?.size || 0) || naturalName(a, b);
  })[0];
}

function pickCover(images = [], assetType = "model") {
  if (normalizeAssetType(assetType) === "scene") {
    return images.find((file) => /^preview[-_ ]?0*1$/.test(baseName(file?.name)));
  }
  return images.sort((a, b) => {
    const score = (file) => {
      const base = baseName(file?.name);
      if (base === "cover") return 0;
      if (["thumb", "thumbnail"].includes(base)) return 1;
      if (base.includes("cover")) return 2;
      return 10;
    };
    return score(a) - score(b) || Number(a?.size || 0) - Number(b?.size || 0) || naturalName(a, b);
  })[0];
}

function pickPreviews(images = [], cover = null, assetType = "model") {
  const sorted = images.sort((a, b) => {
    const score = (file) => {
      const match = baseName(file?.name).match(/^preview[-_ ]?(\d+)/);
      if (match) return Number(match[1]);
      return baseName(file?.name).includes("preview") ? 100 : 1000;
    };
    return score(a) - score(b) || naturalName(a, b);
  });
  const previews = sorted.filter((file) => file.id !== cover?.id);
  return (normalizeAssetType(assetType) === "scene" ? [cover, ...previews] : previews).filter(Boolean).slice(0, 20);
}

function imageRef(file, alt = "") {
  return file ? {
    driveFileId: clean(file.id, 160),
    fileName: clean(file.name, 240),
    width: Math.max(0, Math.round(Number(file.imageMediaMetadata?.width || 0))),
    height: Math.max(0, Math.round(Number(file.imageMediaMetadata?.height || 0))),
    size: Math.max(0, Number(file.size || 0)),
    alt: clean(alt, 120),
  } : {};
}

function sourceIdFromName(folderName = "", fallback = "") {
  return clean(String(folderName).match(/^([0-9]{4,})(?:[._ -]|$)/)?.[1] || fallback, 80);
}

function titleFromName(folderName = "", sourceId = "") {
  const title = String(folderName).replace(new RegExp(`^${sourceId}[._ -]*`, "i"), "").replace(/[._-]+/g, " ").trim();
  return clean(title || (sourceId ? `Model ${sourceId}` : folderName), 200);
}

function driveSignature(folder, files) {
  const value = {
    folder: { id: folder.id, name: folder.name, modifiedTime: folder.modifiedTime || "" },
    files: files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: String(file.size || ""),
      modifiedTime: file.modifiedTime || "",
      version: String(file.version || ""),
    })).sort((a, b) => `${a.name}:${a.id}`.localeCompare(`${b.name}:${b.id}`)),
  };
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function legacyMetadata(raw = {}, fallback = {}) {
  const source = raw?.model || raw?.data || raw || {};
  return {
    assetType: source.assetType || fallback.assetType || "model",
    sourceAssetId: source.sourceAssetId || source.sourceModelId || source.modelId || source.id || source.source?.assetId || source.source?.modelId || fallback.sourceAssetId || fallback.sourceModelId,
    sourceModelId: source.sourceModelId || source.sourceAssetId || source.modelId || source.id || source.source?.modelId || fallback.sourceModelId || fallback.sourceAssetId,
    title: source.title || source.name || source.modelName || fallback.title,
    sourceCategoryId: source.sourceCategoryId || source.categoryId || source.category?.slug || source.source?.categoryId || fallback.sourceCategoryId,
    accessType: source.accessType || source.access || source.tier || fallback.accessType,
    renderer: typeof source.renderer === "string" ? source.renderer : fallback.renderer,
    styles: source.styles || source.style || fallback.styles,
    renderers: source.renderers || source.render || (Array.isArray(source.renderer) ? source.renderer : fallback.renderers),
    forms: source.forms || source.form || source.shape || fallback.forms,
    colors: source.colors || source.color || fallback.colors,
    materials: source.materials || source.material || fallback.materials,
    sha256: source.sha256 || source.checksum || source.file?.sha256 || fallback.sha256,
  };
}

function stableMetadataDocument(raw, normalized) {
  const source = raw?.model || raw?.data || raw || {};
  const updated = new Date(source.updatedAt || 0);
  return {
    schemaVersion: Math.max(1, Number(source.schemaVersion || 1)),
    revision: Math.max(0, Math.floor(Number(source.revision || 0))),
    updatedAt: Number.isNaN(updated.getTime()) ? new Date(0).toISOString() : updated.toISOString(),
    ...normalized,
  };
}

export async function readMarketplaceDriveMetadata(file, fallback = {}) {
  if (!file?.id) return { document: null, metadata: null, hash: "", errors: [{ field: "metadataFile", code: "required" }] };
  const buffer = await readGoogleDriveFileBuffer(file.id, { fileName: file.name, maxBytes: 1024 * 1024 });
  let body = buffer;
  if (/\.gz$/i.test(String(file.name || ""))) body = zlib.gunzipSync(buffer);
  if (body.length > MARKETPLACE_METADATA_MAX_BYTES) {
    const error = new Error(`Marketplace metadata exceeds ${MARKETPLACE_METADATA_MAX_BYTES} bytes.`);
    error.status = 413;
    throw error;
  }
  const parsed = JSON.parse(body.toString("utf8"));
  const { metadata, errors } = normalizeMarketplaceMetadata(legacyMetadata(parsed, fallback));
  const taxonomy = await validateMarketplaceTaxonomy(metadata);
  const document = stableMetadataDocument(parsed, metadata);
  return {
    document,
    rawDocument: parsed,
    metadata,
    hash: marketplaceMetadataHash(document),
    errors: [...errors, ...taxonomy.errors],
  };
}

async function readChecksum(file) {
  if (!file?.id) return "";
  const buffer = await readGoogleDriveFileBuffer(file.id, { fileName: file.name, maxBytes: 64 * 1024 });
  return String(buffer.toString("utf8").match(/[a-f0-9]{64}/i)?.[0] || "").toLowerCase();
}

async function categoryFields(sourceCategoryId, assetType = "model") {
  const value = clean(sourceCategoryId, 80);
  if (!value) return { categorySourceId: "", parentCategorySourceId: "" };
  const resolved = await resolveMarketplaceCategory(value, assetType, { requireLeaf: true });
  if (!resolved) return { categorySourceId: "", parentCategorySourceId: "" };
  return {
    categorySourceId: String(resolved.category.sourceCategoryId || ""),
    parentCategorySourceId: String(resolved.parent?.sourceCategoryId || ""),
  };
}

function publicationBlockers({ metadataFile, metadataErrors, categorySourceId, archive, cover }) {
  const blockers = [];
  if (!metadataFile) blockers.push("metadata_file");
  if (!archive) blockers.push("archive");
  if (!cover) blockers.push("cover");
  if (!categorySourceId) blockers.push("category");
  for (const error of metadataErrors || []) {
    const key = error.field === "sourceCategoryId" ? "category" : error.field;
    if (!blockers.includes(key)) blockers.push(key);
  }
  return blockers;
}

async function uniqueSlug(preferred, folderId, existingId = "", assetType = "model") {
  const normalizedType = normalizeAssetType(assetType);
  const base = slugify(preferred) || `${normalizedType}-${String(folderId).slice(-8).toLowerCase()}`;
  const found = await MarketplaceModel.findOne({ assetType: marketplaceAssetTypeFilter(normalizedType), slug: base }).select("_id").lean();
  if (!found || String(found._id) === String(existingId)) return base;
  return `${base}-${String(folderId).slice(-8).toLowerCase()}`;
}

async function findModelForFolder(folder, metadata = {}, assetType = "model") {
  const normalizedType = normalizeAssetType(assetType);
  const folderName = clean(folder.name, 200);
  const sourceModelId = metadata.sourceAssetId || metadata.sourceModelId || sourceIdFromName(folderName);
  const candidates = [
    { driveFolderId: folder.id },
    { "source.provider": "drive", "source.modelId": folder.id },
    { "source.slug": folderName },
  ];
  if (sourceModelId) {
    candidates.push({ metadataSourceModelId: sourceModelId });
    candidates.push({ "source.assetId": sourceModelId });
    candidates.push({ "source.provider": "catalog", "source.modelId": sourceModelId });
    candidates.push({ "source.provider": "3dsky", "source.modelId": sourceModelId });
  }
  return MarketplaceModel.findOne({ assetType: marketplaceAssetTypeFilter(normalizedType), $or: candidates }).lean();
}

export async function syncMarketplaceDriveFolder({ driveFolderId, folderSnapshot = null, force = true, assetType = "model" } = {}) {
  const normalizedType = normalizeAssetType(assetType);
  const folderId = clean(driveFolderId || folderSnapshot?.id, 160);
  if (!folderId) {
    const error = new Error("Google Drive model folder id is required.");
    error.status = 400;
    throw error;
  }
  const folder = folderSnapshot || await getGoogleDriveFileMetadata(folderId, {
    fields: "id,name,mimeType,modifiedTime,version,parents,trashed,driveId",
  });
  if (folder.trashed || folder.mimeType !== FOLDER_MIME) {
    const error = new Error("Google Drive model folder is missing or invalid.");
    error.status = 404;
    throw error;
  }
  const files = await listGoogleDriveFolderFiles(folderId);
  const signature = driveSignature(folder, files);
  let existing = await findModelForFolder(folder, {}, normalizedType);
  if (!force && existing?.driveSignature === signature) {
    const model = await MarketplaceModel.findByIdAndUpdate(existing._id, {
      $set: { lastDriveScanAt: new Date(), "source.syncedAt": new Date() },
    }, { new: true });
    return { model, action: "unchanged", changed: false, scannedFiles: files.length, previewCount: model.previewImages?.length || 0 };
  }

  const metadataFile = pickMetadata(files);
  const archive = pickArchive(files, normalizedType);
  const images = files.filter(isImage);
  const cover = pickCover(images, normalizedType);
  const previews = pickPreviews(images, cover, normalizedType);
  const checksumFile = pickChecksum(files);
  const folderName = clean(folder.name, 200);
  const fallbackSourceId = sourceIdFromName(folderName, existing?.metadataSourceModelId || existing?.slug || folderId);
  let metadataResult = { document: null, metadata: null, hash: "", errors: [{ field: "metadataFile", code: "required" }] };
  let syncError = "";
  if (metadataFile) {
    try {
      metadataResult = await readMarketplaceDriveMetadata(metadataFile, {
        assetType: normalizedType,
        sourceAssetId: fallbackSourceId,
        sourceModelId: fallbackSourceId,
        title: existing?.title || titleFromName(folderName, fallbackSourceId),
        sourceCategoryId: existing?.categorySourceId || existing?.source?.categoryId,
        accessType: existing?.accessType || "member",
        renderer: existing?.renderer,
        styles: existing?.styles,
        renderers: existing?.renderers,
        forms: existing?.forms,
        colors: existing?.colors,
        materials: existing?.materials,
        sha256: existing?.sha256,
      });
    } catch (error) {
      syncError = clean(error?.message || "metadata_parse_failed", 500);
      metadataResult.errors = [{ field: "metadataFile", code: "invalid" }];
    }
  }
  const metadata = metadataResult.metadata || {
    assetType: normalizedType,
    sourceAssetId: fallbackSourceId,
    sourceModelId: fallbackSourceId,
    title: existing?.title || titleFromName(folderName, fallbackSourceId),
    sourceCategoryId: existing?.categorySourceId || "",
    accessType: existing?.accessType || "member",
    renderer: existing?.renderer || "",
    styles: existing?.styles || [],
    renderers: existing?.renderers || [],
    forms: existing?.forms || [],
    colors: existing?.colors || [],
    materials: existing?.materials || [],
    sha256: existing?.sha256 || "",
  };
  existing = existing || await findModelForFolder(folder, metadata, normalizedType);
  if (existing?.driveFolderId && existing.driveFolderId !== folderId) {
    const error = new Error(`Source ${normalizedType} ${metadata.sourceAssetId || metadata.sourceModelId || fallbackSourceId} is already attached to another Drive folder.`);
    error.status = 409;
    error.code = "MARKETPLACE_SOURCE_MODEL_CONFLICT";
    throw error;
  }
  const categories = await categoryFields(metadata.sourceCategoryId, normalizedType);
  const blockers = publicationBlockers({
    metadataFile,
    metadataErrors: metadataResult.errors,
    categorySourceId: categories.categorySourceId,
    archive,
    cover,
  });
  const desiredPublished = typeof existing?.desiredPublished === "boolean"
    ? existing.desiredPublished
    : typeof existing?.isPublished === "boolean" ? existing.isPublished : true;
  const now = new Date();
  const sha256 = metadata.sha256 || await readChecksum(checksumFile).catch(() => "") || existing?.sha256 || "";
  const payload = {
    assetType: normalizedType,
    source: {
      provider: "drive",
      modelId: folderId,
      assetId: metadata.sourceAssetId || metadata.sourceModelId || fallbackSourceId,
      slug: folderName,
      categoryId: metadata.sourceCategoryId || "",
      syncedAt: now,
    },
    title: metadata.title || existing?.title || titleFromName(folderName, metadata.sourceAssetId || metadata.sourceModelId),
    ...categories,
    driveFolderId: folderId,
    driveFolderName: folderName,
    driveSignature: signature,
    lastDriveScanAt: now,
    lastDriveChangeAt: existing?.driveSignature === signature ? existing?.lastDriveChangeAt : now,
    styles: metadata.styles || [],
    renderers: metadata.renderers || [],
    forms: metadata.forms || [],
    colors: metadata.colors || [],
    materials: metadata.materials || [],
    renderer: metadata.renderer || "",
    accessType: metadata.accessType || "member",
    desiredPublished,
    publicationBlockers: blockers,
    isPublished: desiredPublished && blockers.length === 0,
    metadataStatus: blockers.some((item) => !["archive", "cover", "metadata_file"].includes(item)) || !metadataFile ? "incomplete" : "complete",
    metadataMissingFields: blockers.filter((item) => !["archive", "cover", "metadata_file"].includes(item)),
    fileStatus: archive ? "ready" : "missing",
    storageProvider: archive ? "google_drive" : "",
    driveFileId: archive?.id || "",
    archiveExt: ["zip", "rar", "7z"].includes(extension(archive?.name)) ? extension(archive.name) : "zip",
    fileSize: Math.max(0, Number(archive?.size || 0)),
    coverImage: imageRef(cover, metadata.title),
    previewImages: previews.map((file) => imageRef(file, metadata.title)),
    sha256,
    metadataSourceModelId: metadata.sourceAssetId || metadata.sourceModelId || fallbackSourceId,
    metadataDriveFileId: metadataFile?.id || "",
    metadataFileName: clean(metadataFile?.name, 240),
    metadataSize: Math.max(0, Number(metadataFile?.size || 0)),
    metadataHash: metadataResult.hash || "",
    metadataRevision: Math.max(0, Number(metadataResult.document?.revision || 0)),
    metadataDriveVersion: clean(metadataFile?.version, 80),
    metadataModifiedTime: metadataFile?.modifiedTime ? new Date(metadataFile.modifiedTime) : null,
    syncStatus: syncError ? "error" : blockers.some((item) => ["archive", "cover", "metadata_file"].includes(item)) ? "missing" : "synced",
    syncError,
    discoveryStatus: "pending",
    discoveryError: "",
  };
  payload.titleSort = normalizeMarketplaceTitle(payload.title);
  if (!existing?.slug) payload.slug = await uniqueSlug(metadata.title || metadata.sourceAssetId || metadata.sourceModelId, folderId, existing?._id, normalizedType);
  const query = existing?._id ? { _id: existing._id } : { assetType: normalizedType, "source.provider": "drive", "source.modelId": folderId };
  const model = await MarketplaceModel.findOneAndUpdate(query, {
    $set: payload,
    $unset: {
      "source.raw": "", "source.url": "", formats: "", format: "", version: "", polygons: "",
      fileName: "", mainMaxFile: "", description: "", tags: "", creditPrice: "", sizeText: "",
    },
  }, { upsert: true, new: true, setDefaultsOnInsert: true });
  return {
    model,
    action: existing?._id ? "updated" : "created",
    changed: existing?.driveSignature !== signature,
    scannedFiles: files.length,
    previewCount: previews.length,
    metadataError: syncError,
  };
}

export async function writeMarketplaceModelMetadata(model, rawMetadata, expected = {}) {
  if (!model?.driveFolderId) {
    const error = new Error("Model does not have a Google Drive folder.");
    error.status = 400;
    throw error;
  }
  const files = await listGoogleDriveFolderFiles(model.driveFolderId);
  const metadataFile = pickMetadata(files);
  let current = { document: null, metadata: null, hash: "", errors: [] };
  if (metadataFile) current = await readMarketplaceDriveMetadata(metadataFile, {
    assetType: model.assetType || "model",
    sourceAssetId: model.source?.assetId || model.metadataSourceModelId || model.driveFolderName || model.slug,
    sourceModelId: model.metadataSourceModelId || model.driveFolderName || model.slug,
    title: model.title,
    sourceCategoryId: model.categorySourceId,
    accessType: model.accessType,
    renderer: model.renderer,
    styles: model.styles,
    renderers: model.renderers,
    forms: model.forms,
    colors: model.colors,
    materials: model.materials,
    sha256: model.sha256,
  });
  const currentVersion = String(metadataFile?.version || "");
  const expectedHash = String(expected.metadataHash || "");
  const expectedVersion = String(expected.driveVersion || "");
  if ((expectedHash && expectedHash !== current.hash) || (expectedVersion && expectedVersion !== currentVersion)) {
    const error = new Error("Drive metadata changed after the model was opened.");
    error.status = 409;
    error.code = "METADATA_CONFLICT";
    error.current = { metadata: current.metadata, metadataHash: current.hash, driveVersion: currentVersion };
    error.diff = marketplaceMetadataDiff(rawMetadata, current.metadata || {});
    throw error;
  }
  if (metadataFile && (!expectedHash || !expectedVersion)) {
    const error = new Error("Expected metadata hash and Drive version are required.");
    error.status = 409;
    error.code = "METADATA_CONFLICT";
    error.current = { metadata: current.metadata, metadataHash: current.hash, driveVersion: currentVersion };
    error.diff = marketplaceMetadataDiff(rawMetadata, current.metadata || {});
    throw error;
  }
  const sourceAssetId = expected.allowSourceModelIdChange
    ? rawMetadata.sourceAssetId || rawMetadata.sourceModelId
    : current.metadata?.sourceAssetId || current.metadata?.sourceModelId || model.source?.assetId || model.metadataSourceModelId || sourceIdFromName(model.driveFolderName, model.slug);
  const { document, errors } = marketplaceMetadataDocument({ ...rawMetadata, assetType: model.assetType || "model", sourceAssetId, sourceModelId: sourceAssetId }, {
    revision: Math.max(0, Number(current.document?.revision || model.metadataRevision || 0)) + 1,
    updatedAt: new Date(),
  });
  if (errors.length) {
    const error = new Error("Marketplace metadata is invalid.");
    error.status = 400;
    error.code = "METADATA_INVALID";
    error.details = errors;
    throw error;
  }
  const taxonomy = await validateMarketplaceTaxonomy(document);
  if (taxonomy.errors.length) {
    const error = new Error("Marketplace taxonomy is invalid.");
    error.status = 400;
    error.code = "METADATA_INVALID";
    error.details = taxonomy.errors;
    throw error;
  }
  const category = await categoryFields(document.sourceCategoryId, model.assetType);
  if (!category.categorySourceId) {
    const error = new Error("Marketplace category must be an existing leaf category.");
    error.status = 400;
    error.code = "METADATA_INVALID";
    error.details = [{ field: "sourceCategoryId", code: "invalid_leaf" }];
    throw error;
  }
  const serialized = Buffer.from(serializeMarketplaceMetadata(document));
  if (serialized.length > MARKETPLACE_METADATA_MAX_BYTES) {
    const error = new Error("Marketplace metadata is too large.");
    error.status = 413;
    throw error;
  }
  const compressed = zlib.gzipSync(serialized, { level: 9 });
  const written = metadataFile
    ? await updateGoogleDriveFileContent(metadataFile.id, compressed, { contentType: "application/gzip" })
    : await createGoogleDriveFile({
      folderId: model.driveFolderId,
      fileName: "metadata.json.gz",
      content: compressed,
      contentType: "application/gzip",
    });
  const confirmed = await readMarketplaceDriveMetadata({ ...written, name: written.name || "metadata.json.gz" });
  const expectedWrittenHash = marketplaceMetadataHash(document);
  if (confirmed.hash !== expectedWrittenHash) {
    const error = new Error("Google Drive metadata verification failed.");
    error.status = 502;
    throw error;
  }
  const synced = await syncMarketplaceDriveFolder({ driveFolderId: model.driveFolderId, force: true, assetType: model.assetType });
  return { ...synced, metadata: document, metadataHash: confirmed.hash, driveVersion: String(written.version || "") };
}

export async function inspectMarketplaceModelMetadata(model) {
  if (!model?.driveFolderId) {
    const error = new Error("Model does not have a Google Drive folder.");
    error.status = 400;
    throw error;
  }
  const files = await listGoogleDriveFolderFiles(model.driveFolderId);
  const metadataFile = pickMetadata(files);
  const current = metadataFile
    ? await readMarketplaceDriveMetadata(metadataFile, metadataFromMarketplaceModel(model))
    : { document: null, metadata: null, hash: "", errors: [] };
  const desired = metadataFromMarketplaceModel(model);
  const { document, errors } = marketplaceMetadataDocument(desired, {
    revision: Math.max(0, Number(current.document?.revision || model.metadataRevision || 0)) + 1,
    updatedAt: new Date(),
  });
  return {
    metadataFile,
    current,
    desired,
    desiredDocument: document,
    errors,
    diff: marketplaceMetadataDiff(current.metadata || {}, desired),
  };
}

export async function markMarketplaceDriveModelMissing(model, reason = "drive_item_removed") {
  if (!model?._id) return null;
  return MarketplaceModel.findByIdAndUpdate(model._id, {
    $set: {
      isPublished: false,
      fileStatus: "missing",
      storageProvider: "",
      driveFileId: "",
      fileSize: 0,
      coverImage: {},
      previewImages: [],
      metadataDriveFileId: "",
      metadataFileName: "",
      metadataSize: 0,
      metadataHash: "",
      metadataDriveVersion: "",
      metadataModifiedTime: null,
      metadataStatus: "incomplete",
      syncStatus: "missing",
      syncError: clean(reason, 500),
      publicationBlockers: [...new Set([...(model.publicationBlockers || []), "archive", "cover", "metadata_file"])],
      lastDriveChangeAt: new Date(),
    },
  }, { new: true });
}
