import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";

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

async function refreshGoogleDriveToken({ force = false } = {}) {
  if (!hasGoogleDriveRefreshConfig()) return "";
  if (!force && cachedGoogleDriveToken && cachedGoogleDriveTokenExpiresAt > Date.now() + 60_000) {
    return cachedGoogleDriveToken;
  }

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
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`Google Drive token refresh failed: ${response.status} ${text.slice(0, 160)}`);
    error.status = 502;
    throw error;
  }
  const payload = JSON.parse(text || "{}");
  const accessToken = String(payload.access_token || "").trim();
  if (!accessToken) {
    const error = new Error("Google Drive token refresh did not return an access token.");
    error.status = 502;
    throw error;
  }
  cachedGoogleDriveToken = accessToken;
  cachedGoogleDriveTokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 60) * 1000;
  return cachedGoogleDriveToken;
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

export async function listGoogleDriveFolderPage(folderId, options = {}) {
  const normalizedFolderId = String(folderId || "").trim();
  if (!normalizedFolderId) {
    const error = new Error("Google Drive folderId is required.");
    error.status = 400;
    throw error;
  }

  const pageSize = Math.min(1000, Math.max(1, Number(options.pageSize || 200)));
  const fields = options.fields ||
    "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height),modifiedTime)";
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
    "nextPageToken,files(id,name,mimeType,size,imageMediaMetadata(width,height),modifiedTime)";
  const files = [];
  let pageToken = String(options.pageToken || "");
  do {
    const page = await listGoogleDriveFolderPage(normalizedFolderId, { ...options, pageSize, fields, pageToken });
    files.push(...page.files);
    pageToken = page.nextPageToken || "";
  } while (pageToken);

  return files;
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
