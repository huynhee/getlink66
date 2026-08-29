import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  canonicalPluginReleaseArtifact,
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

test("plugin release v2 verifies independently signed desktop and bridge artifacts", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const sign = (bytes) => crypto.sign(
    "sha256",
    bytes,
    { key: privateKey, dsaEncoding: "ieee-p1363" },
  ).toString("base64");
  const component = (name, restart, suffix) => {
    const artifact = {
      component: name,
      channel: "production",
      version: "0.3.1",
      downloadUrl: `https://3dipl.org/releases/${suffix}`,
      sha256: suffix.startsWith("desktop") ? "b".repeat(64) : "c".repeat(64),
      protocolMinimum: 1,
      protocolMaximum: 1,
      requiresMaxRestart: restart,
      signatureAlgorithm: "ES256",
      publishedAt: "2026-08-27T00:00:00.000Z",
    };
    artifact.signature = sign(canonicalPluginReleaseArtifact(artifact));
    return artifact;
  };
  const manifest = {
    manifestVersion: 2,
    channel: "production",
    version: "0.3.1",
    minimumVersion: "0.2.1",
    maxVersions: ["2026"],
    downloadUrl: "https://3dipl.org/releases/3dipl-0.3.1.mzp",
    sha256: "a".repeat(64),
    signatureAlgorithm: "ES256",
    publishedAt: "2026-08-27T00:00:00.000Z",
    desktopArtifact: component("desktop", false, "desktop-0.3.1.zip"),
    maxBridge2026Artifact: component("maxBridge2026", true, "bridge-0.3.1.mzp"),
  };
  manifest.signature = sign(canonicalPluginReleaseManifest(manifest));
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");

  assert.equal(verifyPluginReleaseManifest(manifest, spki), true);
  assert.equal(verifyPluginReleaseManifest({ ...manifest, manifestVersion: 1 }, spki), false);
  assert.equal(verifyPluginReleaseManifest({
    ...manifest,
    desktopArtifact: { ...manifest.desktopArtifact, sha256: "d".repeat(64) },
  }, spki), false);
});
