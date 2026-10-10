import assert from "node:assert/strict";
import { createServer } from "node:http";
import express from "express";
import test from "node:test";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
process.env.THREED66_MOCK = "true";
process.env.THREED66_PROXY_ENABLED = "false";
process.env.THREED66_REQUEST_INTERVAL_MS = "1";
process.env.DOWNLOAD_TOKEN_SECRET = "getlink-transfer-fixture-secret-at-least-32";

const { default: Cookie } = await import("../src/models/Cookie.js");
const { default: User } = await import("../src/models/User.js");
const { default: Getlink } = await import("../src/models/Getlink.js");
const { downloadGetlink } = await import("../src/controllers/getlinkController.js");
const { signDownloadToken } = await import("../src/utils/downloadToken.js");

test("concurrent HTTP ranges preserve file bytes, ownership, credit and one download session", async (t) => {
  const user = await User.create({ email: "transfer@example.test", credit: 100 });
  await Cookie.create({ value: "PHPSESSID=fixture; login_token=fixture; login_sign=fixture", isActive: true, status: "active" });
  const history = await Getlink.create({
    userId: user._id,
    productId: "fixture-transfer",
    fileUrl: "https://download.3d66.com/fixture.zip",
    sourceUrl: "https://3d.3d66.com/reshtmla/model/items/fixture/model.html?sof=ACH89635771442400&sign=fixture",
    creditUsed: 28,
  });
  const file = Buffer.alloc(32 * 1024);
  for (let i = 0; i < file.length; i += 1) file[i] = i % 251;
  const realFetch = globalThis.fetch;
  let sourceRequests = 0;
  t.mock.method(globalThis, "fetch", async (input, options = {}) => {
    if (String(input).startsWith("http://127.0.0.1:")) return realFetch(input, options);
    assert.equal(String(input), history.fileUrl);
    const headers = new Headers(options.headers);
    assert.equal(headers.get("accept-encoding"), "identity");
    const range = /^bytes=(\d+)-(\d+)$/.exec(headers.get("range"));
    assert.ok(range);
    assert.equal(headers.get("if-range"), '"fixture-v1"');
    const start = Number(range[1]);
    const end = Number(range[2]);
    sourceRequests += 1;
    const body = new ReadableStream({
      async start(stream) {
        await new Promise((resolve) => setTimeout(resolve, 40));
        stream.enqueue(file.subarray(start, end + 1));
        stream.close();
      },
    });
    return new Response(body, {
      status: 206,
      headers: {
        "content-type": "application/zip",
        "content-length": String(end - start + 1),
        "content-range": `bytes ${start}-${end}/${file.length}`,
        "accept-ranges": "bytes",
        etag: '"fixture-v1"',
      },
    });
  });

  const app = express();
  app.get("/download/:id", downloadGetlink);
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const url = `http://127.0.0.1:${server.address().port}/download/${history._id}`;
  const unauthorized = await realFetch(`${url}?t=invalid`);
  assert.equal(unauthorized.status, 403);
  await unauthorized.arrayBuffer();
  assert.equal(sourceRequests, 0);
  assert.equal((await Getlink.findById(history._id)).initialDownloadAt, undefined);

  const token = signDownloadToken(String(history._id), String(user._id));
  const pieces = await Promise.all(Array.from({ length: 4 }, async (_, i) => {
    const start = i * 8192;
    const end = start + 8191;
    const response = await realFetch(`${url}?t=${token}`, {
      headers: { range: `bytes=${start}-${end}`, "if-range": '"fixture-v1"' },
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get("content-range"), `bytes ${start}-${end}/${file.length}`);
    assert.equal(response.headers.get("etag"), '"fixture-v1"');
    assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
    assert.equal(response.headers.get("content-encoding"), null);
    return Buffer.from(await response.arrayBuffer());
  }));
  assert.deepEqual(Buffer.concat(pieces), file);
  assert.equal(sourceRequests, 4);
  const updated = await Getlink.findById(history._id);
  assert.ok(updated.initialDownloadAt);
  assert.equal(Number(updated.redownloadCount || 0), 0);
  assert.equal((await User.findById(user._id)).credit, 100);
  assert.equal(await Getlink.countDocuments({ userId: user._id }), 1);
});
