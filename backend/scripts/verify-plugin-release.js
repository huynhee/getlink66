import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { describeReleaseFiles, inspectReleaseArchive } from "../src/services/pluginReleaseService.js";
import { verifyPluginReleaseManifest } from "../src/utils/pluginReleaseManifest.js";

const [directory, publicKeyPath, baseUrl] = process.argv.slice(2);
if (!directory || !publicKeyPath || !baseUrl) {
  console.error("Usage: node scripts/verify-plugin-release.js <directory> <trusted-SPKI-public-key-file> <HTTPS-base-origin>");
  process.exitCode = 1;
} else {
  try {
    const root = path.resolve(directory);
    const manifestPath = path.join(root, "release.json");
    if ((await fsp.stat(manifestPath)).size > 1024 * 1024) throw new Error("PLUGIN_RELEASE_MANIFEST_TOO_LARGE");
    const manifest = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
    const key = (await fsp.readFile(publicKeyPath, "utf8")).trim();
    if (!verifyPluginReleaseManifest(manifest, key)) throw new Error("PLUGIN_RELEASE_SIGNATURE_INVALID");
    const artifacts = manifest.manifestVersion === 3 ? [manifest.desktopArtifact, ...manifest.bridgeArtifacts] : [manifest.desktopArtifact, manifest.maxBridge2026Artifact];
    const submitted = await Promise.all(artifacts.map(async (artifact) => {
      const name = path.posix.basename(new URL(artifact.downloadUrl).pathname);
      const stat = await fsp.stat(path.join(root, name));
      if (!stat.isFile()) throw new Error("PLUGIN_RELEASE_FILE_INVALID");
      return { name, bytes: stat.size };
    }));
    const files = describeReleaseFiles(manifest, submitted, { PUBLIC_BASE_URL: baseUrl });
    for (const file of files) {
      const filePath = path.join(root, file.name);
      const hash = crypto.createHash("sha256");
      for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
      if (hash.digest("hex") !== file.sha256) throw new Error("PLUGIN_RELEASE_SHA256_MISMATCH");
      await inspectReleaseArchive(filePath, file, manifest.version);
    }
    console.log(JSON.stringify({ ok: true, version: manifest.version, channel: manifest.channel, manifestVersion: manifest.manifestVersion,
      signatureValid: true, files: files.map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })) }, null, 2));
  } catch (error) {
    console.error(error.code || error.message);
    process.exitCode = 1;
  }
}
