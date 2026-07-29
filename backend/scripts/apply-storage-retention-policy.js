import "dotenv/config";
import mongoose from "mongoose";
import SiteSetting from "../src/models/SiteSetting.js";

const execute = process.argv.includes("--execute");
const uri = String(process.env.MONGO_CORE_URI || process.env.MONGO_URI || "").trim();
if (!uri) throw new Error("MONGO_CORE_URI or MONGO_URI is required.");

await mongoose.connect(uri);
try {
  const current = await SiteSetting.findOne({ key: "homepage" }).lean();
  const policy = {
    getlinkDetailRetentionDaysAfterExpiry: 1,
    getlinkHistoryRetentionDaysAfterExpiry: 365,
    marketplaceDownloadHistoryRetentionDays: 365,
    marketplaceReportHistoryRetentionDays: 365,
    auditLogHistoryRetentionDays: 365,
  };
  console.log(JSON.stringify({ execute, current: Object.fromEntries(
    Object.keys(policy).map((key) => [key, current?.[key] ?? null]),
  ), policy }, null, 2));
  if (!execute) {
    console.log("Dry-run only. Re-run with --execute after reviewing the policy.");
  } else {
    if (process.env.STORAGE_RETENTION_CONFIRM !== "apply-365-day-policy") {
      throw new Error("Set STORAGE_RETENTION_CONFIRM=apply-365-day-policy before --execute.");
    }
    await SiteSetting.findOneAndUpdate(
      { key: "homepage" },
      { $set: { key: "homepage", ...policy } },
      { upsert: true, new: true },
    );
    console.log("The 365-day online retention policy is active.");
  }
} finally {
  await mongoose.disconnect();
}
