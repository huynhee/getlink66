import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  canonicalPluginReleaseManifest,
  verifyPluginReleaseManifest,
} from "../src/utils/pluginReleaseManifest.js";

test("plugin release ES256 signature rejects a tampered manifest", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const manifest = {
    channel: "production",
    version: "0.2.1",
    minimumVersion: "0.2.0",
    maxVersions: ["2026"],
    downloadUrl: "https://3dipl.org/releases/plugin-0.2.1.mzp",
    sha256: "a".repeat(64),
    signatureAlgorithm: "ES256",
    publishedAt: "2026-08-10T00:00:00.000Z",
  };
  manifest.signature = crypto.sign(
    "sha256",
    canonicalPluginReleaseManifest(manifest),
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64");
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");

  assert.equal(verifyPluginReleaseManifest(manifest, spki), true);
  assert.equal(verifyPluginReleaseManifest({ ...manifest, sha256: "b".repeat(64) }, spki), false);
});
