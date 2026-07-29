import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function databaseNameFromUri(uri) {
  const withoutQuery = String(uri || "").split("?")[0].replace(/\/+$/, "");
  const name = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
  if (!name || name.includes("@") || name.includes(":")) {
    throw new Error("MongoDB URI must include an explicit database name.");
  }
  return decodeURIComponent(name);
}

export function safeDatabaseIdentity(uri) {
  const value = String(uri || "").trim();
  const database = databaseNameFromUri(value);
  const authority = value
    .replace(/^mongodb(?:\+srv)?:\/\//, "")
    .split("/")[0]
    .replace(/^.*@/, "")
    .toLowerCase();
  return `${authority}/${database.toLowerCase()}`;
}

export function assertIsolatedRestoreTarget(targetUri, productionUris = []) {
  const target = safeDatabaseIdentity(targetUri);
  if (productionUris.filter(Boolean).some((uri) => safeDatabaseIdentity(uri) === target)) {
    throw new Error("Restore target must be an isolated database and cannot match a production database.");
  }
  return target;
}

export function restoreNamespaceArguments(sourceDatabase, targetUri) {
  const source = String(sourceDatabase || "").trim();
  const target = databaseNameFromUri(targetUri);
  const validName = /^[A-Za-z0-9_.-]+$/;
  if (!validName.test(source) || !validName.test(target)) {
    throw new Error("Restore source and target database names contain unsupported characters.");
  }
  if (["admin", "config", "local"].includes(target.toLowerCase())) {
    throw new Error("Restore target cannot be a MongoDB system database.");
  }
  return [`--nsFrom=${source}.*`, `--nsTo=${target}.*`];
}

export async function sha256File(filePath) {
  const digest = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) digest.update(chunk);
  return digest.digest("hex");
}

export function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
      const error = new Error(`${command} failed with exit code ${code}: ${stderr.slice(-1000)}`);
      error.code = "BACKUP_COMMAND_FAILED";
      error.exitCode = code;
      return reject(error);
    });
  });
}

function dateKey(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function monthKey(value) {
  return new Date(value).toISOString().slice(0, 7);
}

function isoWeekKey(value) {
  const date = new Date(value);
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function keepNewestPerBucket(records, bucket, limit, keep) {
  const seen = new Set();
  for (const record of records) {
    const key = bucket(record.verifiedAt || record.createdAt);
    if (seen.has(key)) continue;
    seen.add(key);
    keep.add(String(record._id));
    if (seen.size >= limit) break;
  }
}

export function backupRetentionSelection(records = []) {
  const sorted = [...records].sort((a, b) =>
    new Date(b.verifiedAt || b.createdAt) - new Date(a.verifiedAt || a.createdAt),
  );
  const keep = new Set();
  keepNewestPerBucket(sorted, dateKey, 14, keep);
  keepNewestPerBucket(sorted, isoWeekKey, 8, keep);
  keepNewestPerBucket(sorted, monthKey, 12, keep);
  return {
    keepIds: keep,
    prune: sorted.filter((record) => !keep.has(String(record._id))),
  };
}

export async function writeJsonFile(filePath, value) {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}
