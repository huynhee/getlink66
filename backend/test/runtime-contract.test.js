import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const json = (file) => JSON.parse(read(file));
const pinned = read(".nvmrc").trim();
const [major, minor, patch] = pinned.split(".").map(Number);
const engine = `>=${pinned} <${major + 1}`;

test("application manifests and lockfile root entries share the supported Node runtime", () => {
  assert.match(pinned, /^24\.\d+\.\d+$/);
  for (const prefix of ["", "backend/", "frontend/"]) {
    assert.equal(json(`${prefix}package.json`).engines.node, engine, prefix || "root");
    assert.equal(json(`${prefix}package-lock.json`).packages[""].engines.node, engine, prefix || "root lock");
  }
  for (const prefix of ["backend/", "frontend/"]) assert.equal(json(`${prefix}package-lock.json`).packages[".."].engines.node, engine);
  assert.equal(json("package.json").packageManager, "npm@11.19.1");
});

test("Docker builds and CI use the checked-in runtime pin", () => {
  assert.ok(read("backend/Dockerfile").includes(`FROM node:${pinned}-bookworm-slim\n`));
  assert.ok(read("frontend/Dockerfile").startsWith(`FROM node:${pinned}-alpine AS build`));
  assert.match(read(".github/workflows/ci.yml"), /node-version-file:\s*\.nvmrc/);
});

test("verification actually runs on the supported Node branch and minimum patch", () => {
  const [runningMajor, runningMinor, runningPatch] = process.versions.node.split(".").map(Number);
  assert.ok(runningMajor === major && (runningMinor > minor || (runningMinor === minor && runningPatch >= patch)),
    `Node ${process.versions.node} does not satisfy ${engine}; activate .nvmrc before testing.`);
});
