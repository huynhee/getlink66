import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const version = "1.0.1";
const channel = "live-test";
const previousId = "6ac015e6eef6cb2b6a153c8f";
const previousRevision = 5;
const expectedPin = "17e3999b7be9e3a59ab2c1c6d44cd453503bd8999e619be9dbcdadf7e06c021a";
const incoming = path.dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2];
if (!["prepare", "publish", "rollback"].includes(mode)) throw new Error("Unknown operation");
if (!incoming.startsWith("/tmp/3dipl-release-1.0.1-20261015")) throw new Error("Unexpected import directory");
const { connectDb, closeDbConnections } = await import("/app/src/config/db.js");
await connectDb();
try {
  const { default: Release } = await import("/app/src/models/PluginRelease.js");
  const { default: Channel } = await import("/app/src/models/PluginReleaseChannel.js");
  const { pluginReleaseService: service, releasePublicKey, releaseArtifacts, CHUNK_BYTES } =
    await import("/app/src/services/pluginReleaseService.js");
  const { verifyPluginReleaseManifest } = await import("/app/src/utils/pluginReleaseManifest.js");
  const { auditEvent } = await import("/app/src/utils/logger.js");
  if (process.env.PLUGIN_RELEASE_SOURCE !== "database" || process.env.PLUGIN_RELEASE_ENABLED !== "true" ||
      process.env.PLUGIN_PUBLIC_DOWNLOAD_CHANNEL !== channel) throw new Error("Release source/channel changed");
  const pin = releasePublicKey(channel);
  if (crypto.createHash("sha256").update(Buffer.from(pin, "base64")).digest("hex") !== expectedPin)
    throw new Error("Unexpected release trust pin");
  const manifest = JSON.parse(await fsp.readFile(path.join(incoming, "release.json"), "utf8"));
  if (manifest.version !== version || manifest.channel !== channel || manifest.manifestVersion !== 3 ||
      !verifyPluginReleaseManifest(manifest, pin)) throw new Error("Untrusted/wrong release manifest");
  const current = await Channel.findById(channel).lean();
  const snapshotPath = path.join(incoming, "previous-release.json");
  let release = await Release.findOne({ channel, version }).lean();
  const operator = "authorized-vps-operator:ubuntu";
  function unchanged() {
    if (String(current?.activeReleaseId) !== previousId || current?.revision !== previousRevision)
      throw new Error("Live channel changed; publication needs a fresh review");
  }
  if (mode === "rollback") {
    if (!release || String(current?.activeReleaseId) !== String(release._id))
      throw new Error("Only this exact current release can be rolled back");
    const result = await service.publish(previousId, current.revision);
    auditEvent("VPS_PLUGIN_RELEASE_ROLLBACK", { actor: operator, target: previousId, fromVersion: version });
    console.log(JSON.stringify({ rolledBack: true, activeReleaseId: result.channel.activeReleaseId, revision: result.channel.revision }));
  } else if (mode === "prepare") {
    unchanged();
    const previous = await service.get(previousId);
    const snapshot = { channel, previousChannel: current, previousRelease: previous, preparedAt: new Date().toISOString() };
    try { await fsp.writeFile(snapshotPath, JSON.stringify(snapshot, null, 2), { flag: "wx", mode: 0o600 }); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    const files = [];
    for (const artifact of releaseArtifacts(manifest)) {
      const url = new URL(artifact.downloadUrl);
      const name = path.posix.basename(url.pathname);
      if (!/^[A-Za-z0-9._-]+\.(zip|mzp)$/.test(name) || name.includes("..")) throw new Error("Invalid input filename");
      const filePath = path.join(incoming, name);
      const stat = await fsp.stat(filePath);
      const hash = crypto.createHash("sha256");
      for await (const part of fs.createReadStream(filePath)) hash.update(part);
      if (hash.digest("hex") !== artifact.sha256) throw new Error("Incoming artifact checksum mismatch: " + name);
      files.push({ name, bytes: stat.size });
    }
    if (!release) {
      release = await service.create(manifest, files);
      auditEvent("VPS_CREATE_PLUGIN_RELEASE", { actor: operator, target: String(release._id), version, channel });
    }
    if (JSON.stringify(release.manifest) !== JSON.stringify(manifest)) throw new Error("Version already belongs to a different signed manifest");
    if (release.status === "draft") {
      for (const file of files) {
        const status = await service.uploadStatus(String(release._id), file.name);
        const received = new Set(status.receivedChunks);
        const input = await fsp.open(path.join(incoming, file.name), "r");
        try {
          for (let index = 0; index < status.totalChunks; index++) {
            if (received.has(index)) continue;
            const start = index * CHUNK_BYTES;
            const buffer = Buffer.alloc(Math.min(CHUNK_BYTES, file.bytes - start));
            let offset = 0;
            while (offset < buffer.length) {
              const result = await input.read(buffer, offset, buffer.length - offset, start + offset);
              if (!result.bytesRead) throw new Error("Unexpected input EOF");
              offset += result.bytesRead;
            }
            await service.chunk(String(release._id), file.name, index, buffer);
          }
        } finally { await input.close(); }
        console.log("UPLOADED " + file.name);
      }
    }
    release = await service.verify(String(release._id));
    if (release.status !== "verified") throw new Error("Release is not verified");
    auditEvent("VPS_VERIFY_PLUGIN_RELEASE", { actor: operator, target: String(release._id), version, channel });
    console.log(JSON.stringify({ prepared: true, releaseId: release._id, status: release.status, previousRevision: current.revision }));
  } else {
    unchanged();
    if (!release || release.status !== "verified" || JSON.stringify(release.manifest) !== JSON.stringify(manifest))
      throw new Error("Publish requires the exact verified release");
    const backup = JSON.parse(await fsp.readFile(snapshotPath, "utf8"));
    if (String(backup.previousChannel.activeReleaseId) !== previousId || backup.previousChannel.revision !== previousRevision)
      throw new Error("Rollback snapshot mismatch");
    const result = await service.publish(String(release._id), previousRevision);
    const receipt = { published: true, version, channel, activeReleaseId: result.channel.activeReleaseId,
      previousReleaseId: previousId, revision: result.channel.revision, at: new Date().toISOString(), operator };
    await fsp.writeFile(path.join(incoming, "publish-receipt.json"), JSON.stringify(receipt, null, 2), { mode: 0o600 });
    auditEvent("VPS_PUBLISH_PLUGIN_RELEASE", { actor: operator, target: String(release._id), version, channel, revision: result.channel.revision });
    console.log(JSON.stringify(receipt));
  }
} finally { await closeDbConnections(); }
