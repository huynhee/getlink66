import PluginRelease from "../models/PluginRelease.js";
import PluginReleaseChannel from "../models/PluginReleaseChannel.js";
import { isMemoryDb } from "../config/memoryStore.js";

function publicationError(code) {
  return Object.assign(new Error(code), { status: 409, code });
}

export function createPluginReleasePublication({
  releases = PluginRelease,
  channels = PluginReleaseChannel,
  memory = isMemoryDb(),
  startSession = () => releases.db.startSession(),
} = {}) {
  const memoryLocks = new Map();

  async function mutate(release, revision, withdrawing) {
    try {
      await channels.updateOne({ _id: release.channel }, { $setOnInsert: { activeReleaseId: null, revision: 0 } }, { upsert: true });
    } catch (error) { if (error.code !== 11000) throw error; }

    async function commit(session) {
      const options = session ? { session } : {};
      const filter = { _id: release.channel, revision };
      const patch = { activeReleaseId: withdrawing ? null : release._id };
      if (withdrawing) {
        filter.activeReleaseId = release._id;
        Object.assign(patch, { activeReleaseV2Id: null, activeReleaseV3Id: null });
      } else {
        patch[`activeReleaseV${Number(release.manifest.manifestVersion)}Id`] = release._id;
      }
      const status = withdrawing ? { status: "withdrawn" } : { status: "published", publishedAt: release.publishedAt || new Date() };
      const updated = await releases.findByIdAndUpdate(release._id, { $set: status }, { new: true, ...options }).lean();
      if (!updated) throw publicationError("PLUGIN_RELEASE_NOT_FOUND");
      const channel = await channels.findOneAndUpdate(filter, { $set: patch, $inc: { revision: 1 } }, { new: true, ...options }).lean();
      if (!channel) throw publicationError("PLUGIN_RELEASE_REVISION_CONFLICT");
      return { release: updated, channel };
    }

    if (memory) {
      // Only the isolated development model uses compensation; Atlas must commit both records together.
      const previous = memoryLocks.get(release.channel) || Promise.resolve();
      let unlock;
      const lock = new Promise((resolve) => { unlock = resolve; });
      memoryLocks.set(release.channel, lock);
      await previous;
      try { return await commit(); }
      catch (error) {
        await releases.findByIdAndUpdate(release._id, { $set: { status: release.status, publishedAt: release.publishedAt || null } }).lean();
        throw error;
      } finally {
        unlock();
        if (memoryLocks.get(release.channel) === lock) memoryLocks.delete(release.channel);
      }
    }

    const session = await startSession();
    try {
      return await session.withTransaction(() => commit(session), {
        readConcern: { level: "snapshot" }, writeConcern: { w: "majority" },
      });
    }
    finally { await session.endSession(); }
  }

  return {
    publish: (release, revision) => mutate(release, revision, false),
    withdraw: (release, revision) => mutate(release, revision, true),
  };
}
