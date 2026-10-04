import test from "node:test";
import assert from "node:assert/strict";
import { defaultLanguageFromCountry } from "../src/utils/requestLanguage.js";
import { getInitialLanguage, getStoredLanguage, setStoredLanguage } from "../../frontend/src/i18n.js";
import { useMemoryDb } from "../src/config/memoryStore.js";

useMemoryDb();
const { currentUser } = await import("../src/controllers/authController.js");
const { default: User } = await import("../src/models/User.js");

function storageFixture(value = null) {
  return { getItem: () => value, setItem: (key, next) => { value = next; } };
}

test("country defaults to Vietnamese only for Vietnam", () => {
  assert.equal(defaultLanguageFromCountry("VN"), "vi");
  assert.equal(defaultLanguageFromCountry(" vn "), "vi");
  for (const country of ["US", "GB", "FR", "JP", "SG"]) {
    assert.equal(defaultLanguageFromCountry(country), "en");
  }
});

test("missing, unknown, Tor and malformed countries do not override browser language", () => {
  for (const country of [undefined, null, "", "XX", "T1", "VN,US", "Vietnam", ["VN"], "<script>"]) {
    assert.equal(defaultLanguageFromCountry(country), null);
  }
});

test("stored language takes priority over browser language", () => {
  assert.equal(getInitialLanguage({ storage: storageFixture("vi"), browserLanguage: "en-US" }), "vi");
  assert.equal(getInitialLanguage({ storage: storageFixture("en"), browserLanguage: "vi-VN" }), "en");
  assert.equal(getStoredLanguage(storageFixture("fr")), null);
});

test("browser fallback uses English except for Vietnamese", () => {
  for (const browserLanguage of ["en-US", "fr-FR", "ja-JP", "", null]) {
    assert.equal(getInitialLanguage({ storage: storageFixture(), browserLanguage }), "en");
  }
  for (const browserLanguage of ["vi", "vi-VN", "VI-vn"]) {
    assert.equal(getInitialLanguage({ storage: storageFixture(), browserLanguage }), "vi");
  }
});

test("manual preferences persist and blocked storage does not break startup", () => {
  const storage = storageFixture();
  setStoredLanguage("en", storage);
  assert.equal(getStoredLanguage(storage), "en");
  setStoredLanguage("fr", storage);
  assert.equal(getStoredLanguage(storage), "en");
  const blocked = { getItem() { throw new Error("Storage blocked"); }, setItem() { throw new Error("Storage blocked"); } };
  assert.equal(getInitialLanguage({ storage: blocked, browserLanguage: "en-US" }), "en");
  assert.doesNotThrow(() => setStoredLanguage("vi", blocked));
});

test("account bootstrap includes the country default for guests and signed-in users without caching it", async () => {
  const user = await User.create({ name: "Language fixture", email: "language@example.test", credit: 10 });
  for (const [country, expected, current] of [["VN", "vi", null], ["US", "en", null], [undefined, null, null], ["VN", "vi", user], ["US", "en", user]]) {
    const res = {
      headers: {},
      set(name, value) { this.headers[name] = value; return this; },
      json(payload) { this.payload = payload; return this; },
    };
    await currentUser({ user: current, headers: { "cf-ipcountry": country } }, res, (error) => { throw error; });
    assert.equal(res.payload.defaultLanguage, expected);
    assert.equal(res.headers["Cache-Control"], "private, no-store");
    assert.equal(Boolean(res.payload.user), Boolean(current));
    if (current) assert.equal(res.payload.user.credit, 10);
  }
});
