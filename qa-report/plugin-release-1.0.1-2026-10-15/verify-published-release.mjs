import assert from "node:assert/strict";
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { verifyPluginReleaseManifest } from "../../backend/src/utils/pluginReleaseManifest.js";

const [directory, publicPin, output] = process.argv.slice(2);
const expected = JSON.parse(await fsp.readFile(path.join(directory, "release.json"), "utf8"));
const key = (await fsp.readFile(publicPin, "utf8")).trim();
const base = "https://3dipl.org";
const feedUrl = base + "/api/plugin/release?manifestVersion=3&channel=live-test";
const response = await fetch(feedUrl, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30000) });
assert.equal(response.status, 200);
const manifest = await response.json();
assert.deepEqual(manifest, expected);
assert.ok(verifyPluginReleaseManifest(manifest, key));
const downloads = await fetch(base + "/api/plugin/downloads", { signal: AbortSignal.timeout(30000) }).then(r => r.json());
assert.equal(downloads.available, true);
assert.equal(downloads.channel, "live-test");
assert.equal(downloads.releases.length, 2);
assert.ok(downloads.releases.every(r => r.version === expected.version));
const results = [];
for (const artifact of [manifest.desktopArtifact, ...manifest.bridgeArtifacts]) {
  const url = new URL(artifact.downloadUrl);
  assert.equal(url.origin, base);
  const full = await fetch(url, { signal: AbortSignal.timeout(600000) });
  assert.equal(full.status, 200);
  assert.match(full.headers.get("content-disposition"), /attachment;/);
  const hash = crypto.createHash("sha256");
  let bytes = 0;
  for await (const buffer of full.body) { bytes += buffer.length; hash.update(buffer); }
  const digest = hash.digest("hex");
  assert.equal(digest, artifact.sha256);
  const local = path.join(directory, path.posix.basename(url.pathname));
  assert.equal(bytes, (await fsp.stat(local)).size);
  const range = await fetch(url, { headers: { Range: "bytes=0-31" }, signal: AbortSignal.timeout(30000) });
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), `bytes 0-31/${bytes}`);
  const remoteHead = Buffer.from(await range.arrayBuffer());
  const input = await fsp.open(local, "r");
  const localHead = Buffer.alloc(32);
  try { await input.read(localHead, 0, 32, 0); } finally { await input.close(); }
  assert.deepEqual(remoteHead, localHead);
  results.push({ name: path.posix.basename(url.pathname), bytes, sha256: digest, range: true });
  console.log("REMOTE_VERIFIED " + results.at(-1).name);
}
const page = await fetch(base + "/plugin", { signal: AbortSignal.timeout(30000) });
assert.equal(page.status, 200);
assert.match(page.headers.get("content-type"), /text\/html/);
await page.arrayBuffer();
const etag = response.headers.get("etag");
assert.ok(etag);
const cached = await fetch(feedUrl, { headers: { "If-None-Match": etag }, signal: AbortSignal.timeout(30000) });
assert.equal(cached.status, 304);
const report = { ok: true, checkedAt: new Date().toISOString(), version: manifest.version,
  channel: manifest.channel, feedSignatureValid: true, downloadsValid: true, pageStatus: 200,
  etagRevalidation: 304, files: results };
await fsp.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
