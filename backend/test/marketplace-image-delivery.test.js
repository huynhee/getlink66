import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { sendMarketplaceImage } from "../src/utils/marketplaceImageDelivery.js";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { default: MarketplaceModel } = await import("../src/models/MarketplaceModel.js");
const { streamMarketplacePreview, streamMarketplaceCover } = await import("../src/controllers/marketplaceController.js");

class ImageResponse extends EventEmitter {
  constructor() {
    super();
    this.headers = new Map();
    this.headersSent = false;
    this.destroyed = false;
    this.writableEnded = false;
    this.statusCode = 200;
  }
  setHeader(name, value) {
    assert.equal(this.headersSent, false);
    this.headers.set(name.toLowerCase(), String(value));
  }
  status(value) { this.statusCode = value; return this; }
  end(body) {
    this.headersSent = true;
    this.writableEnded = true;
    this.body = body;
    this.emit("finish");
    return this;
  }
}

const image = { driveFileId: "fixture-image", size: 99999 };
function file(body, contentLength = body.length) {
  return { stream: Readable.from([body]), contentLength, statusCode: 200 };
}
function send(res, openFile, options = {}, req = { fresh: false }) {
  return sendMarketplaceImage(req, res, image, "preview-02.jpg", "image/jpeg", { openFile, retryDelayMs: 0, ...options });
}

test("preview retries a mid-body termination without sending headers or corrupting the image", async () => {
  const res = new ImageResponse();
  const complete = Buffer.from("complete image");
  let requests = 0;
  await send(res, async () => {
    requests += 1;
    assert.equal(res.headersSent, false);
    assert.equal(res.headers.size, 0);
    if (requests === 1) {
      const stream = Readable.from((async function* () {
        yield Buffer.from("partial");
        throw Object.assign(new TypeError("terminated"), { cause: { code: "UND_ERR_SOCKET" } });
      })());
      return { stream, contentLength: complete.length };
    }
    return file(complete);
  });
  assert.equal(requests, 2);
  assert.deepEqual(res.body, complete);
  assert.equal(res.headers.get("content-length"), String(complete.length));
  assert.equal(res.headers.get("content-type"), "image/jpeg");
  assert.match(res.headers.get("etag"), /^"[0-9a-f]{64}"$/);
});

test("preview never caches a silently truncated response", async () => {
  const res = new ImageResponse();
  let requests = 0;
  await assert.rejects(send(res, async () => {
    requests += 1;
    return file(Buffer.from("short"), 100);
  }), { status: 502, code: "MARKETPLACE_IMAGE_SOURCE_UNAVAILABLE" });
  assert.equal(requests, 2);
  assert.equal(res.headersSent, false);
  assert.equal(res.headers.size, 0);
});

test("preview enforces its byte limit with or without Content-Length and closes the source", async () => {
  for (const contentLength of [6, 0]) {
    const res = new ImageResponse();
    const upstream = file(Buffer.alloc(6), contentLength);
    let requests = 0;
    await assert.rejects(send(res, async () => {
      requests += 1;
      return upstream;
    }, { maxBytes: 5 }), { status: 413, code: "MARKETPLACE_IMAGE_TOO_LARGE" });
    assert.equal(requests, 1);
    assert.equal(upstream.stream.destroyed, true);
    assert.equal(res.headers.size, 0);
  }
});

test("client disconnect cancels Drive reads without a retry or server error", async () => {
  const res = new ImageResponse();
  const stream = new PassThrough();
  let requests = 0;
  let signal;
  const transfer = send(res, async (_id, _name, options) => {
    requests += 1;
    signal = options.signal;
    return { stream, contentLength: 10 };
  });
  await new Promise((resolve) => setImmediate(resolve));
  stream.write("partial");
  res.destroyed = true;
  res.emit("close");
  await transfer;
  assert.equal(signal.aborted, true);
  assert.equal(stream.destroyed, true);
  assert.equal(requests, 1);
  assert.equal(res.headersSent, false);
  assert.equal(res.listenerCount("close"), 0);
});

test("client disconnect while Drive is opening closes a late stream without retrying", { timeout: 2000 }, async () => {
  const res = new ImageResponse();
  let completeOpen;
  let requests = 0;
  const transfer = send(res, () => {
    requests += 1;
    return new Promise((resolve) => { completeOpen = resolve; });
  });
  await new Promise((resolve) => setImmediate(resolve));
  res.destroyed = true;
  res.emit("close");
  await transfer;
  const lateFile = file(Buffer.from("late image"));
  completeOpen(lateFile);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateFile.stream.destroyed, true);
  assert.equal(requests, 1);
  assert.equal(res.headersSent, false);
  assert.equal(res.listenerCount("close"), 0);
});

test("preview does not fetch for an already disconnected client or retry a permanent Drive error", async () => {
  const res = new ImageResponse();
  res.destroyed = true;
  let requests = 0;
  const unavailable = async () => {
    requests += 1;
    throw Object.assign(new Error("Drive file not found"), { status: 404 });
  };
  await send(res, unavailable);
  assert.equal(requests, 0);
  await assert.rejects(send(new ImageResponse(), unavailable), { status: 404 });
  assert.equal(requests, 1);
});

test("preview timeout closes the source and returns 504 before sending headers", { timeout: 2000 }, async () => {
  const res = new ImageResponse();
  const streams = [];
  // Keep the test event loop alive while AbortSignal's unref'ed deadlines fire.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(send(res, async () => {
      const stream = new PassThrough();
      streams.push(stream);
      return { stream };
    }, { timeoutMs: 10 }), { status: 504, code: "MARKETPLACE_IMAGE_TIMEOUT" });
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(streams.length, 2);
  assert.ok(streams.every((stream) => stream.destroyed));
  assert.equal(res.headersSent, false);
});

test("preview deadline also covers opening Drive and closes streams that arrive after timeout", { timeout: 2000 }, async () => {
  const res = new ImageResponse();
  const opens = [];
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(send(res, () => new Promise((resolve) => {
      opens.push(resolve);
    }), { timeoutMs: 10 }), { status: 504, code: "MARKETPLACE_IMAGE_TIMEOUT" });
  } finally {
    clearInterval(keepAlive);
  }
  assert.equal(opens.length, 2);
  const lateFiles = opens.map((resolve) => {
    const lateFile = file(Buffer.from("late image"));
    resolve(lateFile);
    return lateFile;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(lateFiles.every((lateFile) => lateFile.stream.destroyed));
  assert.equal(res.headers.size, 0);
  assert.equal(res.listenerCount("close"), 0);
});

test("preview returns 304 only after a complete representation is available", async () => {
  const res = new ImageResponse();
  await send(res, async () => file(Buffer.from("unchanged")), {}, { fresh: true });
  assert.equal(res.statusCode, 304);
  assert.equal(res.body, undefined);
  assert.equal(res.headers.has("content-length"), false);
});

test("Model and Scene preview index 1 and uncached covers use complete-image delivery", async (t) => {
  const env = ["GOOGLE_DRIVE_ACCESS_TOKEN", "GOOGLE_DRIVE_REFRESH_TOKEN", "GOOGLE_DRIVE_BEARER_TOKEN", "MARKETPLACE_COVER_CACHE_ENABLED"];
  const previous = Object.fromEntries(env.map((key) => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.GOOGLE_DRIVE_ACCESS_TOKEN = "fixture-only-token";
  process.env.GOOGLE_DRIVE_REFRESH_TOKEN = "";
  process.env.GOOGLE_DRIVE_BEARER_TOKEN = "";
  process.env.MARKETPLACE_COVER_CACHE_ENABLED = "false";
  const body = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3, 0xff, 0xd9]);
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requested.push(new URL(url).pathname.split("/").at(-1));
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(body, { headers: { "content-type": "image/jpeg", "content-length": String(body.length) } });
  });
  for (const assetType of ["model", "scene"]) {
    const model = await MarketplaceModel.create({
      assetType, title: "Fixture preview", slug: `fixture-preview-${assetType}`,
      source: { provider: "drive", assetId: `fixture-${assetType}` },
      isPublished: true, metadataStatus: "complete", fileStatus: "ready", deletionStatus: "active",
      coverImage: { driveFileId: `${assetType}-cover`, fileName: "cover.jpg", size: 999 },
      previewImages: [
        { driveFileId: `${assetType}-preview-01`, fileName: "preview-01.jpg" },
        { driveFileId: `${assetType}-preview-02`, fileName: "preview-02.jpg" },
      ],
    });
    const req = { params: { id: String(model._id), index: "1" }, marketplaceAssetType: assetType, fresh: false };
    const next = (error) => { throw error; };
    const preview = new ImageResponse();
    await streamMarketplacePreview(req, preview, next);
    assert.deepEqual(preview.body, body);
    assert.equal(requested.at(-1), `${assetType}-preview-02`);
    const cover = new ImageResponse();
    await streamMarketplaceCover(req, cover, next);
    assert.deepEqual(cover.body, body);
    assert.equal(requested.at(-1), `${assetType}-cover`);
    assert.equal(cover.headers.get("content-length"), String(body.length));
  }
});

test("the server error middleware delegates after headers instead of writing JSON twice", async () => {
  const source = await readFile(new URL("../server.js", import.meta.url), "utf8");
  const start = source.indexOf("app.use((error, _req, res, _next) => {");
  const end = source.indexOf("\nconst server =", start);
  assert.ok(start >= 0 && end > start);
  let handler;
  const alerts = [];
  const logs = [];
  runInNewContext(source.slice(start, end), {
    app: { use(value) { handler = value; } },
    isExpectedServiceUnavailable: () => false,
    logger: { error(value) { logs.push(value); }, warn(value) { logs.push(value); } },
    notifyServerError(value) { alerts.push(value); },
  });
  for (const status of [500, 429]) {
    const error = Object.assign(new Error("terminated"), { status });
    let forwarded;
    handler(error, { originalUrl: "/api/plugin/fixture", correlationId: "fixture-correlation" }, {
      headersSent: true,
      setHeader() { assert.fail("Cannot set headers twice"); },
      status() { assert.fail("Cannot send JSON after an image started"); },
    }, (value) => { forwarded = value; });
    assert.equal(forwarded, error);
  }
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].status, 500);
  assert.equal(logs.length, 2);
  assert.equal(logs[0].correlationId, "fixture-correlation");
});
