import BackupRun from "../models/BackupRun.js";
import User from "../models/User.js";
import { migrateSubscriptionUser } from "./subscriptionScheduleService.js";

export async function assertSubscriptionMigrationBackup(backupId, at = new Date()) {
  const backup = backupId ? await BackupRun.findById(backupId) : null;
  if (!backup || backup.kind !== "core" || backup.status !== "verified" || !backup.artifactDriveFileId
    || !backup.sourceSha256 || !backup.verifiedAt || new Date(backup.verifiedAt) > at
    || at.getTime() - new Date(backup.verifiedAt).getTime() > 26 * 3600000) {
    throw new Error("A verified Core backup less than 26 hours old is required");
  }
  return backup;
}

export async function migrateSubscriptions({ execute = false, backupId = "", confirm = "", at = new Date(), batchSize = 200 } = {}) {
  if (execute) {
    if (confirm !== "subscription-calendar-v2") throw new Error("MIGRATION_CONFIRM=subscription-calendar-v2 is required after backup review");
    await assertSubscriptionMigrationBackup(backupId, at);
  }
  const query = { subscriptionManaged: { $ne: true }, proUntil: { $gt: at } };
  const total = await User.countDocuments(query);
  const report = { mode: execute ? "execute" : "dry-run", total, migrated: 0, preserved: "Existing quota and exact expiry", lastUserId: null };
  if (!execute) return report;
  let after = null;
  for (;;) {
    const users = await User.find({ ...query, ...(after ? { _id: { $gt: after } } : {}) }).sort({ _id: 1 }).limit(batchSize);
    if (!users.length) break;
    for (const user of users) {
      await migrateSubscriptionUser(user._id, { at });
      report.migrated += 1;
      after = user._id;
      report.lastUserId = String(after);
    }
  }
  return report;
}
