import "dotenv/config";
import { connectDb, closeDbConnections } from "../src/config/db.js";

try {
  await connectDb();
  const { migrateSubscriptions } = await import("../src/utils/subscriptionMigrationService.js");
  const report = await migrateSubscriptions({
    execute: process.argv.includes("--execute"), confirm: process.env.MIGRATION_CONFIRM || "",
    backupId: process.env.SUBSCRIPTION_BACKUP_RUN_ID || "",
  });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await closeDbConnections();
}
