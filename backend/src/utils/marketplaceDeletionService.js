import DownloadSession from "../models/DownloadSession.js";
import MarketplaceModel from "../models/MarketplaceModel.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { deleteGoogleDriveFile, setGoogleDriveFileTrashed } from "./storageProvider.js";
import { syncMarketplaceDriveFolder } from "./marketplaceDriveService.js";
import { removeMarketplaceCoverCache } from "./marketplaceCoverCache.js";

const TRASH_STATUSES = ["deleting", "trashed", "delete_error", "purging", "purge_error"];

function cleanError(error) {
  return String(error?.message || error || "marketplace_delete_failed").slice(0, 500);
}

export function marketplaceTrashRetentionDays() {
  const value = Number(process.env.MARKETPLACE_TRASH_RETENTION_DAYS || 30);
  return Math.min(365, Math.max(1, Number.isFinite(value) ? Math.floor(value) : 30));
}

export function marketplaceActiveDeletionQuery() {
  return { $or: [{ deletionStatus: "active" }, { deletionStatus: { $exists: false } }] };
}

export function marketplacePublicDeletionQuery() {
  return { deletionStatus: { $nin: [...TRASH_STATUSES, "purged"] } };
}

export function marketplaceTrashDeletionQuery() {
  return { deletionStatus: { $in: TRASH_STATUSES } };
}

export function isMarketplaceAssetDeleted(model) {
  return Boolean(model?.deletionStatus && model.deletionStatus !== "active");
}

export async function trashMarketplaceAsset(model) {
  const now = new Date();
  const purgeAt = new Date(now.getTime() + marketplaceTrashRetentionDays() * 24 * 60 * 60 * 1000);
  const restoreDesiredPublished = model.deletedAt
    ? Boolean(model.restoreDesiredPublished)
    : Boolean(model.desiredPublished ?? model.isPublished);
  const hidden = await MarketplaceModel.findByIdAndUpdate(model._id, {
    $set: {
      deletionStatus: "deleting",
      deletedAt: model.deletedAt || now,
      purgeAt,
      deletionError: "",
      restoreDesiredPublished,
      desiredPublished: false,
      isPublished: false,
      discoveryStatus: "pending",
      searchStatus: "pending",
    },
  }, { new: true });

  await DownloadSession.updateMany(
    { modelId: model._id, status: "active" },
    { $set: { status: "revoked" } },
  );
  await removeMarketplaceCoverCache(hidden);

  try {
    if (!hidden?.driveFolderId) {
      const error = new Error("Marketplace asset does not have a Google Drive folder.");
      error.status = 409;
      error.code = "DRIVE_FOLDER_NOT_ATTACHED";
      throw error;
    }
    await setGoogleDriveFileTrashed(hidden.driveFolderId, true);
    return MarketplaceModel.findByIdAndUpdate(hidden._id, {
      $set: { deletionStatus: "trashed", deletionError: "" },
    }, { new: true });
  } catch (error) {
    await MarketplaceModel.findByIdAndUpdate(hidden._id, {
      $set: { deletionStatus: "delete_error", deletionError: cleanError(error) },
    });
    throw error;
  }
}

export async function restoreMarketplaceAsset(model) {
  if (model.deletionStatus === "purged") {
    const error = new Error("This marketplace asset has already been permanently deleted.");
    error.status = 409;
    error.code = "MARKETPLACE_ASSET_PURGED";
    throw error;
  }
  if (!model.driveFolderId) {
    const error = new Error("Marketplace asset does not have a restorable Google Drive folder.");
    error.status = 409;
    error.code = "DRIVE_FOLDER_NOT_ATTACHED";
    throw error;
  }

  try {
    const folder = await setGoogleDriveFileTrashed(model.driveFolderId, false);
    const desiredPublished = Boolean(model.restoreDesiredPublished);
    await MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: {
        deletionStatus: "active",
        deletionError: "",
        desiredPublished,
        isPublished: false,
      },
      $unset: { deletedAt: "", purgeAt: "", purgedAt: "" },
    });
    const result = await syncMarketplaceDriveFolder({
      driveFolderId: model.driveFolderId,
      folderSnapshot: folder,
      force: true,
      assetType: normalizeAssetType(model.assetType),
    });
    return MarketplaceModel.findByIdAndUpdate(result.model._id, {
      $set: { deletionStatus: "active", deletionError: "" },
      $unset: { deletedAt: "", purgeAt: "", purgedAt: "" },
    }, { new: true });
  } catch (error) {
    await MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: {
        deletionStatus: "delete_error",
        deletionError: cleanError(error),
        desiredPublished: false,
        isPublished: false,
      },
    });
    throw error;
  }
}

export async function permanentlyDeleteMarketplaceAsset(model) {
  if (model.deletionStatus === "active" || !model.deletionStatus) {
    const error = new Error("Move the marketplace asset to trash before deleting it permanently.");
    error.status = 409;
    error.code = "MARKETPLACE_ASSET_NOT_TRASHED";
    throw error;
  }
  if (model.deletionStatus === "purged") return model;

  await MarketplaceModel.findByIdAndUpdate(model._id, {
    $set: { deletionStatus: "purging", deletionError: "", isPublished: false, desiredPublished: false },
  });
  try {
    await removeMarketplaceCoverCache(model);
    if (model.driveFolderId) await deleteGoogleDriveFile(model.driveFolderId);
    const assetId = String(model.source?.assetId || model.metadataSourceModelId || model._id);
    return MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: {
        deletionStatus: "purged",
        purgedAt: new Date(),
        deletionError: "",
        isPublished: false,
        desiredPublished: false,
        fileStatus: "missing",
        storageProvider: "",
        fileSize: 0,
        coverImage: {},
        previewImages: [],
        coverCache: { status: "missing" },
        source: {
          // Keep the original provider + assetId unique key reserved so a
          // reconciler cannot recreate a permanently deleted catalog item.
          provider: String(model.source?.provider || "drive"),
          modelId: `purged:${assetId}`,
          assetId,
          slug: "",
          categoryId: "",
          syncedAt: new Date(),
        },
        syncStatus: "missing",
        syncError: "",
        publicationBlockers: ["deleted"],
        discoveryStatus: "pending",
        searchStatus: "pending",
        searchTitle: "",
        searchTaxonomy: "",
        searchTokens: [],
      },
      $unset: {
        purgeAt: "",
        driveFolderId: "",
        driveFolderName: "",
        driveSignature: "",
        driveFileId: "",
        storageKey: "",
        telegramFileRef: "",
        sha256: "",
        metadataDriveFileId: "",
        metadataFileName: "",
        metadataSize: "",
        metadataHash: "",
        metadataDriveVersion: "",
        metadataModifiedTime: "",
      },
    }, { new: true });
  } catch (error) {
    await MarketplaceModel.findByIdAndUpdate(model._id, {
      $set: { deletionStatus: "purge_error", deletionError: cleanError(error) },
    });
    throw error;
  }
}
