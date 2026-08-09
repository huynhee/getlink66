import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

function localRoot() {
  return String(process.env.MARKETPLACE_LOCAL_STORAGE_ROOT || "").trim();
}

function assertInsideRoot(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (!resolvedTarget.startsWith(resolvedRoot + path.sep) && resolvedTarget !== resolvedRoot) {
    const error = new Error("Invalid local storage path");
    error.status = 400;
    throw error;
  }
  return resolvedTarget;
}

function googleDriveToken() {
  return String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN || process.env.GOOGLE_DRIVE_BEARER_TOKEN || "").trim();
}

let cachedGoogleDriveToken = "";
let cachedGoogleDriveTokenExpiresAt = 0;
let googleDriveRefreshPromise = null;

function googleDriveRefreshConfig() {
  return {
    clientId: String(process.env.GOOGLE_DRIVE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.GOOGLE_DRIVE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || "").trim(),
    refreshToken: String(process.env.GOOGLE_DRIVE_REFRESH_TOKEN || "").trim(),
  };
}

function hasGoogleDriveRefreshConfig() {
  const config = googleDriveRefreshConfig();
  return Boolean(config.clientId && config.clientSecret && config.refreshToken);
}

export function getGoogleDriveAuthStatus() {
  const config = googleDriveRefreshConfig();
  const staticAccessToken = googleDriveToken();
  const automaticRefresh = Boolean(config.clientId && config.clientSecret && config.refreshToken);
  return {
    mode: automaticRefresh ? "oauth_refresh" : staticAccessToken ? "static_access_token" : "missing",
    automaticRefresh,
    hasClientCredentials: Boolean(config.clientId && config.clientSecret),
    hasRefreshToken: Boolean(config.refreshToken),
    hasStaticAccessToken: Boolean(staticAccessToken),
  };
}

async function refreshGoogleDriveToken({ force = false } = {}) {
  if (!hasGoogleDriveRefreshConfig()) return "";
  if (!force && cachedGoogleDriveToken && cachedGoogleDriveTokenExpiresAt > Date.now() + 60_000) {
    return cachedGoogleDriveToken;
  }
  if (googleDriveRefreshPromise) return googleDriveRefreshPromise;

  googleDriveRefreshPromise = (async () => {
    const config = googleDriveRefreshConfig();
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    });
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const responseText = await response.text();
    const payload = JSON.parse(responseText || "{}");
    if (!response.ok) {
      const reason = payload.error === "invalid_grant"
        ? "Refresh token không còn hợp lệ. Kiểm tra OAuth app đã ở In production rồi chạy npm run drive:auth."
        : (payload.error_description || payload.error || `HTTP ${response.status}`);
      const error = new Error(`Google Drive token refresh failed: ${reason}`);
      error.status = 502;
      error.code = "GOOGLE_DRIVE_TOKEN_REFRESH_FAILED";
      throw error;
    }
    const accessToken = String(payload.access_token || "").trim();
    if (!accessToken) {
      const error = new Error("Google Drive token refresh did not return an access token.");
      error.status = 502;
      throw error;
    }
    cachedGoogleDriveToken = accessToken;
    cachedGoogleDriveTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000;
    return cachedGoogleDriveToken;
  })();

  try {
    return await googleDriveRefreshPromise;
  } finally {
    googleDriveRefreshPromise = null;
  }
}

async function getGoogleDriveToken({ forceRefresh = false } = {}) {
  const refreshedToken = await refreshGoogleDriveToken({ force: forceRefresh });
  const token = refreshedToken || googleDriveToken();
  if (!token) {
    const error = new Error(
      "Google Drive storage provider requires GOOGLE_DRIVE_REFRESH_TOKEN credentials or GOOGLE_DRIVE_ACCESS_TOKEN.",
    );
    error.status = 501;
    throw error;
  }
  return token;
}

async function fetchGoogleDrive(url, options = {}) {
  async function run(forceRefresh = false) {
    const token = await getGoogleDriveToken({ forceRefresh });
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        authorization: `Bearer ${token}`,
      },
    });
  }

  let response = await run(false);
  if (response.status === 401 && hasGoogleDriveRefreshConfig()) {
    response = await run(true);
  }
  return response;
}

export function googleDriveWriteEnabled() {
  return String(process.env.MARKETPLACE_DRIVE_WRITE_ENABLED || "false").toLowerCase() === "true";
}

function assertGoogleDriveWriteEnabled() {
  if (googleDriveWriteEnabled()) return;
  const error = new Error("Marketplace Drive writes are disabled.");
  error.status = 503;
  throw error;
}

async function googleDriveJson(response, operation) {
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Google Drive ${operation} failed: ${response.status} ${text.slice(0, 240)}`);
    error.status = response.status === 404 ? 404 : response.status === 403 ? 403 : 502;
    throw error;
  }
  return JSON.parse(text || "{}");
}

function escapeDriveQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

export async function openGoogleDriveFileStream(fileId, fallbackFileName = "file") {
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) {
    const error = new Error("Google Drive driveFileId is required.");
    error.status = 400;
    throw error;
  }
  const response = await fetchGoogleDrive(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(normalizedFileId)}?alt=media&supportsAllDrives=true`,
  );
  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    const error = new Error(`Google Drive download failed: ${response.status} ${body.slice(0, 160)}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return {
    stream: Readable.fromWeb(response.body),
    contentLength: Number(response.headers.get("content-length") || 0),
    contentType: response.headers.get("content-type") || "",
    fileName: fallbackFileName || "file",
  };
}

export async function readGoogleDriveFileBuffer(fileId, options = {}) {
  const maxBytes = Math.min(20 * 1024 * 1024, Math.max(1, Number(options.maxBytes || 5 * 1024 * 1024)));
  const file = await openGoogleDriveFileStream(fileId, options.fileName || "file");
  const chunks = [];
  let total = 0;
  for await (const chunk of file.stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) {
      const error = new Error(`Google Drive file is too large to read into memory. Max ${maxBytes} bytes.`);
      error.status = 413;
      throw error;
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function normalizeGoogleDriveListFields(value) {
  const fields = String(value || "").trim();
  if (!fields) {
    return "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height),modifiedTime,version,parents,trashed,driveId)";
  }
  if (/(?:^|,)\s*files\s*\(/.test(fields)) return fields;
  return `nextPageToken,files(${fields})`;
}

export async function listGoogleDriveFolderPage(folderId, options = {}) {
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) {
    const error = new Error("Google Drive folderId is required.");
    error.status = 400;
    throw error;
  }

  const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize || 200)));
  const fields = normalizeGoogleDriveListFields(options.fields);
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${escapeDriveQueryValue(normalizedFolderId)}' in parents and trashed=false`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("pageSize", String(pageSize));
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("orderBy", "folder,name_natural");
  if (options.pageToken) url.searchParams.set("pageToken", String(options.pageToken));

  const response = await fetchGoogleDrive(url);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Google Drive folder list failed: ${response.status} ${text.slice(0, 160)}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  const body = JSON.parse(text || "{}");
  return {
    files: body.files || [],
    nextPageToken: body.nextPageToken || "",
  };
}

export async function listGoogleDriveFolderFiles(folderId, options = {}) {
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) {
    const error = new Error("Google Drive folderId is required.");
    error.status = 400;
    throw error;
  }

  const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize || 200)));
  const fields = options.fields ||
    "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height),modifiedTime,version,parents,trashed,driveId)";
  const files = [];
  let pageToken = String(options.pageToken || "");
  do {
    const page = await listGoogleDriveFolderPage(normalizedFolderId, { ...options, pageSize, fields, pageToken });
    files.push(...page.files);
    pageToken = page.nextPageToken || "";
  } while (pageToken);

  return files;
}

export async function getGoogleDriveFileMetadata(fileId, options = {}) {
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) {
    const error = new Error("Google Drive fileId is required.");
    error.status = 400;
    throw error;
  }

  const fields = options.fields || "id,name,mimeType,size,imageMediaMetadata(width,height),modifiedTime,version,parents,trashed,driveId";
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(normalizedFileId)}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("supportsAllDrives", "true");

  const response = await fetchGoogleDrive(url);
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Google Drive file metadata failed: ${response.status} ${text.slice(0, 160)}`);
    error.status = response.status === 404 ? 404 : 502;
    throw error;
  }
  return JSON.parse(text || "{}");
}

export async function setGoogleDriveFileTrashed(fileId, trashed) {
  assertGoogleDriveWriteEnabled();
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) {
    const error = new Error("Google Drive fileId is required.");
    error.status = 400;
    throw error;
  }
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(normalizedFileId)}`);
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,mimeType,parents,trashed,modifiedTime,version,driveId");
  const response = await fetchGoogleDrive(url, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trashed: Boolean(trashed) }),
  });
  return googleDriveJson(response, trashed ? "move to trash" : "restore from trash");
}

export async function deleteGoogleDriveFile(fileId) {
  assertGoogleDriveWriteEnabled();
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) {
    const error = new Error("Google Drive fileId is required.");
    error.status = 400;
    throw error;
  }
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(normalizedFileId)}`);
  url.searchParams.set("supportsAllDrives", "true");
  const response = await fetchGoogleDrive(url, { method: "DELETE" });
  if (response.status === 404) return { deleted: true, missing: true };
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Google Drive permanent delete failed: ${response.status} ${text.slice(0, 240)}`);
    error.status = response.status === 403 ? 403 : 502;
    throw error;
  }
  return { deleted: true, missing: false };
}

export function marketplaceDownloadDeliveryMode() {
  const mode = String(process.env.MARKETPLACE_DOWNLOAD_DELIVERY || "proxy").trim().toLowerCase();
  return mode === "drive_redirect" ? "drive_redirect" : "proxy";
}

export async function getStorageBrowserDownloadLink(session) {
  if (marketplaceDownloadDeliveryMode() !== "drive_redirect") return "";
  if (String(session?.storageProvider || "").trim() !== "google_drive") return "";

  const metadata = await getGoogleDriveFileMetadata(session.driveFileId, {
    fields: "id,name,trashed,webContentLink,capabilities(canDownload),permissions(type,role)",
  });
  if (metadata.trashed) {
    const error = new Error("Stored file is no longer available.");
    error.status = 404;
    throw error;
  }
  if (metadata.capabilities?.canDownload === false) {
    const error = new Error("Google Drive has disabled downloads for this file.");
    error.status = 409;
    throw error;
  }

  const hasPublicReader = (metadata.permissions || []).some((permission) => (
    permission?.type === "anyone" && ["reader", "commenter", "writer", "owner"].includes(permission?.role)
  ));
  if (!hasPublicReader) {
    const error = new Error("Google Drive archive is not shared with anyone who has the link.");
    error.status = 409;
    error.code = "DRIVE_PUBLIC_DOWNLOAD_REQUIRED";
    throw error;
  }

  const downloadUrl = String(metadata.webContentLink || "").trim();
  if (!downloadUrl) {
    const error = new Error("Google Drive did not return a browser download link.");
    error.status = 409;
    error.code = "DRIVE_BROWSER_DOWNLOAD_UNAVAILABLE";
    throw error;
  }
  return downloadUrl;
}

export async function updateGoogleDriveFileContent(fileId, content, options = {}) {
  assertGoogleDriveWriteEnabled();
  const normalizedFileId = String(fileId || "").trim();
  if (!normalizedFileId) {
    const error = new Error("Google Drive fileId is required for update.");
    error.status = 400;
    throw error;
  }
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const url = new URL(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(normalizedFileId)}`);
  url.searchParams.set("uploadType", "media");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,version,parents,driveId");
  const response = await fetchGoogleDrive(url, {
    method: "PATCH",
    headers: { "content-type": options.contentType || "application/octet-stream" },
    body,
  });
  return googleDriveJson(response, "file update");
}

export async function createGoogleDriveFile({ folderId, fileName, content, contentType } = {}) {
  assertGoogleDriveWriteEnabled();
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) {
    const error = new Error("Google Drive parent folderId is required.");
    error.status = 400;
    throw error;
  }
  const boundary = `codex-${crypto.randomBytes(12).toString("hex")}`;
  const media = Buffer.isBuffer(content) ? content : Buffer.from(content || "");
  const metadata = Buffer.from(JSON.stringify({
    name: String(fileName || "metadata.json.gz").trim() || "metadata.json.gz",
    parents: [normalizedFolderId],
  }));
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
    metadata,
    Buffer.from(`\r\n--${boundary}\r\nContent-Type: ${contentType || "application/octet-stream"}\r\n\r\n`),
    media,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const url = new URL("https://www.googleapis.com/upload/drive/v3/files");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,version,parents,driveId");
  const response = await fetchGoogleDrive(url, {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body,
  });
  return googleDriveJson(response, "file create");
}

export async function createGoogleDriveFileFromPath({
  folderId,
  fileName,
  filePath,
  contentType = "application/octet-stream",
} = {}) {
  assertGoogleDriveWriteEnabled();
  const normalizedFolderId = String(folderId || "").trim();
  const normalizedPath = path.resolve(String(filePath || ""));
  if (!normalizedFolderId || !filePath || !fs.existsSync(normalizedPath)) {
    const error = new Error("Google Drive parent folder and existing local file are required.");
    error.status = 400;
    throw error;
  }
  const size = fs.statSync(normalizedPath).size;
  const sessionUrl = new URL("https://www.googleapis.com/upload/drive/v3/files");
  sessionUrl.searchParams.set("uploadType", "resumable");
  sessionUrl.searchParams.set("supportsAllDrives", "true");
  sessionUrl.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,version,parents,driveId");
  const sessionResponse = await fetchGoogleDrive(sessionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-upload-content-type": contentType,
      "x-upload-content-length": String(size),
    },
    body: JSON.stringify({
      name: String(fileName || path.basename(normalizedPath)).trim(),
      parents: [normalizedFolderId],
    }),
  });
  if (!sessionResponse.ok) return googleDriveJson(sessionResponse, "resumable upload session");
  const uploadUrl = sessionResponse.headers.get("location");
  if (!uploadUrl) throw new Error("Google Drive did not return a resumable upload URL.");
  const uploadResponse = await fetchGoogleDrive(uploadUrl, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "content-length": String(size),
    },
    body: fs.createReadStream(normalizedPath),
    duplex: "half",
  });
  return googleDriveJson(uploadResponse, "resumable file upload");
}

export async function downloadGoogleDriveFileToPath(fileId, targetPath) {
  const normalizedTarget = path.resolve(String(targetPath || ""));
  if (!targetPath) throw new Error("Download target path is required.");
  await fs.promises.mkdir(path.dirname(normalizedTarget), { recursive: true });
  const file = await openGoogleDriveFileStream(fileId, path.basename(normalizedTarget));
  await pipeline(file.stream, fs.createWriteStream(normalizedTarget, { flags: "wx" }));
  return {
    filePath: normalizedTarget,
    size: fs.statSync(normalizedTarget).size,
    contentType: file.contentType,
  };
}

export async function createGoogleDriveFolder({ parentFolderId, name } = {}) {
  assertGoogleDriveWriteEnabled();
  const parentId = String(parentFolderId || "").trim();
  const folderName = String(name || "").trim();
  if (!parentId || !folderName) {
    const error = new Error("Google Drive parent folder and name are required.");
    error.status = 400;
    throw error;
  }
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("fields", "id,name,mimeType,parents,driveId");
  const response = await fetchGoogleDrive(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  return googleDriveJson(response, "folder create");
}

export async function ensureGoogleDriveFolderPath(rootFolderId, segments = []) {
  let parentId = String(rootFolderId || "").trim();
  if (!parentId) throw new Error("HISTORY_ARCHIVE_DRIVE_FOLDER_ID is required.");
  for (const rawSegment of segments) {
    const name = String(rawSegment || "").trim();
    if (!name) continue;
    const files = await listGoogleDriveFolderFiles(parentId, {
      fields: "id,name,mimeType,parents,trashed",
      pageSize: 1000,
    });
    const existing = files.find((file) =>
      file.mimeType === "application/vnd.google-apps.folder" && file.name === name && !file.trashed,
    );
    parentId = existing?.id || (await createGoogleDriveFolder({ parentFolderId: parentId, name })).id;
  }
  return parentId;
}

export async function getGoogleDriveStartPageToken(options = {}) {
  const url = new URL("https://www.googleapis.com/drive/v3/changes/startPageToken");
  url.searchParams.set("supportsAllDrives", "true");
  if (options.driveId) url.searchParams.set("driveId", String(options.driveId));
  const response = await fetchGoogleDrive(url);
  const payload = await googleDriveJson(response, "changes start token");
  return String(payload.startPageToken || "");
}

export async function listGoogleDriveChanges(pageToken, options = {}) {
  const token = String(pageToken || "").trim();
  if (!token) {
    const error = new Error("Google Drive changes pageToken is required.");
    error.status = 400;
    throw error;
  }
  const url = new URL("https://www.googleapis.com/drive/v3/changes");
  url.searchParams.set("pageToken", token);
  url.searchParams.set("pageSize", String(Math.min(1000, Math.max(1, Number(options.pageSize || 100)))));
  url.searchParams.set("includeRemoved", "true");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  url.searchParams.set("spaces", "drive");
  url.searchParams.set(
    "fields",
    "nextPageToken,newStartPageToken,changes(fileId,removed,time,changeType,driveId,file(id,name,mimeType,size,modifiedTime,version,parents,trashed,driveId))",
  );
  if (options.driveId) url.searchParams.set("driveId", String(options.driveId));
  const response = await fetchGoogleDrive(url);
  return googleDriveJson(response, "changes list");
}

export async function openStorageStream(session) {
  const provider = String(session.storageProvider || "").trim();
  if (provider === "local") {
    const root = localRoot();
    if (!root) {
      const error = new Error("MARKETPLACE_LOCAL_STORAGE_ROOT is not configured.");
      error.status = 500;
      throw error;
    }
    const target = assertInsideRoot(root, path.join(root, session.storageKey || ""));
    if (!fs.existsSync(target)) {
      const error = new Error("Stored file not found.");
      error.status = 404;
      throw error;
    }
    return {
      stream: fs.createReadStream(target),
      contentLength: fs.statSync(target).size,
      fileName: session.fileName || path.basename(target),
    };
  }

  if (provider === "google_drive") {
    const file = await openGoogleDriveFileStream(session.driveFileId, session.fileName || "model.zip");
    return {
      ...file,
      contentLength: file.contentLength || Number(session.fileSize || 0),
      fileName: session.fileName || file.fileName || "model.zip",
    };
  }

  const error = new Error(`Unsupported storage provider: ${provider || "empty"}`);
  error.status = 501;
  throw error;
}
