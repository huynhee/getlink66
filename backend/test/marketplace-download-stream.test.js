import assert from "node:assert/strict";
import { once } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import { pipeMarketplaceDownloadStream } from "../src/utils/marketplaceDownloadStream.js";

test("completed marketplace streams leave no upstream error", async () => {
  const source = new PassThrough();
  const response = new PassThrough();
  const chunks = [];
  const errors = [];
  response.on("data", (chunk) => chunks.push(chunk));
  pipeMarketplaceDownloadStream(source, response, (error) => errors.push(error));

  source.end("downloaded");
  await once(response, "finish");

  assert.equal(Buffer.concat(chunks).toString(), "downloaded");
  assert.deepEqual(errors, []);
});

test("client disconnect destroys the upstream stream without reporting a server error", async () => {
  const source = new PassThrough();
  const response = new PassThrough();
  const errors = [];
  pipeMarketplaceDownloadStream(source, response, (error) => errors.push(error));

  response.destroy();
  await once(source, "close");

  assert.equal(source.destroyed, true);
  assert.deepEqual(errors, []);
});

test("upstream termination reaches the download error handler while the client is connected", async () => {
  const source = new PassThrough();
  const response = new PassThrough();
  const errors = [];
  pipeMarketplaceDownloadStream(source, response, (error) => errors.push(error));

  source.destroy(new Error("terminated"));
  await once(source, "close").catch(() => {});

  assert.equal(errors[0]?.message, "terminated");
  assert.equal(response.destroyed, false);
  response.destroy();
});
