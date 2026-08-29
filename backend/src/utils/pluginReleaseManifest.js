import crypto from "node:crypto";

export function canonicalPluginReleaseManifest(manifest) {
  return Buffer.from(JSON.stringify({
    channel: String(manifest.channel || "").trim().toLowerCase(),
    version: String(manifest.version || "").trim(),
    minimumVersion: String(manifest.minimumVersion || "").trim(),
    maxVersions: Array.isArray(manifest.maxVersions)
      ? manifest.maxVersions.map((value) => String(value).trim())
      : [],
    downloadUrl: String(manifest.downloadUrl || "").trim(),
    sha256: String(manifest.sha256 || "").trim().toLowerCase(),
    signatureAlgorithm: "ES256",
    publishedAt: new Date(manifest.publishedAt).toISOString(),
  }), "utf8");
}

export function canonicalPluginReleaseArtifact(artifact) {
  return Buffer.from(JSON.stringify({
    component: String(artifact.component || "").trim(),
    channel: String(artifact.channel || "").trim().toLowerCase(),
    version: String(artifact.version || "").trim(),
    downloadUrl: String(artifact.downloadUrl || "").trim(),
    sha256: String(artifact.sha256 || "").trim().toLowerCase(),
    protocolMinimum: Number(artifact.protocolMinimum),
    protocolMaximum: Number(artifact.protocolMaximum),
    requiresMaxRestart: Boolean(artifact.requiresMaxRestart),
    signatureAlgorithm: "ES256",
    publishedAt: new Date(artifact.publishedAt).toISOString(),
  }), "utf8");
}

export function verifyPluginReleaseManifest(manifest, publicKeySpkiBase64) {
  try {
    if (String(manifest.signatureAlgorithm || "") !== "ES256") return false;
    if (requiresManifestV2(manifest.version) && Number(manifest.manifestVersion || 1) < 2) {
      return false;
    }
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(publicKeySpkiBase64 || ""), "base64"),
      format: "der",
      type: "spki",
    });
    const legacyValid = crypto.verify(
      "sha256",
      canonicalPluginReleaseManifest(manifest),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(String(manifest.signature || ""), "base64"),
    );
    if (!legacyValid) return false;
    if (Number(manifest.manifestVersion || 1) < 2) return true;
    return verifyPluginReleaseArtifact(
      manifest.desktopArtifact,
      publicKey,
      {
        component: "desktop",
        channel: String(manifest.channel || "").trim().toLowerCase(),
        requiresMaxRestart: false,
      },
    ) && verifyPluginReleaseArtifact(
      manifest.maxBridge2026Artifact,
      publicKey,
      {
        component: "maxBridge2026",
        channel: String(manifest.channel || "").trim().toLowerCase(),
        requiresMaxRestart: true,
      },
    );
  } catch {
    return false;
  }
}

function requiresManifestV2(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[.+-]|$)/.exec(String(version || "").trim());
  if (!match) return false;
  const [, major, minor] = match.map(Number);
  return major > 0 || minor >= 3;
}

function verifyPluginReleaseArtifact(artifact, publicKey, expected) {
  if (!artifact || String(artifact.component) !== expected.component) return false;
  if (String(artifact.channel || "").trim().toLowerCase() !== expected.channel) return false;
  if (Boolean(artifact.requiresMaxRestart) !== expected.requiresMaxRestart) return false;
  if (String(artifact.signatureAlgorithm || "") !== "ES256") return false;
  if (!/^https:\/\//i.test(String(artifact.downloadUrl || ""))) return false;
  if (!/^[a-f0-9]{64}$/i.test(String(artifact.sha256 || ""))) return false;
  if (!artifact.version || Number.isNaN(new Date(artifact.publishedAt).getTime())) return false;
  const minimum = Number(artifact.protocolMinimum);
  const maximum = Number(artifact.protocolMaximum);
  if (!Number.isInteger(minimum) || !Number.isInteger(maximum) || minimum < 1 || maximum < minimum) {
    return false;
  }
  return crypto.verify(
    "sha256",
    canonicalPluginReleaseArtifact(artifact),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    Buffer.from(String(artifact.signature || ""), "base64"),
  );
}
