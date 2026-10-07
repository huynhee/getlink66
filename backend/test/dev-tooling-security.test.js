import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const concurrentlyPackagePath = require.resolve("concurrently/package.json");
const toolingRequire = createRequire(concurrentlyPackagePath);
const shellQuote = toolingRequire("shell-quote");

test("the dev launcher resolves the patched shell-quote dependency from its lockfile", async () => {
  const rootPackage = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const lockfile = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));
  const version = toolingRequire("shell-quote/package.json").version;
  assert.equal(rootPackage.overrides.concurrently["shell-quote"], "1.11.0");
  assert.equal(version, "1.11.0");
  const entries = Object.entries(lockfile.packages).filter(([name]) => name.endsWith("node_modules/shell-quote"));
  assert.ok(entries.length > 0);
  assert.ok(entries.every(([, entry]) => entry.version === "1.11.0"));
});

test("shell quoting rejects line terminators after comment tokens without executing input", () => {
  for (const separator of ["\n", "\r", "\u2028", "\u2029"]) {
    assert.throws(() => shellQuote.quote(["echo", "safe", { comment: "comment" }, `value${separator}unexpected-command`]), TypeError);
  }
  const args = ["node", "path with spaces", "literal$value", "name&value"];
  assert.deepEqual(shellQuote.parse(shellQuote.quote(args)), args);
});

test("concurrently still runs two isolated dev commands with the patched dependency", () => {
  const bin = path.join(path.dirname(concurrentlyPackagePath), "dist", "bin", "concurrently.js");
  const command = 'node -e "process.exit(0)"';
  const result = spawnSync(process.execPath, [bin, "--raw", command, command], {
    encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
