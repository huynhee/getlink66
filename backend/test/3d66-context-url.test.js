import test from "node:test";
import assert from "node:assert/strict";
import { resolve3D66ContextUrl } from "../src/utils/3d66Service.js";

test("3d66 context URL falls back when optional origin contains an env comment", () => {
  assert.equal(
    resolve3D66ContextUrl(
      "# Origin/referrer configuration comment",
      "https://3d.3d66.com/reshtmla/model/items/example.html",
    ),
    "https://3d.3d66.com/reshtmla/model/items/example.html",
  );
});

test("3d66 context URL accepts a valid configured 3d66 origin", () => {
  assert.equal(
    resolve3D66ContextUrl(
      "https://su.3d66.com",
      "https://3d.3d66.com/reshtmla/model/items/example.html",
    ),
    "https://su.3d66.com/",
  );
});

test("3d66 context URL rejects unrelated hosts", () => {
  assert.equal(
    resolve3D66ContextUrl(
      "https://example.com/unsafe",
      "https://3d.3d66.com/reshtmla/model/items/example.html",
    ),
    "https://3d.3d66.com/reshtmla/model/items/example.html",
  );
});
