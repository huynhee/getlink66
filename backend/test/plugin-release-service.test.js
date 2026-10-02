import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createPluginReleaseService, CHUNK_BYTES, describeReleaseFiles, inspectReleaseArchive } from "../src/services/pluginReleaseService.js";
import { canonicalPluginReleaseV3, canonicalPluginReleaseManifest, canonicalPluginReleaseArtifact, verifyPluginReleaseManifest, PLUGIN_FAMILIES } from "../src/utils/pluginReleaseManifest.js";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const sign = (manifest) => ({ ...manifest, signature: crypto.sign("sha256", canonicalPluginReleaseV3(manifest), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64") });

function payload(version = "1.0.1", channel = "live-test", buffers) {
  buffers ||= [Buffer.from("desktop payload"), Buffer.from("legacy payload"), Buffer.from("modern payload")];
  const artifact = (component, family, versions, index) => ({
    component, maxFamily: family, maxVersions: versions, channel, version,
    downloadUrl: `https://3dipl.org/plugin-releases/${channel}/${version}/${index === 0 ? "desktop.zip" : `bridge-${family}.mzp`}`,
    sha256: crypto.createHash("sha256").update(buffers[index]).digest("hex"),
    protocolMinimum: 2, protocolMaximum: 2, requiresMaxRestart: index !== 0,
    signatureAlgorithm: "ES256", publishedAt: "2026-10-01T00:00:00.000Z",
  });
  const manifest = sign({
    manifestVersion: 3, version, minimumVersion: "1.0.1", channel,
    maxVersions: Object.values(PLUGIN_FAMILIES).flat(), publishedAt: "2026-10-01T00:00:00.000Z", signatureAlgorithm: "ES256",
    desktopArtifact: artifact("desktop", "", Object.values(PLUGIN_FAMILIES).flat(), 0),
    bridgeArtifacts: [artifact("maxBridgeLegacy", "2020-2025", PLUGIN_FAMILIES["2020-2025"], 1), artifact("maxBridgeModern", "2026-2027", PLUGIN_FAMILIES["2026-2027"], 2)],
    releaseNotes: { vi: "Cập nhật <3DIPL> & tải nhanh", en: "Update & download" },
  });
  const files = [manifest.desktopArtifact, ...manifest.bridgeArtifacts].map((a, index) => ({ name: path.posix.basename(new URL(a.downloadUrl).pathname), bytes: buffers[index].length }));
  return { manifest, files, buffers };
}

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "3dipl-release-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const records = new Map();
  const channels = new Map();
  let nextId = 0;
  const copy = (value) => value == null ? value : structuredClone(value);
  const repo = {
    list: async () => [...records.values()].map(copy),
    get: async (id) => copy(records.get(id)),
    byVersion: async (channel, version) => copy([...records.values()].find((r) => r.channel === channel && r.version === version)),
    create: async (data) => {
      if ([...records.values()].some((r) => r.channel === data.channel && r.version === data.version)) throw Object.assign(new Error(), { code: 11000 });
      const record = { ...copy(data), _id: (++nextId).toString(16).padStart(24, "0"), createdAt: new Date() };
      records.set(record._id, record);
      return copy(record);
    },
    update: async (id, patch) => { Object.assign(records.get(id), copy(patch)); return copy(records.get(id)); },
    remove: async (id) => records.delete(id),
    channels: async () => [...channels.values()].map(copy),
    channel: async (name) => copy(channels.get(name)),
    publish: async (release, revision) => {
      const state = channels.get(release.channel) || { _id: release.channel, revision: 0, activeReleaseId: null };
      if (state.revision !== revision) throw Object.assign(new Error(), { status: 409, code: "PLUGIN_RELEASE_REVISION_CONFLICT" });
      const channel = { ...state, activeReleaseId: release._id, [`activeReleaseV${release.manifest.manifestVersion}Id`]: release._id, revision: revision + 1 };
      const updated = { ...records.get(release._id), status: "published", publishedAt: release.publishedAt || new Date() };
      channels.set(release.channel, channel);
      records.set(release._id, updated);
      return { channel: copy(channel), release: copy(updated) };
    },
    withdraw: async (release, revision) => {
      const state = channels.get(release.channel);
      if (state.revision !== revision || state.activeReleaseId !== release._id) throw Object.assign(new Error(), { status: 409, code: "PLUGIN_RELEASE_REVISION_CONFLICT" });
      const channel = { ...state, activeReleaseId: null, activeReleaseV2Id: null, activeReleaseV3Id: null, revision: revision + 1 };
      const updated = { ...records.get(release._id), status: "withdrawn" };
      channels.set(release.channel, channel);
      records.set(release._id, updated);
      return { channel: copy(channel), release: copy(updated) };
    },
  };
  const env = { PUBLIC_BASE_URL: "https://3dipl.org", PLUGIN_RELEASE_SOURCE: "database", PLUGIN_RELEASE_ENABLED: "true", PLUGIN_PUBLIC_DOWNLOAD_CHANNEL: "live-test", PLUGIN_LIVE_TEST_RELEASE_PUBLIC_KEY: spki, PLUGIN_PRODUCTION_RELEASE_PUBLIC_KEY: spki };
  const inspected = [];
  const service = createPluginReleaseService({ repo, root, env, inspectArchive: async (_path, file) => inspected.push(file.name) });
  async function prepared(version = "1.0.1", channel = "live-test", buffers) {
    const p = payload(version, channel, buffers);
    const release = await service.create(p.manifest, p.files, "admin-fixture");
    for (let i = 0; i < p.files.length; i++) {
      for (let offset = 0, index = 0; offset < p.buffers[i].length; offset += CHUNK_BYTES, index++) {
        await service.chunk(release._id, p.files[i].name, index, p.buffers[i].subarray(offset, offset + CHUNK_BYTES));
      }
    }
    return { release, ...p };
  }
  return { service, env, root, records, channels, prepared, inspected, repo };
}

function legacyPayload() {
  const v2 = payload("1.0.1");
  const signBytes = (bytes) => crypto.sign("sha256", bytes, { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64");
  const desktopArtifact = { ...v2.manifest.desktopArtifact, maxVersions: ["2026"] };
  desktopArtifact.signature = signBytes(canonicalPluginReleaseArtifact(desktopArtifact));
  const bridge = { ...v2.manifest.bridgeArtifacts[1], component: "maxBridge2026" };
  bridge.signature = signBytes(canonicalPluginReleaseArtifact(bridge));
  const manifest = { ...v2.manifest, manifestVersion: 2, maxVersions: ["2026"], downloadUrl: bridge.downloadUrl,
    sha256: bridge.sha256, desktopArtifact, maxBridge2026Artifact: bridge };
  delete manifest.bridgeArtifacts;
  manifest.signature = signBytes(canonicalPluginReleaseManifest(manifest));
  return { manifest, files: [v2.files[0], v2.files[2]], buffers: [v2.buffers[0], v2.buffers[2]] };
}

test("V3 signature binds channel, both families, protocol, notes, URL and hash", () => {
  const { manifest } = payload();
  assert.equal(verifyPluginReleaseManifest(manifest, spki), true);
  for (const mutate of [
    (m) => { m.channel = "staging"; },
    (m) => { m.desktopArtifact.downloadUrl += "?wrong=1"; },
    (m) => { m.bridgeArtifacts[0].maxVersions = ["2026"]; },
    (m) => { m.bridgeArtifacts[1].protocolMaximum = 3; },
    (m) => { m.releaseNotes.vi += " changed"; },
    (m) => { m.desktopArtifact.sha256 = "0".repeat(64); },
  ]) {
    const copy = structuredClone(manifest);
    mutate(copy);
    assert.equal(verifyPluginReleaseManifest(copy, spki), false);
  }
  const reordered = { ...manifest, bridgeArtifacts: [...manifest.bridgeArtifacts].reverse() };
  assert.equal(verifyPluginReleaseManifest(reordered, spki), true);
});

test("release uploads resume, retry idempotently, verify, publish and withdraw", async (t) => {
  const { service, prepared, inspected } = await fixture(t);
  const { release, files, buffers } = await prepared("1.0.1", "live-test", [Buffer.alloc(CHUNK_BYTES + 7, 3), Buffer.from("legacy"), Buffer.from("modern")]);
  assert.deepEqual((await service.uploadStatus(release._id, files[0].name)).receivedChunks, [0, 1]);
  await service.chunk(release._id, files[0].name, 1, buffers[0].subarray(CHUNK_BYTES));
  await assert.rejects(service.chunk(release._id, files[0].name, 1, Buffer.alloc(7)), { code: "PLUGIN_RELEASE_CHUNK_CONFLICT" });
  await assert.rejects(service.publicFile("live-test", "1.0.1", files[0].name), { status: 404 });
  assert.equal((await service.verify(release._id)).status, "verified");
  assert.equal(inspected.length, 3);
  await assert.rejects(service.chunk(release._id, files[0].name, 1, Buffer.alloc(7)), { code: "PLUGIN_RELEASE_IMMUTABLE" });
  assert.equal((await service.list()).channels.find((c) => c._id === "live-test").revision, 0);
  const published = await service.publish(release._id, 0);
  assert.equal(published.channel.revision, 1);
  assert.equal((await service.feed("live-test", 3)).version, "1.0.1");
  assert.equal((await service.downloads()).releases.length, 2);
  assert.equal(await fs.readFile((await service.publicFile("live-test", "1.0.1", files[0].name)).path).then((b) => b.equals(buffers[0])), true);
  await assert.rejects(service.remove(release._id), { code: "PLUGIN_RELEASE_IMMUTABLE" });
  await service.withdraw(release._id, 1);
  await assert.rejects(service.feed("live-test", 3), { code: "PLUGIN_RELEASE_DISABLED" });
  assert.equal((await service.downloads()).available, false);
  assert.ok(await service.publicFile("live-test", "1.0.1", files[0].name));
  await service.publish(release._id, 2);
  assert.equal((await service.feed("live-test", 3)).version, "1.0.1");
});

test("verification rejects missing chunks, hash mismatch and wrong signing pin", async (t) => {
  const { service, env, prepared } = await fixture(t);
  const p = payload();
  const empty = await service.create(p.manifest, p.files, "admin");
  await assert.rejects(service.verify(empty._id), { code: "PLUGIN_RELEASE_CHUNKS_MISSING" });
  await service.remove(empty._id);
  const { release } = await prepared();
  env.PLUGIN_LIVE_TEST_RELEASE_PUBLIC_KEY = "wrong";
  await assert.rejects(service.verify(release._id), { code: "PLUGIN_RELEASE_SIGNATURE_INVALID" });
  env.PLUGIN_LIVE_TEST_RELEASE_PUBLIC_KEY = spki;
  const modified = (await service.get(release._id)).manifest;
  modified.desktopArtifact.sha256 = "0".repeat(64);
  const f = await fixture(t);
  const bad = await f.service.create(sign(modified), p.files, "admin");
  for (let i = 0; i < p.files.length; i++) await f.service.chunk(bad._id, p.files[i].name, 0, p.buffers[i]);
  await assert.rejects(f.service.verify(bad._id), { code: "PLUGIN_RELEASE_SHA256_MISMATCH" });
  assert.equal((await f.service.get(bad._id)).status, "draft");
});

test("publishing concurrently has one current release and detects stale revisions", async (t) => {
  const { service, prepared, channels } = await fixture(t);
  const a = await prepared();
  const b = await prepared("1.0.2");
  await service.verify(a.release._id);
  await service.verify(b.release._id);
  const results = await Promise.allSettled([service.publish(a.release._id, 0), service.publish(b.release._id, 0)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "PLUGIN_RELEASE_REVISION_CONFLICT");
  assert.equal(channels.get("live-test").revision, 1);
  assert.equal((await service.feed("live-test", 3)).version, (await service.get(channels.get("live-test").activeReleaseId)).version);
  const rejected = [a, b].find((item) => item.release._id !== channels.get("live-test").activeReleaseId);
  assert.equal((await service.get(rejected.release._id)).status, "verified");
  assert.equal((await service.get(rejected.release._id)).publishedAt, undefined);
  await assert.rejects(service.publicFile("live-test", rejected.release.version, rejected.files[0].name), { status: 404 });
  await service.publish(rejected.release._id, 1);
  assert.equal((await service.feed("live-test", 3)).version, rejected.release.version);
});

test("kill switch and production approval remain closed; expired drafts cannot upload", async (t) => {
  const { service, env, records, prepared, root } = await fixture(t);
  const p = await prepared("1.0.1", "production");
  await service.verify(p.release._id);
  await assert.rejects(service.publish(p.release._id, 0), { code: "PLUGIN_RELEASE_PRODUCTION_NOT_APPROVED" });
  const draft = await prepared();
  records.get(draft.release._id).createdAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await assert.rejects(service.chunk(draft.release._id, draft.files[0].name, 0, draft.buffers[0]), { status: 410 });
  await service.list();
  await assert.rejects(fs.stat(path.join(root, "drafts", draft.release._id)), { code: "ENOENT" });
  const interrupted = await prepared("1.0.2");
  const record = records.get(interrupted.release._id);
  const orphanedPayload = path.join(root, "verified", interrupted.release._id);
  await fs.mkdir(orphanedPayload, { recursive: true });
  await fs.writeFile(path.join(orphanedPayload, "desktop.zip"), "orphaned verification output");
  Object.assign(record, { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), status: "verifying", verificationLease: new Date() });
  await service.list();
  assert.equal((await service.get(interrupted.release._id)).status, "verifying");
  record.verificationLease = new Date(Date.now() - 31 * 60 * 1000);
  await service.list();
  assert.equal((await service.get(interrupted.release._id)).error, "PLUGIN_RELEASE_UPLOAD_EXPIRED");
  await assert.rejects(fs.stat(path.join(root, "drafts", interrupted.release._id)), { code: "ENOENT" });
  await assert.rejects(fs.stat(orphanedPayload), { code: "ENOENT" });
  env.PLUGIN_RELEASE_ENABLED = "false";
  await assert.rejects(service.feed("production", 3), { code: "PLUGIN_RELEASE_DISABLED" });
  assert.equal((await service.downloads()).available, false);
});

test("production publication still requires its own trusted ES256 key and explicit approval", async (t) => {
  const { service, env, prepared, records } = await fixture(t);
  const productionKey = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  env.PLUGIN_PRODUCTION_RELEASE_PUBLIC_KEY = productionKey.publicKey.export({ type: "spki", format: "der" }).toString("base64");
  env.PLUGIN_PUBLIC_DOWNLOAD_CHANNEL = "production";
  const { release } = await prepared("1.0.1", "production");
  await assert.rejects(service.verify(release._id), { code: "PLUGIN_RELEASE_SIGNATURE_INVALID" });
  const manifest = records.get(release._id).manifest;
  manifest.signature = crypto.sign("sha256", canonicalPluginReleaseV3(manifest), {
    key: productionKey.privateKey, dsaEncoding: "ieee-p1363",
  }).toString("base64");
  await service.verify(release._id);
  await assert.rejects(service.publish(release._id, 0), { code: "PLUGIN_RELEASE_PRODUCTION_NOT_APPROVED" });
  env.PLUGIN_PRODUCTION_PUBLISH_APPROVED = "true";
  await service.publish(release._id, 0);
  assert.equal((await service.feed("production", 3)).channel, "production");
  assert.equal((await service.downloads()).available, true);
  assert.equal(verifyPluginReleaseManifest(await service.feed("production", 3), spki), false);
  env.PLUGIN_PRODUCTION_RELEASE_PUBLIC_KEY = spki;
  await assert.rejects(service.feed("production", 3), { code: "PLUGIN_RELEASE_SIGNATURE_INVALID" });
  assert.equal((await service.downloads()).available, false);
});

test("file metadata rejects foreign origins, traversal, duplicate files and oversized artifacts", () => {
  const { manifest, files } = payload();
  const env = { PUBLIC_BASE_URL: "https://3dipl.org" };
  for (const url of ["https://evil.test/desktop.zip", "https://3dipl.org/plugin-releases/live-test/1.0.1/../desktop.zip", manifest.desktopArtifact.downloadUrl + "?secret=1"]) {
    assert.throws(() => describeReleaseFiles({ ...manifest, desktopArtifact: { ...manifest.desktopArtifact, downloadUrl: url } }, files, env));
  }
  assert.throws(() => describeReleaseFiles(manifest, files.map((file) => ({ ...file, bytes: 513 * 1024 * 1024 })), env));
  assert.throws(() => describeReleaseFiles(manifest, [...files, files[0]], env));
});

test("archive verification fails closed for non-ZIP payloads", async (t) => {
  const { root } = await fixture(t);
  const file = path.join(root, "bad.zip");
  await fs.writeFile(file, "not a ZIP");
  await assert.rejects(inspectReleaseArchive(file, { role: "desktop" }, "1.0.1"), { code: "PLUGIN_RELEASE_ARCHIVE_INVALID" });
});

test("shared Node/.NET fixture signs Unicode and escapes identically", async () => {
  const fixture = JSON.parse(await fs.readFile(new URL("../../docs/contracts/plugin-v3-canonical-fixture.json", import.meta.url), "utf8"));
  assert.equal(crypto.createHash("sha256").update(canonicalPluginReleaseV3(fixture.manifest)).digest("hex"), fixture.canonicalSha256);
  assert.equal(verifyPluginReleaseManifest(fixture.manifest, fixture.publicKey), true);
  assert.equal(verifyPluginReleaseManifest({ ...fixture.manifest, publishedAt: null }, fixture.publicKey), false);
  assert.equal(verifyPluginReleaseManifest({ ...fixture.manifest, releaseNotes: { vi: "\ud800" } }, fixture.publicKey), false);
});

test("publishing V3 preserves the independently signed V2 feed without env fallback", async (t) => {
  const { service, prepared, env } = await fixture(t);
  const { manifest, files, buffers } = legacyPayload();
  const legacy = await service.create(manifest, files, "admin");
  await service.chunk(legacy._id, files[0].name, 0, buffers[0]);
  await service.chunk(legacy._id, files[1].name, 0, buffers[1]);
  await service.verify(legacy._id);
  await service.publish(legacy._id, 0);
  const modern = await prepared("1.0.2");
  await service.verify(modern.release._id);
  await service.publish(modern.release._id, 1);
  assert.equal((await service.feed("live-test", 2)).version, "1.0.1");
  assert.equal((await service.feed("live-test", 3)).version, "1.0.2");
  await service.withdraw(modern.release._id, 2);
  env.PLUGIN_RELEASE_URL = "https://3dipl.org/old-env.mzp";
  await assert.rejects(service.feed("live-test", 2), { code: "PLUGIN_RELEASE_DISABLED" });
  await assert.rejects(service.feed("live-test", 3), { code: "PLUGIN_RELEASE_DISABLED" });
});

test("public downloads preserve signed env V2 until the explicit database switch", async (t) => {
  const { service, env } = await fixture(t);
  const { manifest } = legacyPayload();
  Object.assign(env, { PLUGIN_RELEASE_SOURCE: "env", PLUGIN_RELEASE_PUBLIC_KEY: spki,
    PLUGIN_RELEASE_CHANNEL: manifest.channel, PLUGIN_RELEASE_MANIFEST_VERSION: "2", PLUGIN_RELEASE_VERSION: manifest.version,
    PLUGIN_MINIMUM_VERSION: manifest.minimumVersion, PLUGIN_RELEASE_URL: manifest.downloadUrl, PLUGIN_RELEASE_SHA256: manifest.sha256,
    PLUGIN_RELEASE_SIGNATURE: manifest.signature, PLUGIN_RELEASE_PUBLISHED_AT: manifest.publishedAt });
  for (const [prefix, artifact] of [["PLUGIN_DESKTOP_RELEASE", manifest.desktopArtifact], ["PLUGIN_MAX_BRIDGE_RELEASE", manifest.maxBridge2026Artifact]]) {
    for (const [key, value] of Object.entries({ URL: artifact.downloadUrl, SHA256: artifact.sha256, SIGNATURE: artifact.signature,
      PUBLISHED_AT: artifact.publishedAt, PROTOCOL_MINIMUM: artifact.protocolMinimum, PROTOCOL_MAXIMUM: artifact.protocolMaximum })) {
      env[`${prefix}_${key}`] = String(value);
    }
  }
  const downloads = await service.downloads();
  assert.equal(downloads.available, true);
  assert.equal(downloads.releases[0].downloadUrl, manifest.downloadUrl);
  assert.equal(downloads.releases[0].maxFamily, "2026");
  env.PLUGIN_RELEASE_SOURCE = "database";
  assert.equal((await service.downloads()).available, false);
  env.PLUGIN_RELEASE_SOURCE = "env";
  env.PLUGIN_RELEASE_SHA256 = "0".repeat(64);
  assert.equal((await service.downloads()).available, false);
  env.PLUGIN_RELEASE_SHA256 = manifest.sha256;
  env.PLUGIN_RELEASE_ENABLED = "false";
  assert.equal((await service.downloads()).available, false);
});
