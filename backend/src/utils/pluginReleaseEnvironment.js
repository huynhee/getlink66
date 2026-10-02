export function pluginReleaseFromEnvironment(env = process.env) {
  const version = String(env.PLUGIN_RELEASE_VERSION || "0.4.0").trim();
  const manifest = {
    manifestVersion: Number(env.PLUGIN_RELEASE_MANIFEST_VERSION || 2),
    channel: String(env.PLUGIN_RELEASE_CHANNEL || "beta"),
    version,
    minimumVersion: String(env.PLUGIN_MINIMUM_VERSION || version),
    maxVersions: ["2026"],
    downloadUrl: String(env.PLUGIN_RELEASE_URL || "").trim(),
    sha256: String(env.PLUGIN_RELEASE_SHA256 || "").trim().toLowerCase(),
    signature: String(env.PLUGIN_RELEASE_SIGNATURE || ""),
    signatureAlgorithm: "ES256",
    publishedAt: env.PLUGIN_RELEASE_PUBLISHED_AT || null,
  };
  if (manifest.manifestVersion >= 2) {
    manifest.desktopArtifact = artifactFromEnvironment(env, "PLUGIN_DESKTOP_RELEASE", "desktop", false, manifest);
    manifest.maxBridge2026Artifact = artifactFromEnvironment(env, "PLUGIN_MAX_BRIDGE_RELEASE", "maxBridge2026", true, manifest);
  }
  return manifest;
}

function artifactFromEnvironment(env, prefix, component, requiresMaxRestart, manifest) {
  return {
    component,
    channel: manifest.channel,
    version: String(env[`${prefix}_VERSION`] || manifest.version),
    downloadUrl: String(env[`${prefix}_URL`] || ""),
    sha256: String(env[`${prefix}_SHA256`] || "").toLowerCase(),
    protocolMinimum: Number(env[`${prefix}_PROTOCOL_MINIMUM`] || 2),
    protocolMaximum: Number(env[`${prefix}_PROTOCOL_MAXIMUM`] || 2),
    requiresMaxRestart,
    signature: String(env[`${prefix}_SIGNATURE`] || ""),
    signatureAlgorithm: "ES256",
    publishedAt: env[`${prefix}_PUBLISHED_AT`] || manifest.publishedAt,
  };
}
