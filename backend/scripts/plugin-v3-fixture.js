import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalPluginReleaseV3, PLUGIN_FAMILIES } from "../src/utils/pluginReleaseManifest.js";

// Generate public test data only. The ephemeral signing key is never saved.
const versions = Object.values(PLUGIN_FAMILIES).flat();
const version = "1.0.2";
const artifact = (component, maxFamily, maxVersions, extension) => ({
  component, maxFamily, maxVersions, channel: "live-test", version,
  downloadUrl: `https://3dipl.org/plugin-releases/live-test/${version}/${component}.${extension}`,
  sha256: "a".repeat(64), protocolMinimum: 2, protocolMaximum: 2,
  requiresMaxRestart: component !== "desktop", signatureAlgorithm: "ES256",
  publishedAt: "2026-10-01T08:00:00.123Z",
});
const manifest = {
  manifestVersion: 3, channel: "live-test", version, minimumVersion: "1.0.1",
  maxVersions: versions, publishedAt: "2026-10-01T08:00:00.123Z", signatureAlgorithm: "ES256",
  desktopArtifact: artifact("desktop", "", versions, "zip"),
  bridgeArtifacts: Object.entries(PLUGIN_FAMILIES).map(([family, years]) => artifact(family === "2020-2025" ? "maxBridgeLegacy" : "maxBridgeModern", family, years, "mzp")),
  releaseNotes: { vi: "C\u1eadp nh\u1eadt \u0111\u00e3 s\u1eb5n s\u00e0ng \ud83d\ude80\n\"An to\u00e0n\"\t<&>\\", en: "Ready\n\"quoted\"\t<&>\\\b\f\u0001\u2028\u2029" },
};
const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const canonical = canonicalPluginReleaseV3(manifest);
manifest.signature = crypto.sign("sha256", canonical, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
const fixture = {
  description: "Node and .NET V3 canonicalization/signature fixture. Public test key only.",
  publicKey: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
  canonicalSha256: crypto.createHash("sha256").update(canonical).digest("hex"), manifest,
};
const target = fileURLToPath(new URL("../../docs/contracts/plugin-v3-canonical-fixture.json", import.meta.url));
await fs.mkdir(path.dirname(target), { recursive: true });
await fs.writeFile(target, JSON.stringify(fixture, null, 2) + "\n");
console.log(target);
