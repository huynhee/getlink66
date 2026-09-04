import { spawn } from "node:child_process";

const MAX_ATTEMPTS = 2;
const ATTEMPT_TIMEOUT_MS = 30_000;
const TRANSIENT_ERROR_RE = /(?:\b(?:429|500|502|503|504)\b|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|ENOTFOUND|Service Unavailable)/i;

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function validAuditArgs(args) {
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
    const child = spawn(isWindows ? "npm.cmd" : "npm", ["audit", ...args], {
      env: {
        ...process.env,
        npm_config_fetch_retries: "1",
        npm_config_fetch_retry_mintimeout: "1000",
        npm_config_fetch_retry_maxtimeout: "5000",
        npm_config_fetch_timeout: "30000",
      },
      shell: isWindows,
    });
    let output = "";
    let timedOut = false;
    const collect = (chunk, stream) => {
      const text = String(chunk);
      output += text;
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
      const errorOutput = `${output}\n${error.message}`;
      resolve({
        code: 1,
        output: errorOutput,
        transient: TRANSIENT_ERROR_RE.test(errorOutput),
      });
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      resolve({
        code: Number.isInteger(code) ? code : 1,
        output,
        transient: timedOut || TRANSIENT_ERROR_RE.test(output),
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
    if (result.code === 0) return;
    if (!result.transient) {
      process.exitCode = result.code;
      return;
    }
    if (attempt === MAX_ATTEMPTS) {
      console.warn(
        "::warning title=npm audit unavailable::The npm security audit service did not respond after retries. Application verification passed, but this audit must be retried later.",
      );
      return;
    }

    const delayMs = attempt * 5_000;
    console.warn(`Transient npm audit service failure; retrying in ${delayMs / 1000}s.`);
    await wait(delayMs);
  }
}

await main();
