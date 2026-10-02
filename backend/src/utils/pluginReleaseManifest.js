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
    if (Number(manifest.manifestVersion) === 3) {
      validatePluginReleaseV3(manifest);
      const key = crypto.createPublicKey({ key: Buffer.from(String(publicKeySpkiBase64), "base64"), format: "der", type: "spki" });
      return key.asymmetricKeyType === "ec" && key.asymmetricKeyDetails?.namedCurve === "prime256v1"
        && crypto.verify("sha256", canonicalPluginReleaseV3(manifest), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(String(manifest.signature), "base64"));
    }
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

export const PLUGIN_CHANNELS = ["live-test", "staging", "production"];
export const PLUGIN_FAMILIES = { "2020-2025": ["2020", "2021", "2022", "2023", "2024", "2025"], "2026-2027": ["2026", "2027"] };

export function comparePluginVersions(left, right) {
  const parse = (value) => {
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(String(value))) throw new Error("PLUGIN_RELEASE_VERSION_INVALID");
    const parts = String(value).split(".").map(Number);
    if (parts.some((part) => !Number.isSafeInteger(part) || part > 2147483647)) throw new Error("PLUGIN_RELEASE_VERSION_INVALID");
    return [...parts, 0].slice(0, 4);
  };
  const a = parse(left);
  const b = parse(right);
  for (let i = 0; i < 4; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

function v3Artifact(artifact) {
  return {
    component: String(artifact.component).trim(),
    maxFamily: String(artifact.maxFamily || ""),
    maxVersions: artifact.maxVersions.map(String),
    channel: String(artifact.channel).trim().toLowerCase(),
    version: String(artifact.version).trim(),
    downloadUrl: String(artifact.downloadUrl).trim(),
    sha256: String(artifact.sha256).toLowerCase(),
    protocolMinimum: Number(artifact.protocolMinimum),
    protocolMaximum: Number(artifact.protocolMaximum),
    requiresMaxRestart: Boolean(artifact.requiresMaxRestart),
    signatureAlgorithm: "ES256",
    publishedAt: new Date(artifact.publishedAt).toISOString(),
  };
}

export function canonicalPluginReleaseV3(manifest) {
  return Buffer.from(JSON.stringify({
    manifestVersion: 3,
    channel: String(manifest.channel).trim().toLowerCase(),
    version: String(manifest.version).trim(),
    minimumVersion: String(manifest.minimumVersion).trim(),
    maxVersions: manifest.maxVersions.map(String),
    publishedAt: new Date(manifest.publishedAt).toISOString(),
    signatureAlgorithm: "ES256",
    desktopArtifact: v3Artifact(manifest.desktopArtifact),
    bridgeArtifacts: [...manifest.bridgeArtifacts].sort((a, b) => a.maxFamily.localeCompare(b.maxFamily)).map(v3Artifact),
    releaseNotes: { vi: String(manifest.releaseNotes?.vi || ""), en: String(manifest.releaseNotes?.en || "") },
  }), "utf8");
}

export function validatePluginReleaseV3(manifest) {
  const invalid = () => { throw new Error("PLUGIN_RELEASE_MANIFEST_INVALID"); };
  const versions = Object.values(PLUGIN_FAMILIES).flat();
  if (manifest.manifestVersion !== 3 || !PLUGIN_CHANNELS.includes(manifest.channel)
    || manifest.signatureAlgorithm !== "ES256"
    || comparePluginVersions(manifest.minimumVersion, manifest.version) > 0
    || !Array.isArray(manifest.maxVersions) || JSON.stringify(manifest.maxVersions) !== JSON.stringify(versions)
    || !Array.isArray(manifest.bridgeArtifacts) || manifest.bridgeArtifacts.length !== 2
    || typeof manifest.publishedAt !== "string" || !manifest.publishedAt || Number.isNaN(new Date(manifest.publishedAt).getTime())
    || !/^[A-Za-z0-9+/]{86}==$/.test(String(manifest.signature || ""))) invalid();
  const artifacts = [manifest.desktopArtifact, ...manifest.bridgeArtifacts];
  const families = new Set();
  for (const artifact of artifacts) {
    if (!artifact || artifact.channel !== manifest.channel || artifact.version !== manifest.version
      || artifact.signatureAlgorithm !== "ES256" || !/^https:\/\//.test(String(artifact.downloadUrl))
      || !/^[a-f0-9]{64}$/.test(String(artifact.sha256)) || typeof artifact.publishedAt !== "string"
      || !artifact.publishedAt || Number.isNaN(new Date(artifact.publishedAt).getTime())
      || !Number.isInteger(artifact.protocolMinimum) || artifact.protocolMinimum < 1
      || !Number.isInteger(artifact.protocolMaximum) || artifact.protocolMaximum < artifact.protocolMinimum) invalid();
    if (artifact === manifest.desktopArtifact) {
      if (artifact.component !== "desktop" || artifact.maxFamily || artifact.requiresMaxRestart !== false
        || JSON.stringify(artifact.maxVersions) !== JSON.stringify(versions)) invalid();
    } else {
      const expected = PLUGIN_FAMILIES[artifact.maxFamily];
      if (!expected || families.has(artifact.maxFamily) || artifact.requiresMaxRestart !== true
        || artifact.component !== (artifact.maxFamily === "2020-2025" ? "maxBridgeLegacy" : "maxBridgeModern")
        || JSON.stringify(artifact.maxVersions) !== JSON.stringify(expected)) invalid();
      families.add(artifact.maxFamily);
    }
  }
  if (manifest.releaseNotes != null && (typeof manifest.releaseNotes !== "object" || Array.isArray(manifest.releaseNotes))) invalid();
  if (Object.values(manifest.releaseNotes || {}).some((note) => typeof note !== "string" || note.length > 10000 || hasUnpairedSurrogate(note))) invalid();
  return manifest;
}

function hasUnpairedSurrogate(value) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
    } else if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
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
