import MarketplaceModel from "../models/MarketplaceModel.js";
import { normalizeAssetType } from "../data/marketplaceCatalogs.js";
import { listGoogleDriveFolderPage } from "./storageProvider.js";
import { syncMarketplaceDriveFolder } from "./marketplaceDriveService.js";

function isDriveFolder(file) {
  return file?.mimeType === "application/vnd.google-apps.folder";
}

export async function scanMarketplaceDriveFolderBatch({
  rootFolderId,
  assetType = "model",
  pageToken = "",
  limit = 100,
  isPublished = true,
} = {}) {
  const normalizedType = normalizeAssetType(assetType);
  const safeLimit = Math.min(200, Math.max(1, Number(limit || 100)));
  const page = await listGoogleDriveFolderPage(rootFolderId, {
    pageToken,
    pageSize: safeLimit,
  });
  const folders = page.files.filter(isDriveFolder);
  const imported = [];
  const skipped = [];
  let createdCount = 0;
  let updatedCount = 0;
  let unchangedCount = 0;
  for (const folder of folders) {
    try {
      const result = await syncMarketplaceDriveFolder({
        driveFolderId: folder.id,
        folderSnapshot: folder,
        force: false,
        assetType: normalizedType,
      });
      if (isPublished === false && result.model?.desiredPublished !== false) {
        result.model = await MarketplaceModel.findByIdAndUpdate(result.model._id, {
          $set: { desiredPublished: false, isPublished: false },
        }, { new: true });
      }
      if (result.action === "created") createdCount += 1;
      else if (result.action === "unchanged") unchangedCount += 1;
      else updatedCount += 1;
      imported.push({
        id: result.model?._id,
        action: result.action,
        title: result.model?.title,
        catalogKey: result.model?.slug,
        fileStatus: result.model?.fileStatus,
        coverFileName: result.model?.coverImage?.fileName || "",
        previewCount: result.model?.previewImages?.length || 0,
        metadataStatus: result.model?.metadataStatus,
        missingFields: result.model?.metadataMissingFields || [],
        metadataFileName: result.model?.metadataFileName || "",
        metadataError: result.metadataError || "",
      });
    } catch (error) {
      skipped.push({
        folderId: folder.id,
        folderName: folder.name,
        reason: error?.message || "sync_failed",
      });
    }
  }
  return {
    rootFolderId,
    nextPageToken: page.nextPageToken || "",
    hasMore: Boolean(page.nextPageToken),
    scannedFolders: folders.length,
    importedCount: imported.length,
    createdCount,
    updatedCount,
    unchangedCount,
    failedCount: skipped.length,
    skipped,
    imported,
  };
}
