import fs from "node:fs";
import path from "node:path";

const buildRoot = path.resolve(process.argv[2] || "frontend/dist");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map"]);
const forbidden = [
  { label: "local backend URL", pattern: /(?:localhost|127\.0\.0\.1):5000/i },
  { label: "MongoDB connection string", pattern: /mongodb(?:\+srv)?:\/\//i },
  { label: "private key", pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/i },
  {
    label: "server secret assignment",
    pattern: /(?:JWT_SECRET|CSRF_HMAC_SECRET|COOKIE_SIGNATURE_SECRET|DOWNLOAD_TOKEN_SECRET|GOOGLE_CLIENT_SECRET|SEPAY_SECRET_KEY)\s*[:=]\s*["'][^"']{8,}/i,
  },
];

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  });
}

if (!fs.existsSync(buildRoot) || !fs.statSync(buildRoot).isDirectory()) {
  console.error(`Frontend build directory does not exist: ${buildRoot}`);
  process.exit(1);
}

const files = collectFiles(buildRoot);
const violations = [];
for (const file of files) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".map") {
    violations.push(`${path.relative(buildRoot, file)}: source map must not ship`);
    continue;
  }
  if (!textExtensions.has(extension)) continue;
  const content = fs.readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      violations.push(`${path.relative(buildRoot, file)}: ${rule.label}`);
    }
  }
}

if (violations.length) {
  console.error("Frontend release verification failed:");
  violations.forEach((violation) => console.error(`- ${violation}`));
  process.exit(1);
}

console.log(`Frontend release verification passed (${files.length} files in ${buildRoot}).`);
