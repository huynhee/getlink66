import test from "node:test";
import assert from "node:assert/strict";
import { createPluginReleasePublication } from "../src/services/pluginReleasePublication.js";

function fixture({ memory = false, fail = "" } = {}) {
  const release = { _id: "000000000000000000000001", channel: "live-test", status: "verified", manifest: { manifestVersion: 3 } };
  const state = { release: structuredClone(release), channel: { _id: "live-test", revision: 2, activeReleaseId: "previous", activeReleaseV2Id: "legacy" } };
  let ended = 0;
  let started = 0;
  const writes = [];
  const session = {
    async withTransaction(operation) {
      if (fail === "unsupported") throw new Error("Transaction numbers are only allowed on a replica set member or mongos");
      this.state = structuredClone(state);
      const result = await operation();
      Object.assign(state, this.state);
      return result;
    },
    async endSession() { ended += 1; },
  };
  const releases = {
    findByIdAndUpdate(id, update, options = {}) {
      return { async lean() {
        assert.equal(id, release._id);
        writes.push(options.session);
        if (fail === "release") throw new Error("release write failed");
        const target = (options.session || {}).state || state;
        Object.assign(target.release, structuredClone(update.$set));
        return structuredClone(target.release);
      } };
    },
  };
  const channels = {
    async updateOne() {},
    findOneAndUpdate(filter, update, options = {}) {
      return { async lean() {
        writes.push(options.session);
        if (fail === "channel") throw new Error("channel write failed");
        const target = (options.session || {}).state || state;
        if (target.channel.revision !== filter.revision
          || (filter.activeReleaseId && target.channel.activeReleaseId !== filter.activeReleaseId)) return null;
        Object.assign(target.channel, structuredClone(update.$set));
        target.channel.revision += update.$inc.revision;
        return structuredClone(target.channel);
      } };
    },
  };
  const publication = createPluginReleasePublication({ releases, channels, memory, startSession: async () => { started += 1; return session; } });
  return { publication, release, state, session, writes, ended: () => ended, started: () => started };
}

test("publication commits release status and contract pointer in the same session", async () => {
  const f = fixture();
  const result = await f.publication.publish(f.release, 2);
  assert.equal(result.release.status, "published");
  assert.ok(result.release.publishedAt instanceof Date);
  assert.equal(f.state.channel.activeReleaseId, f.release._id);
  assert.equal(f.state.channel.activeReleaseV3Id, f.release._id);
  assert.equal(f.state.channel.activeReleaseV2Id, "legacy");
  assert.equal(f.state.channel.revision, 3);
  assert.deepEqual(f.writes, [f.session, f.session]);
  assert.equal(f.ended(), 1);
});

test("stale publication revision leaves the verified release and current feed unchanged", async () => {
  const f = fixture();
  await assert.rejects(f.publication.publish(f.release, 1), { code: "PLUGIN_RELEASE_REVISION_CONFLICT" });
  assert.equal(f.state.release.status, "verified");
  assert.equal(f.state.release.publishedAt, undefined);
  assert.equal(f.state.channel.activeReleaseId, "previous");
  assert.equal(f.state.channel.revision, 2);
  assert.equal(f.ended(), 1);
});

for (const fail of ["release", "channel", "unsupported"]) {
  test(`publication does not partially commit or fall back when ${fail} fails`, async () => {
    const f = fixture({ fail });
    await assert.rejects(f.publication.publish(f.release, 2));
    assert.equal(f.state.release.status, "verified");
    assert.equal(f.state.release.publishedAt, undefined);
    assert.equal(f.state.channel.activeReleaseId, "previous");
    assert.equal(f.state.channel.revision, 2);
    assert.equal(f.started(), 1);
    assert.equal(f.ended(), 1);
  });
}

test("withdrawal atomically clears both contracts while preserving the original publication date", async () => {
  const f = fixture();
  const published = await f.publication.publish(f.release, 2);
  const result = await f.publication.withdraw(published.release, 3);
  assert.equal(result.release.status, "withdrawn");
  assert.deepEqual(result.release.publishedAt, published.release.publishedAt);
  assert.equal(f.state.channel.activeReleaseId, null);
  assert.equal(f.state.channel.activeReleaseV2Id, null);
  assert.equal(f.state.channel.activeReleaseV3Id, null);
  assert.equal(f.state.channel.revision, 4);
  await assert.rejects(f.publication.withdraw(published.release, 4), { code: "PLUGIN_RELEASE_REVISION_CONFLICT" });
  assert.equal(f.state.release.status, "withdrawn");
});

test("withdrawal with a stale revision cannot leave a published feed pointing to withdrawn data", async () => {
  const f = fixture();
  const published = await f.publication.publish(f.release, 2);
  await assert.rejects(f.publication.withdraw(published.release, 2), { code: "PLUGIN_RELEASE_REVISION_CONFLICT" });
  assert.equal(f.state.release.status, "published");
  assert.equal(f.state.channel.activeReleaseId, f.release._id);
  assert.equal(f.state.channel.revision, 3);
});

test("isolated memory publication compensates a failed CAS without opening an Atlas fallback", async () => {
  const f = fixture({ memory: true });
  await assert.rejects(f.publication.publish(f.release, 1), { code: "PLUGIN_RELEASE_REVISION_CONFLICT" });
  assert.equal(f.state.release.status, "verified");
  assert.equal(f.state.release.publishedAt, null);
  assert.equal(f.state.channel.activeReleaseId, "previous");
  assert.equal(f.started(), 0);
  assert.equal(f.ended(), 0);
});
