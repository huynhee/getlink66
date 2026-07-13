import "dotenv/config";
import { getGoogleDriveAuthStatus, getGoogleDriveFileMetadata } from "../src/utils/storageProvider.js";

const status = getGoogleDriveAuthStatus();
const rootFolderId = String(process.env.MARKETPLACE_DRIVE_ROOT_FOLDER_ID || "").trim();

console.log(`Drive auth mode: ${status.mode}`);
console.log(`Automatic refresh: ${status.automaticRefresh ? "yes" : "no"}`);

if (!rootFolderId) {
  console.error("MARKETPLACE_DRIVE_ROOT_FOLDER_ID chưa được cấu hình.");
  process.exitCode = 1;
} else {
  try {
    const folder = await getGoogleDriveFileMetadata(rootFolderId, { fields: "id,name,mimeType,trashed" });
    console.log(`Root folder: ${folder.name || folder.id}`);
    console.log(`Drive API: ${folder.trashed ? "folder is trashed" : "ok"}`);
    if (folder.trashed) process.exitCode = 1;
  } catch (error) {
    console.error(`Drive API: failed (${error.message})`);
    process.exitCode = 1;
  }
}
