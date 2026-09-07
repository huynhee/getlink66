import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 30_000;
const TRANSIENT_CODES = new Set([
  "E429", "E500", "E502", "E503", "E504", "EAI_AGAIN", "ECONNRESET",
  "ECONNREFUSED", "ETIMEDOUT", "ENETUNREACH", "ENOTFOUND",
]);

export function classifyAuditResult({ code, stdout = "", timedOut = false, errorCode = "" }) {
  let report;
  try { report = JSON.parse(stdout); } catch { /* Incomplete output is not a clean audit. */ }
  const counts = report?.metadata?.vulnerabilities;
  if (counts && Number.isInteger(counts.critical) && counts.critical >= 0) {
    // Advisory titles/URLs may contain HTTP-like numbers; findings always win.
    if (counts.critical > 0) return "failed";
    return code === 0 && !timedOut ? "passed" : "failed";
  }
  if (timedOut || TRANSIENT_CODES.has(String(report?.error?.code || errorCode).toUpperCase())) {
    return "unavailable";
  }
  return "failed";
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export function validAuditArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--audit-level=critical" || arg === "--omit=dev") continue;
    if (arg === "--prefix" && ["backend", "frontend"].includes(args[index + 1])) {
      index += 1;
      continue;
    }
    return false;
  }
  return true;
}

function runAudit(args) {
  return new Promise((resolve) => {
    const isWindows = process.platform === "win32";
    const child = spawn(isWindows ? "npm.cmd" : "npm", ["audit", "--json", ...args], {
      env: {
        ...process.env,
        npm_config_fetch_retries: "1",
        npm_config_fetch_retry_mintimeout: "1000",
        npm_config_fetch_retry_maxtimeout: "5000",
        npm_config_fetch_timeout: "30000",
      },
      shell: isWindows,
    });
    let stdout = "";
    let timedOut = false;
    const collect = (chunk, stream) => {
      const text = String(chunk);
      if (stream === process.stdout) stdout += text;
      stream.write(text);
    };
    child.stdout.on("data", (chunk) => collect(chunk, process.stdout));
    child.stderr.on("data", (chunk) => collect(chunk, process.stderr));

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, ATTEMPT_TIMEOUT_MS);
    timeout.unref?.();

    child.once("error", (error) => {
      clearTimeout(timeout);
      console.error(error.message);
      resolve({
        code: 1,
        stdout,
        errorCode: error.code,
        timedOut,
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: Number.isInteger(code) ? code : 1,
        stdout,
        timedOut,
      });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (!validAuditArgs(args)) {
    console.error("Unsupported npm audit arguments.");
    process.exitCode = 2;
    return;
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    console.log(`npm audit attempt ${attempt}/${MAX_ATTEMPTS}`);
    const result = await runAudit(args);
    const status = classifyAuditResult(result);
    if (status === "passed") return;
    if (status === "failed") {
      console.error("Security audit failed or did not produce a valid report.");
      process.exitCode = result.code || 1;
      return;
    }
    if (attempt === MAX_ATTEMPTS) {
      console.warn(
        "::warning title=npm audit unavailable::No security verdict: the npm audit service was unavailable after retries. Rerun this audit; this is not a clean vulnerability scan.",
      );
      return;
    }

    const delayMs = attempt * 5_000;
    console.warn(`Transient npm audit service failure; retrying in ${delayMs / 1000}s.`);
    await wait(delayMs);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
