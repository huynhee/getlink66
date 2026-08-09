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

export function verifyPluginReleaseManifest(manifest, publicKeySpkiBase64) {
  try {
    if (String(manifest.signatureAlgorithm || "") !== "ES256") return false;
    const publicKey = crypto.createPublicKey({
      key: Buffer.from(String(publicKeySpkiBase64 || ""), "base64"),
      format: "der",
      type: "spki",
    });
    return crypto.verify(
      "sha256",
      canonicalPluginReleaseManifest(manifest),
      { key: publicKey, dsaEncoding: "ieee-p1363" },
      Buffer.from(String(manifest.signature || ""), "base64"),
    );
  } catch {
    return false;
  }
}
