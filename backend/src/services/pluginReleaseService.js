import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import yauzl from "yauzl";
import PluginRelease from "../models/PluginRelease.js";
import PluginReleaseChannel from "../models/PluginReleaseChannel.js";
import { PLUGIN_CHANNELS, PLUGIN_FAMILIES, comparePluginVersions, validatePluginReleaseV3, verifyPluginReleaseManifest } from "../utils/pluginReleaseManifest.js";
import { pluginReleaseFromEnvironment } from "../utils/pluginReleaseEnvironment.js";
import { createPluginReleasePublication } from "./pluginReleasePublication.js";

export const CHUNK_BYTES = 8 * 1024 * 1024;
export const MAX_FILE_BYTES = 512 * 1024 * 1024;
export const MAX_RELEASE_BYTES = 1024 * 1024 * 1024;
const EXPIRY_MS = 24 * 60 * 60 * 1000;
const LOCK_MS = 30 * 60 * 1000;

export function releaseError(status, code) {
  const error = new Error(code);
  error.status = status;
  error.code = code;
  return error;
}

export function releasePublicKey(channel, env = process.env) {
  const key = env[`PLUGIN_${channel.replaceAll("-", "_").toUpperCase()}_RELEASE_PUBLIC_KEY`];
  return key || (channel === (env.PLUGIN_RELEASE_CHANNEL || "production") ? env.PLUGIN_RELEASE_PUBLIC_KEY : "") || "";
}

export function releaseArtifacts(manifest) {
  if (Number(manifest?.manifestVersion) === 3) {
    validatePluginReleaseV3(manifest);
    return [manifest.desktopArtifact, ...manifest.bridgeArtifacts];
  }
  if (Number(manifest?.manifestVersion) !== 2 || !PLUGIN_CHANNELS.includes(manifest.channel)
    || !manifest.desktopArtifact || !manifest.maxBridge2026Artifact || !Array.isArray(manifest.maxVersions)
    || !manifest.maxVersions.length || manifest.maxVersions.some((v) => v !== "2026")
    || comparePluginVersions(manifest.minimumVersion, manifest.version) > 0) {
    throw releaseError(400, "PLUGIN_RELEASE_MANIFEST_INVALID");
  }
  const artifacts = [manifest.desktopArtifact, { ...manifest.maxBridge2026Artifact, maxFamily: "2026-2027", maxVersions: manifest.maxVersions }];
  if (manifest.downloadUrl !== manifest.maxBridge2026Artifact.downloadUrl || manifest.sha256 !== manifest.maxBridge2026Artifact.sha256
    || artifacts.some((a) => a.version !== manifest.version || a.channel !== manifest.channel)
    || manifest.desktopArtifact.component !== "desktop" || manifest.maxBridge2026Artifact.component !== "maxBridge2026") {
    throw releaseError(400, "PLUGIN_RELEASE_MANIFEST_INVALID");
  }
  return artifacts;
}

function safeName(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.(zip|mzp)$/.test(name) && !name.includes("..");
}

export function describeReleaseFiles(manifest, submitted, env = process.env) {
  let artifacts;
  try { artifacts = releaseArtifacts(manifest); } catch (error) { throw releaseError(400, error.code || error.message); }
  if (!Array.isArray(submitted) || submitted.length !== artifacts.length) throw releaseError(400, "PLUGIN_RELEASE_FILES_INVALID");
  const base = new URL(env.PUBLIC_BASE_URL || "https://3dipl.org");
  const seen = new Set();
  const files = artifacts.map((artifact) => {
    let url;
    try { url = new URL(artifact.downloadUrl); } catch { throw releaseError(400, "PLUGIN_RELEASE_URL_INVALID"); }
    const name = path.posix.basename(url.pathname);
    const file = submitted.find((item) => item.name === name);
    if (url.origin !== base.origin || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
      || !safeName(name) || url.pathname !== `/plugin-releases/${manifest.channel}/${manifest.version}/${name}`
      || seen.has(name) || !/^[a-f0-9]{64}$/.test(String(artifact.sha256))
      || !Number.isSafeInteger(file?.bytes) || file.bytes < 1 || file.bytes > MAX_FILE_BYTES) {
      throw releaseError(400, "PLUGIN_RELEASE_FILES_INVALID");
    }
    if ((artifact.component === "desktop") !== name.endsWith(".zip")) throw releaseError(400, "PLUGIN_RELEASE_FILES_INVALID");
    seen.add(name);
    return { name, bytes: file.bytes, sha256: artifact.sha256, role: artifact.component === "desktop" ? "desktop" : "bridge", maxFamily: artifact.maxFamily || "", complete: false };
  });
  if (files.reduce((sum, file) => sum + file.bytes, 0) > MAX_RELEASE_BYTES) throw releaseError(413, "PLUGIN_RELEASE_TOO_LARGE");
  return files;
}

const repository = {
  list: () => PluginRelease.find().sort({ createdAt: -1 }).limit(100).lean(),
  expiredDrafts: () => PluginRelease.find({ createdAt: { $lt: new Date(Date.now() - EXPIRY_MS) }, uploadExpiredAt: null,
    $or: [{ status: "draft" }, { status: "verifying", verificationLease: { $lt: new Date(Date.now() - LOCK_MS) } }] }).sort({ createdAt: 1 }).limit(100).lean(),
  get: (id) => PluginRelease.findById(id).lean(),
  byVersion: (channel, version) => PluginRelease.findOne({ channel, version }).lean(),
  create: (data) => PluginRelease.create(data).then((doc) => doc.toObject()),
  update: (id, patch) => PluginRelease.findByIdAndUpdate(id, { $set: patch }, { new: true }).lean(),
  remove: (id) => PluginRelease.deleteOne({ _id: id }),
  channels: () => PluginReleaseChannel.find().lean(),
  channel: (channel) => PluginReleaseChannel.findById(channel).lean(),
  ...createPluginReleasePublication(),
};

export async function inspectReleaseArchive(filePath, file, version) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error) return reject(releaseError(422, "PLUGIN_RELEASE_ARCHIVE_INVALID"));
      let total = 0;
      const entries = new Set();
      const payloadPrefix = `payload/desktop/${version}/`;
      const fail = () => { zip.close(); reject(releaseError(422, "PLUGIN_RELEASE_ARCHIVE_INVALID")); };
      zip.on("error", fail);
      zip.on("entry", (entry) => {
        const name = entry.fileName;
        if (entries.size > 20000 || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name)
          || name.split("/").some((part) => part === ".." || part.includes(":")) || entries.has(name.toLowerCase())
          || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000 || (entry.generalPurposeBitFlag & 1)
          || entry.uncompressedSize > 600 * 1024 * 1024) return fail();
        total += entry.uncompressedSize;
        if (total > MAX_RELEASE_BYTES) return fail();
        entries.add(name.toLowerCase());
        zip.readEntry();
      });
      zip.on("end", () => {
        if (!entries.has((payloadPrefix + "ThreeDiPL.AssetManager.exe").toLowerCase()) || !entries.has((payloadPrefix + "ThreeDiPL.Updater.exe").toLowerCase())
          || (file.role === "bridge" && ![...entries].some((name) => name.includes(".bundle/contents/")))) return fail();
        resolve();
      });
      zip.readEntry();
    });
  });
}

export function createPluginReleaseService({ repo = repository, env = process.env, root = env.PLUGIN_RELEASE_STORAGE_DIR || "/var/lib/3dipl/plugin-releases", inspectArchive = inspectReleaseArchive } = {}) {
  root = path.resolve(root);
  const location = (kind, id, ...parts) => path.join(root, kind, id, ...parts);
  async function get(id) {
    if (!/^[a-f0-9]{24}$/i.test(String(id))) throw releaseError(400, "PLUGIN_RELEASE_ID_INVALID");
    const release = await repo.get(id);
    if (!release) throw releaseError(404, "PLUGIN_RELEASE_NOT_FOUND");
    return release;
  }
  async function locked(id, operation) {
    await get(id);
    const lockDirectory = location("locks", id);
    await fsp.mkdir(lockDirectory, { recursive: true });
    const lockPath = path.join(lockDirectory, "mutation.lock");
    let lock;
    try { lock = await fsp.open(lockPath, "wx", 0o600); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await fsp.stat(lockPath);
      if (Date.now() - stat.mtimeMs <= LOCK_MS) throw releaseError(409, "PLUGIN_RELEASE_BUSY");
      await fsp.unlink(lockPath);
      try { lock = await fsp.open(lockPath, "wx", 0o600); } catch { throw releaseError(409, "PLUGIN_RELEASE_BUSY"); }
    }
    try { return await operation(await get(id)); }
    finally { await lock.close(); await fsp.unlink(lockPath).catch(() => {}); }
  }
  function editable(release) {
    if (release.status !== "draft") throw releaseError(409, "PLUGIN_RELEASE_IMMUTABLE");
    if (Date.now() - new Date(release.createdAt).getTime() > EXPIRY_MS) throw releaseError(410, "PLUGIN_RELEASE_UPLOAD_EXPIRED");
  }
  function findFile(release, name) {
    const file = release.files.find((item) => item.name === name);
    if (!safeName(name) || !file) throw releaseError(404, "PLUGIN_RELEASE_FILE_NOT_FOUND");
    return file;
  }
  async function uploadStatus(id, name) {
    const release = await get(id);
    const file = findFile(release, name);
    const names = await fsp.readdir(location("drafts", id, name)).catch((error) => { if (error.code === "ENOENT") return []; throw error; });
    return { receivedChunks: names.filter((entry) => /^\d+\.part$/.test(entry)).map((entry) => Number(entry.split(".")[0])).sort((a, b) => a - b), chunkBytes: CHUNK_BYTES, totalChunks: Math.ceil(file.bytes / CHUNK_BYTES) };
  }
  async function create(manifest, submitted, userId) {
    const files = describeReleaseFiles(manifest, submitted, env);
    try { return await repo.create({ channel: manifest.channel, version: manifest.version, manifest, files, status: "draft", createdBy: userId }); }
    catch (error) { if (error.code === 11000) throw releaseError(409, "PLUGIN_RELEASE_VERSION_EXISTS"); throw error; }
  }
  async function chunk(id, name, index, data) {
    return locked(id, async (release) => {
      editable(release);
      const file = findFile(release, name);
      const count = Math.ceil(file.bytes / CHUNK_BYTES);
      const size = index === count - 1 ? file.bytes - index * CHUNK_BYTES : CHUNK_BYTES;
      if (!Number.isSafeInteger(index) || index < 0 || index >= count || !Buffer.isBuffer(data) || data.length !== size) throw releaseError(400, "PLUGIN_RELEASE_CHUNK_INVALID");
      const directory = location("drafts", id, name);
      await fsp.mkdir(directory, { recursive: true });
      const target = path.join(directory, `${index}.part`);
      const old = await fsp.readFile(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
      if (old) {
        if (!old.equals(data)) throw releaseError(409, "PLUGIN_RELEASE_CHUNK_CONFLICT");
      } else {
        const temporary = path.join(directory, `${index}.uploading`);
        const output = await fsp.open(temporary, "w", 0o600);
        try { await output.writeFile(data); await output.sync(); }
        finally { await output.close(); }
        await fsp.rename(temporary, target);
      }
      return uploadStatus(id, name);
    });
  }
  async function verify(id) {
    return locked(id, async (release) => {
      if (["published", "withdrawn", "verified"].includes(release.status)) return release;
      if (release.status === "verifying" && Date.now() - new Date(release.verificationLease).getTime() > LOCK_MS) {
        release = await repo.update(id, { status: "draft" });
      }
      editable(release);
      if (!verifyPluginReleaseManifest(release.manifest, releasePublicKey(release.channel, env))) throw releaseError(422, "PLUGIN_RELEASE_SIGNATURE_INVALID");
      await repo.update(id, { status: "verifying", verificationLease: new Date(), error: "" });
      const staging = location("verified", id + ".staging");
      try {
        await fsp.rm(staging, { recursive: true, force: true });
        await fsp.mkdir(staging, { recursive: true });
        for (const file of release.files) {
          const output = await fsp.open(path.join(staging, file.name), "wx", 0o600);
          const hash = crypto.createHash("sha256");
          let bytes = 0;
          try {
            for (let i = 0; i < Math.ceil(file.bytes / CHUNK_BYTES); i++) {
              const chunkPath = location("drafts", id, file.name, `${i}.part`);
              for await (const buffer of fs.createReadStream(chunkPath)) {
                bytes += buffer.length;
                if (bytes > file.bytes) throw releaseError(422, "PLUGIN_RELEASE_SIZE_MISMATCH");
                hash.update(buffer);
                let offset = 0;
                while (offset < buffer.length) offset += (await output.write(buffer, offset, buffer.length - offset)).bytesWritten;
              }
            }
            await output.sync();
          } finally { await output.close(); }
          if (bytes !== file.bytes || hash.digest("hex") !== file.sha256) throw releaseError(422, "PLUGIN_RELEASE_SHA256_MISMATCH");
          await inspectArchive(path.join(staging, file.name), file, release.version);
        }
        // A previous verification may have crashed after rename but before saving its status.
        await fsp.rm(location("verified", id), { recursive: true, force: true });
        await fsp.rename(staging, location("verified", id));
        const result = await repo.update(id, { status: "verified", verifiedAt: new Date(), files: release.files.map((file) => ({ ...file, complete: true })), error: "" });
        // A cleanup failure must not turn a verified, immutable payload back into a draft.
        await fsp.rm(location("drafts", id), { recursive: true, force: true }).catch(() => {});
        return result;
      } catch (error) {
        await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
        await repo.update(id, { status: "draft", error: error.code === "ENOENT" ? "PLUGIN_RELEASE_CHUNKS_MISSING" : error.code || "PLUGIN_RELEASE_VERIFICATION_FAILED" });
        if (error.code === "ENOENT") throw releaseError(422, "PLUGIN_RELEASE_CHUNKS_MISSING");
        throw error;
      }
    });
  }
  async function checkFiles(release) {
    for (const file of release.files) {
      const stat = await fsp.stat(location("verified", String(release._id), file.name)).catch(() => null);
      if (!file.complete || stat?.size !== file.bytes) throw releaseError(422, "PLUGIN_RELEASE_FILE_UNAVAILABLE");
      const hash = crypto.createHash("sha256");
      for await (const buffer of fs.createReadStream(location("verified", String(release._id), file.name))) hash.update(buffer);
      if (hash.digest("hex") !== file.sha256) throw releaseError(422, "PLUGIN_RELEASE_SHA256_MISMATCH");
    }
  }
  async function publish(id, expectedRevision) {
    return locked(id, async (release) => {
      if (!["verified", "published", "withdrawn"].includes(release.status)) throw releaseError(409, "PLUGIN_RELEASE_NOT_VERIFIED");
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw releaseError(400, "PLUGIN_RELEASE_REVISION_REQUIRED");
      if (env.PLUGIN_RELEASE_SOURCE !== "database" || env.PLUGIN_RELEASE_ENABLED !== "true") throw releaseError(409, "PLUGIN_RELEASE_DISABLED");
      if (release.channel === "production" && env.PLUGIN_PRODUCTION_PUBLISH_APPROVED !== "true") throw releaseError(403, "PLUGIN_RELEASE_PRODUCTION_NOT_APPROVED");
      if (!verifyPluginReleaseManifest(release.manifest, releasePublicKey(release.channel, env))) throw releaseError(422, "PLUGIN_RELEASE_SIGNATURE_INVALID");
      await checkFiles(release);
      return repo.publish(release, expectedRevision);
    });
  }
  async function withdraw(id, expectedRevision) {
    return locked(id, async (release) => {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) throw releaseError(400, "PLUGIN_RELEASE_REVISION_REQUIRED");
      const current = await repo.channel(release.channel);
      if (String(current?.activeReleaseId) !== String(id)) throw releaseError(409, "PLUGIN_RELEASE_NOT_ACTIVE");
      return repo.withdraw(release, expectedRevision);
    });
  }
  async function remove(id) {
    return locked(id, async (release) => {
      if (!["draft", "deleting"].includes(release.status)) throw releaseError(409, "PLUGIN_RELEASE_IMMUTABLE");
      await repo.update(id, { status: "deleting" });
      await fsp.rm(location("drafts", id), { recursive: true, force: true });
      await fsp.rm(location("verified", id), { recursive: true, force: true });
      await repo.remove(id);
    });
  }
  async function active(channel, manifestVersion) {
    if (!PLUGIN_CHANNELS.includes(channel)) throw releaseError(400, "PLUGIN_RELEASE_CHANNEL_INVALID");
    const state = await repo.channel(channel);
    const id = state?.[`activeReleaseV${manifestVersion}Id`] || state?.activeReleaseId;
    if (!id) return null;
    const release = await repo.get(String(id));
    return release?.status === "published" ? release : null;
  }
  async function feed(channel, manifestVersion) {
    if (env.PLUGIN_RELEASE_ENABLED !== "true") throw releaseError(503, "PLUGIN_RELEASE_DISABLED");
    const release = await active(channel, manifestVersion);
    if (!release || Number(release.manifest.manifestVersion) !== manifestVersion) throw releaseError(503, "PLUGIN_RELEASE_DISABLED");
    if (!verifyPluginReleaseManifest(release.manifest, releasePublicKey(channel, env))) throw releaseError(503, "PLUGIN_RELEASE_SIGNATURE_INVALID");
    return release.manifest;
  }
  async function downloads() {
    const channel = env.PLUGIN_PUBLIC_DOWNLOAD_CHANNEL || env.PLUGIN_RELEASE_CHANNEL || "production";
    const unavailable = { available: false, channel, releases: [], reason: "PLUGIN_RELEASE_DISABLED" };
    if (env.PLUGIN_RELEASE_ENABLED !== "true") return unavailable;
    if ((env.PLUGIN_RELEASE_SOURCE || "env") === "env") {
      const manifest = pluginReleaseFromEnvironment(env);
      if (manifest.channel !== channel || Number(manifest.manifestVersion) !== 2
        || !verifyPluginReleaseManifest(manifest, env.PLUGIN_RELEASE_PUBLIC_KEY)) return unavailable;
      try {
        const bridge = releaseArtifacts(manifest).find((a) => a.component === "maxBridge2026");
        const url = new URL(bridge.downloadUrl);
        if (url.protocol !== "https:" || url.username || url.password) return unavailable;
        return { available: true, channel, releases: [{ maxFamily: "2026", maxVersions: manifest.maxVersions,
          version: manifest.version, downloadUrl: bridge.downloadUrl, sha256: bridge.sha256, publishedAt: manifest.publishedAt }] };
      } catch { return unavailable; }
    }
    if (env.PLUGIN_RELEASE_SOURCE !== "database") return unavailable;
    const release = await active(channel);
    if (!release || !verifyPluginReleaseManifest(release.manifest, releasePublicKey(channel, env))) return { available: false, channel, releases: [], reason: "PLUGIN_RELEASE_DISABLED" };
    const artifacts = releaseArtifacts(release.manifest).filter((a) => a.component !== "desktop");
    return { available: true, channel, releases: artifacts.map((a) => ({ maxFamily: Number(release.manifest.manifestVersion) === 2 ? "2026" : a.maxFamily, maxVersions: a.maxVersions || PLUGIN_FAMILIES[a.maxFamily], version: release.version, downloadUrl: a.downloadUrl, sha256: a.sha256, publishedAt: release.manifest.publishedAt })) };
  }
  async function publicFile(channel, version, name) {
    if (!PLUGIN_CHANNELS.includes(channel) || !safeName(name)) throw releaseError(404, "PLUGIN_RELEASE_FILE_NOT_FOUND");
    try { comparePluginVersions(version, version); } catch { throw releaseError(404, "PLUGIN_RELEASE_FILE_NOT_FOUND"); }
    const release = await repo.byVersion(channel, version);
    if (!release || !["published", "withdrawn"].includes(release.status)) throw releaseError(404, "PLUGIN_RELEASE_FILE_NOT_FOUND");
    const file = findFile(release, name);
    return { path: location("verified", String(release._id), file.name), file };
  }
  async function cleanupUploads() {
    const releases = repo.expiredDrafts ? await repo.expiredDrafts() : await repo.list();
    const abandoned = (release) => release.status === "draft" || (release.status === "verifying"
      && Date.now() - new Date(release.verificationLease).getTime() > LOCK_MS);
    for (const release of releases) {
      if (abandoned(release) && !release.uploadExpiredAt && Date.now() - new Date(release.createdAt).getTime() > EXPIRY_MS) {
        await locked(String(release._id), async (latest) => {
          if (!abandoned(latest)) return;
          await fsp.rm(location("drafts", String(release._id)), { recursive: true, force: true });
          await fsp.rm(location("verified", String(release._id) + ".staging"), { recursive: true, force: true });
          await fsp.rm(location("verified", String(release._id)), { recursive: true, force: true });
          await repo.update(String(release._id), { uploadExpiredAt: new Date(), status: "draft", error: "PLUGIN_RELEASE_UPLOAD_EXPIRED" });
        }).catch((error) => { if (error.code !== "PLUGIN_RELEASE_BUSY") throw error; });
      }
    }
  }
  async function list() {
    await cleanupUploads();
    const releases = await repo.list();
    const channels = await repo.channels();
    return { releases, channels: PLUGIN_CHANNELS.map((channel) => channels.find((entry) => entry._id === channel) || { _id: channel, activeReleaseId: null, revision: 0 }), source: env.PLUGIN_RELEASE_SOURCE || "env", enabled: env.PLUGIN_RELEASE_ENABLED === "true", maxChunkBytes: CHUNK_BYTES, publicChannel: env.PLUGIN_PUBLIC_DOWNLOAD_CHANNEL || env.PLUGIN_RELEASE_CHANNEL || "production" };
  }
  return { get, list, create, uploadStatus, chunk, verify, publish, withdraw, remove, feed, downloads, publicFile, cleanupUploads };
}

export const pluginReleaseService = createPluginReleaseService();
