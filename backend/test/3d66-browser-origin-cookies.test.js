import assert from "node:assert/strict";
import test from "node:test";
import { missing3D66OriginAuthCookies } from "../src/utils/3d66BrowserOriginCookies.js";

const url = "https://su.3d66.com/reshtmla/sketchup/items/fixture/model.html";
const raw = "PHPSESSID=raw-session; login_sign=raw-login; login_token=raw-optional; acw_tc=old-challenge";
const cookie = (name, domain, value = "refreshed") => ({ name, domain, value, path: "/" });

test("restored Max/root host-only cookies do not falsely authenticate a new SU origin", () => {
  const existing = [cookie("PHPSESSID", "3d66.com"), cookie("login_sign", "3d66.com"),
    cookie("login_sign", "3d.3d66.com"), cookie("PHPSESSID", ".3d66.com")];
  assert.deepEqual(missing3D66OriginAuthCookies(existing, raw, url), [
    { name: "PHPSESSID", value: "raw-session", url: "https://su.3d66.com" },
    { name: "login_sign", value: "raw-login", url: "https://su.3d66.com" },
    { name: "login_token", value: "raw-optional", url: "https://su.3d66.com" },
  ]);
  assert.equal(existing[0].value, "refreshed");
});

test("complete inherited or host-specific credentials are never overwritten", () => {
  for (const domain of ["su.3d66.com", ".3d66.com"]) {
    assert.deepEqual(missing3D66OriginAuthCookies([cookie("PHPSESSID", domain), cookie("login_sign", domain)], raw, url), []);
  }
});

test("a partial host credential only fills missing names and never replaces refreshed state", () => {
  const existing = [cookie("PHPSESSID", "su.3d66.com"), cookie("acw_tc", ".3d66.com")];
  const missing = missing3D66OriginAuthCookies(existing, raw, url);
  assert.deepEqual(missing.map(c => c.name), ["login_sign", "login_token"]);
  const filled = [...existing, ...missing.map(c => ({ ...c, domain: "su.3d66.com", path: "/" }))];
  assert.deepEqual(missing3D66OriginAuthCookies(filled, raw, url), []);
});

test("new-origin auth never seeds an arbitrary host, Max origin, challenge cookie or unrelated path", () => {
  for (const target of [url.replace("su.3d66.com", "evil.test"), url.replace("sketchup", "model"),
    url.replace("https:", "http:"), url.replace("su.3d66.com/reshtmla/sketchup", "3d.3d66.com/reshtmla/model")]) {
    assert.deepEqual(missing3D66OriginAuthCookies([], raw, target), []);
  }
  assert.equal(missing3D66OriginAuthCookies([], raw, url).some(c => c.name === "acw_tc"), false);
});
