import assert from "node:assert/strict";
import fsp from "node:fs/promises";

const output = process.argv[2];
if (!output) throw new Error("Output path required");
const base = "https://3dipl.org";
const response = await fetch(base + "/api/plugin/release?manifestVersion=3&channel=live-test", {
  headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(30000)
});
assert.equal(response.status, 200);
const manifest = await response.json();
assert.equal(manifest.channel, "live-test");
assert.equal(manifest.version, "1.0.2");
const downloads = await fetch(base + "/api/plugin/downloads", { signal: AbortSignal.timeout(30000) });
assert.equal(downloads.status, 200);
const snapshot = { checkedAt: new Date().toISOString(), etag: response.headers.get("etag"),
  manifest, downloads: await downloads.json() };
await fsp.writeFile(output, JSON.stringify(snapshot, null, 2), { flag: "wx" });
console.log(JSON.stringify({ before: manifest.version, etag: snapshot.etag, output }));
