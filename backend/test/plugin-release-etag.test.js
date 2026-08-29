import assert from "node:assert/strict";
import test from "node:test";
import { sendPluginReleaseJsonWithEtag } from "../src/controllers/pluginAuthController.js";

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

test("plugin release emits stable ETag and returns 304", () => {
  const manifest = {
    manifestVersion: 2,
    channel: "production",
    version: "0.3.1",
    minimumVersion: "0.2.1",
  };
  const first = responseRecorder();
  sendPluginReleaseJsonWithEtag({ headers: {} }, first, manifest);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body, manifest);
  assert.match(first.headers.etag, /^"sha256:[a-f0-9]{64}"$/);
  assert.equal(first.headers["cache-control"], "public, max-age=300, must-revalidate");

  const second = responseRecorder();
  sendPluginReleaseJsonWithEtag(
    { headers: { "if-none-match": first.headers.etag } },
    second,
    manifest,
  );
  assert.equal(second.statusCode, 304);
  assert.equal(second.ended, true);
  assert.equal(second.body, null);
});
