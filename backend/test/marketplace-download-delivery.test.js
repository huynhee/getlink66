import assert from "node:assert/strict";
import test from "node:test";
import {
  getStorageBrowserDownloadLink,
  marketplaceDownloadDeliveryMode,
  openGoogleDriveFileStream,
} from "../src/utils/storageProvider.js";

test("marketplace downloads remain proxied unless Drive redirect is enabled", async () => {
  const originalMode = process.env.MARKETPLACE_DOWNLOAD_DELIVERY;
  try {
    process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "proxy";
    assert.equal(marketplaceDownloadDeliveryMode(), "proxy");
    assert.equal(await getStorageBrowserDownloadLink({ storageProvider: "google_drive", driveFileId: "file-1" }), "");
  } finally {
    if (originalMode === undefined) delete process.env.MARKETPLACE_DOWNLOAD_DELIVERY;
    else process.env.MARKETPLACE_DOWNLOAD_DELIVERY = originalMode;
  }
});

test("Drive redirect resolves the browser content link without streaming file bytes", async () => {
  const original = {
    mode: process.env.MARKETPLACE_DOWNLOAD_DELIVERY,
    accessToken: process.env.GOOGLE_DRIVE_ACCESS_TOKEN,
    bearerToken: process.env.GOOGLE_DRIVE_BEARER_TOKEN,
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    fetch: global.fetch,
  };
  try {
    process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "drive_redirect";
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "test-access-token";
    delete process.env.GOOGLE_DRIVE_BEARER_TOKEN;
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    global.fetch = async (url, options) => {
      assert.match(String(url), /\/drive\/v3\/files\/drive-file-1/);
      assert.equal(options.headers.authorization, "Bearer test-access-token");
      return new Response(JSON.stringify({
        id: "drive-file-1",
        name: "model.zip",
        trashed: false,
        resourceKey: "resource-key-1",
        capabilities: { canDownload: true },
        permissions: [{ type: "anyone", role: "reader" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const link = await getStorageBrowserDownloadLink({
      storageProvider: "google_drive",
      driveFileId: "drive-file-1",
    });
    const url = new URL(link);
    assert.equal(url.origin, "https://drive.usercontent.google.com");
    assert.equal(url.pathname, "/download");
    assert.equal(url.searchParams.get("id"), "drive-file-1");
    assert.equal(url.searchParams.get("export"), "download");
    assert.equal(url.searchParams.get("authuser"), "0");
    assert.equal(url.searchParams.get("confirm"), "t");
    assert.equal(url.searchParams.get("resourcekey"), "resource-key-1");
  } finally {
    const envMap = {
      MARKETPLACE_DOWNLOAD_DELIVERY: original.mode,
      GOOGLE_DRIVE_ACCESS_TOKEN: original.accessToken,
      GOOGLE_DRIVE_BEARER_TOKEN: original.bearerToken,
      GOOGLE_DRIVE_CLIENT_ID: original.clientId,
      GOOGLE_DRIVE_CLIENT_SECRET: original.clientSecret,
      GOOGLE_DRIVE_REFRESH_TOKEN: original.refreshToken,
    };
    for (const [key, value] of Object.entries(envMap)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = original.fetch;
  }
});

test("plugin downloads never expose a Google Drive redirect", async () => {
  const originalMode = process.env.MARKETPLACE_DOWNLOAD_DELIVERY;
  try {
    process.env.MARKETPLACE_DOWNLOAD_DELIVERY = "drive_redirect";
    const link = await getStorageBrowserDownloadLink({
      clientType: "plugin",
      storageProvider: "google_drive",
      driveFileId: "must-not-be-resolved",
    });
    assert.equal(link, "");
  } finally {
    if (originalMode === undefined) delete process.env.MARKETPLACE_DOWNLOAD_DELIVERY;
    else process.env.MARKETPLACE_DOWNLOAD_DELIVERY = originalMode;
  }
});

test("Google Drive proxy forwards a single byte range and preserves partial response headers", async () => {
  const original = {
    accessToken: process.env.GOOGLE_DRIVE_ACCESS_TOKEN,
    bearerToken: process.env.GOOGLE_DRIVE_BEARER_TOKEN,
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
    refreshToken: process.env.GOOGLE_DRIVE_REFRESH_TOKEN,
    fetch: global.fetch,
  };
  try {
    process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "test-access-token";
    delete process.env.GOOGLE_DRIVE_BEARER_TOKEN;
    delete process.env.GOOGLE_DRIVE_CLIENT_ID;
    delete process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    delete process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    global.fetch = async (url, options) => {
      assert.match(String(url), /alt=media/);
      assert.equal(options.headers.authorization, "Bearer test-access-token");
      assert.equal(options.headers.range, "bytes=100-199");
      return new Response(Buffer.alloc(100), {
        status: 206,
        headers: {
          "accept-ranges": "bytes",
          "content-length": "100",
          "content-range": "bytes 100-199/1000",
        },
      });
    };

    const file = await openGoogleDriveFileStream("drive-file-1", "model.zip", {
      range: "bytes=100-199",
    });
    assert.equal(file.statusCode, 206);
    assert.equal(file.contentLength, 100);
    assert.equal(file.contentRange, "bytes 100-199/1000");
    assert.equal(file.acceptRanges, "bytes");
    file.stream.destroy();
  } finally {
    const envMap = {
      GOOGLE_DRIVE_ACCESS_TOKEN: original.accessToken,
      GOOGLE_DRIVE_BEARER_TOKEN: original.bearerToken,
      GOOGLE_DRIVE_CLIENT_ID: original.clientId,
      GOOGLE_DRIVE_CLIENT_SECRET: original.clientSecret,
      GOOGLE_DRIVE_REFRESH_TOKEN: original.refreshToken,
    };
    for (const [key, value] of Object.entries(envMap)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    global.fetch = original.fetch;
  }
});
