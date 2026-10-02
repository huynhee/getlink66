import assert from "node:assert/strict";
import test from "node:test";
import {
  releaseManifest,
  sendPluginReleaseJsonWithEtag,
} from "../src/controllers/pluginAuthController.js";

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
  assert.equal(first.headers["cache-control"], "no-cache");

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

test("plugin release feed is unavailable while release publishing is disabled", () => {
  const previous = process.env.PLUGIN_RELEASE_ENABLED;
  process.env.PLUGIN_RELEASE_ENABLED = "false";
  let captured;
  try {
    releaseManifest({}, responseRecorder(), (error) => {
      captured = error;
    });
  } finally {
    if (previous === undefined) delete process.env.PLUGIN_RELEASE_ENABLED;
    else process.env.PLUGIN_RELEASE_ENABLED = previous;
  }
  assert.equal(captured?.status, 503);
  assert.equal(captured?.code, "PLUGIN_RELEASE_DISABLED");
});

test("ETags isolate manifest contract and channel and change on publish", () => {
  const base = { manifestVersion: 2, channel: "live-test", version: "1.0.1" };
  const first = responseRecorder();
  sendPluginReleaseJsonWithEtag({ headers: {} }, first, base);
  for (const manifest of [{ ...base, manifestVersion: 3 }, { ...base, channel: "staging" }, { ...base, version: "1.0.2" }]) {
    const next = responseRecorder();
    sendPluginReleaseJsonWithEtag({ headers: { "if-none-match": first.headers.etag } }, next, manifest);
    assert.equal(next.statusCode, 200);
    assert.notEqual(next.headers.etag, first.headers.etag);
  }
});
