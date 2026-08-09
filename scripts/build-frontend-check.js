import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const frontendRoot = path.join(projectRoot, "frontend");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "3dipl-frontend-check-"));
const viteBin = path.join(frontendRoot, "node_modules", "vite", "bin", "vite.js");
const verifier = path.join(projectRoot, "scripts", "verify-frontend-build.js");

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  return result.status === 0;
}

try {
  const built = run([viteBin, "build", "--outDir", outputRoot, "--emptyOutDir"], frontendRoot);
  if (built) run([verifier, outputRoot], projectRoot);
} finally {
  try {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove temporary frontend build ${outputRoot}: ${error.message}`);
  }
}
