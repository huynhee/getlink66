import assert from "node:assert/strict";
import test from "node:test";
import { setProxyHeaders } from "../src/controllers/getlinkController.js";

const history = { fileUrl: "https://3d.3d66.com/model.zip", productId: "model-1" };

function proxyHeaders(upstreamHeaders) {
  const headers = new Map();
  const res = {
    setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    getHeader: (key) => headers.get(key.toLowerCase()),
  };
  setProxyHeaders(res, { headers: new Headers(upstreamHeaders) }, history);
  return headers;
}

test("Getlink proxy forwards a strong ETag and byte-range identity", () => {
  const headers = proxyHeaders({
    "content-type": "application/zip",
    "content-length": "4",
    "content-range": "bytes 3-6/7",
    "accept-ranges": "bytes",
    etag: '"file-v1"',
  });
  assert.equal(headers.get("etag"), '"file-v1"');
  assert.equal(headers.get("content-range"), "bytes 3-6/7");
  assert.equal(headers.get("content-length"), "4");
});

test("Getlink proxy does not advertise weak or transformed transfer identity", () => {
  const weak = proxyHeaders({ etag: 'W/"file-v1"' });
  assert.equal(weak.has("etag"), false);

  const transformed = proxyHeaders({
    etag: '"file-v1"',
    "content-encoding": "gzip",
    "content-length": "100",
    "content-range": "bytes 3-6/7",
    "accept-ranges": "bytes",
  });
  assert.equal(transformed.has("etag"), false);
  assert.equal(transformed.has("content-length"), false);
  assert.equal(transformed.has("content-range"), false);
  assert.equal(transformed.has("accept-ranges"), false);
});
