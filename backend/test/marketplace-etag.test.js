import assert from "node:assert/strict";
import test from "node:test";
import { sendMarketplaceJsonWithEtag } from "../src/controllers/marketplaceController.js";

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: null,
    ended: false,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = String(value);
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}

test("marketplace JSON helper emits stable ETag and honors If-None-Match", () => {
  const payload = { assets: [{ _id: "model-1", title: "Chair" }] };
  const first = responseRecorder();
  sendMarketplaceJsonWithEtag({ headers: {} }, first, payload);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, payload);
  assert.match(first.headers.etag, /^"sha256:[a-f0-9]{64}"$/);
  assert.equal(first.headers["cache-control"], "public, max-age=60, must-revalidate");

  const second = responseRecorder();
  sendMarketplaceJsonWithEtag(
    { headers: { "if-none-match": first.headers.etag } },
    second,
    payload,
  );
  assert.equal(second.statusCode, 304);
  assert.equal(second.ended, true);
  assert.equal(second.body, null);
});
