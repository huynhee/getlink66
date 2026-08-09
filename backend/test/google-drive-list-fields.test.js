import assert from "node:assert/strict";
import test from "node:test";
import { listGoogleDriveFolderFiles } from "../src/utils/storageProvider.js";

const DRIVE_ENV_KEYS = [
  "GOOGLE_DRIVE_CLIENT_ID",
  "GOOGLE_DRIVE_CLIENT_SECRET",
  "GOOGLE_DRIVE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_ACCESS_TOKEN",
  "GOOGLE_DRIVE_BEARER_TOKEN",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
];

test("Drive folder lists wrap item fields in the files collection selector", async () => {
  const previousEnv = Object.fromEntries(DRIVE_ENV_KEYS.map((key) => [key, process.env[key]]));
  const previousFetch = global.fetch;
  DRIVE_ENV_KEYS.forEach((key) => delete process.env[key]);
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "test-access-token";

  try {
    global.fetch = async (input, options = {}) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("fields"), "nextPageToken,files(id,name,mimeType,parents,trashed)");
      assert.equal(options.headers.authorization, "Bearer test-access-token");
      return new Response(JSON.stringify({
        files: [{ id: "child-1", name: "database", mimeType: "application/vnd.google-apps.folder" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const files = await listGoogleDriveFolderFiles("backup-root", {
      fields: "id,name,mimeType,parents,trashed",
    });
    assert.equal(files.length, 1);
    assert.equal(files[0].id, "child-1");
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
