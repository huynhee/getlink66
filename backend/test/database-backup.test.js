import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertIsolatedRestoreTarget,
  backupRetentionSelection,
  databaseNameFromUri,
  restoreNamespaceArguments,
  runCommand,
  safeDatabaseIdentity,
  sha256File,
  writeMongoToolConfig,
} from "../src/utils/databaseBackupService.js";

test("database backup helpers require explicit database names and isolate restore targets", () => {
  assert.equal(databaseNameFromUri("mongodb+srv://user:pass@example.test/core?retryWrites=true"), "core");
  assert.equal(safeDatabaseIdentity("mongodb://user:pass@db.example.test:27017/marketplace?replicaSet=rs0"), "db.example.test:27017/marketplace");
  assert.throws(
    () => assertIsolatedRestoreTarget(
      "mongodb://restore.example.test/core",
      ["mongodb://restore.example.test/core"],
    ),
    /isolated database/,
  );
  assert.doesNotThrow(() => assertIsolatedRestoreTarget(
    "mongodb://restore.example.test/core-drill",
    ["mongodb://restore.example.test/core"],
  ));
  assert.deepEqual(
    restoreNamespaceArguments("core", "mongodb://restore.example.test/core-drill"),
    ["--nsFrom=core.*", "--nsTo=core-drill.*"],
  );
  assert.throws(
    () => restoreNamespaceArguments("core", "mongodb://restore.example.test/admin"),
    /system database/,
  );
});

test("backup retention keeps daily, weekly and monthly recovery points", () => {
  const now = new Date("2026-07-29T01:00:00.000Z");
  const records = Array.from({ length: 80 }, (_, index) => ({
    _id: `backup-${index}`,
    verifiedAt: new Date(now.getTime() - index * 24 * 60 * 60 * 1000),
  }));
  const selection = backupRetentionSelection(records);
  assert.ok(selection.keepIds.size >= 14);
  assert.ok(selection.keepIds.size <= 34);
  assert.ok(selection.keepIds.has("backup-0"));
  assert.ok(selection.prune.length > 0);
});

test("backup checksum detects a one-byte modification", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "3dipl-backup-test-"));
  const artifact = path.join(directory, "backup.archive.gz.age");
  try {
    await fs.writeFile(artifact, Buffer.from([0x01, 0x02, 0x03]));
    const expected = await sha256File(artifact);
    await fs.writeFile(artifact, Buffer.from([0x01, 0x02, 0x04]));
    assert.notEqual(await sha256File(artifact), expected);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("MongoDB tools read credentials from a private config file", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "3dipl-mongo-config-"));
  const uri = "mongodb://backup-user:very-secret@example.test/core";
  try {
    const configPath = await writeMongoToolConfig(directory, "core-dump", uri);
    assert.equal(await fs.readFile(configPath, "utf8"), `uri: ${JSON.stringify(uri)}\n`);
    if (process.platform !== "win32") {
      const stat = await fs.stat(configPath);
      assert.equal(stat.mode & 0o077, 0);
    }
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("command failures redact configured secrets", async () => {
  const secret = "mongodb://user:password@example.test/core";
  await assert.rejects(
    runCommand(
      process.execPath,
      ["-e", "process.stderr.write(process.argv[1]); process.exit(1)", secret],
      { redactValues: [secret] },
    ),
    (error) => !error.message.includes(secret) && error.message.includes("[REDACTED]"),
  );
});
