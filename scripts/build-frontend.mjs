#!/usr/bin/env node
/**
 * Build the Next.js frontend (static export) and copy it into backend/public.
 *
 * The frontend lives in its own repository, so this script:
 *   1. uses a local checkout when one exists (`../client`, `./client` or FRONTEND_DIR);
 *   2. otherwise shallow-clones FRONTEND_REPO_URL into `.frontend-src` (used on Render,
 *      where only this repository is checked out);
 *   3. installs dependencies and runs `next build` with a same-origin API URL
 *      baked in (NEXT_PUBLIC_API_URL);
 *   4. replaces backend/public with the generated `out/` directory.
 *
 * Run it with:  npm run build:frontend
 *
 * Environment overrides:
 *   FRONTEND_DIR          Local path to the frontend checkout
 *   FRONTEND_REPO_URL     Git URL cloned when no local checkout exists
 *                         (default: https://github.com/suhel6388/client-gym.git)
 *   FRONTEND_REPO_BRANCH  Branch used for the clone (default: main)
 *   FRONTEND_API_URL      NEXT_PUBLIC_API_URL baked into the build (default: /api/v1)
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");
const publicDir = path.join(backendRoot, "public");
const cloneDir = path.resolve(backendRoot, ".frontend-src");

const repoUrl =
  process.env.FRONTEND_REPO_URL || "https://github.com/suhel6388/client-gym.git";
const repoBranch = process.env.FRONTEND_REPO_BRANCH || "main";
const apiUrl =
  process.env.FRONTEND_API_URL || process.env.NEXT_PUBLIC_API_URL || "/api/v1";

function log(message) {
  console.log(`[frontend] ${message}`);
}

function fail(message) {
  console.error(`[frontend] ERROR: ${message}`);
  process.exit(1);
}

function quote(value) {
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

/** Runs a shell command; returns true on success and never exits. */
function run(commandLine, { cwd = backendRoot, env = {} } = {}) {
  log(`$ ${commandLine}`);
  const result = spawnSync(commandLine, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: true,
  });
  if (result.error) {
    log(`Failed to start: ${result.error.message}`);
    return false;
  }
  return result.status === 0;
}

function runOrFail(commandLine, options) {
  if (!run(commandLine, options)) fail(`Command failed: ${commandLine}`);
}

function isFrontendCheckout(dir) {
  return (
    existsSync(path.join(dir, "package.json")) &&
    (existsSync(path.join(dir, "next.config.ts")) ||
      existsSync(path.join(dir, "next.config.js")) ||
      existsSync(path.join(dir, "next.config.mjs")))
  );
}

function resolveFrontendDir() {
  const explicitDir = process.env.FRONTEND_DIR;
  if (explicitDir) {
    const dir = path.resolve(backendRoot, explicitDir);
    if (!isFrontendCheckout(dir)) {
      fail(`FRONTEND_DIR="${explicitDir}" is not a Next.js checkout (${dir}).`);
    }
    return { dir, install: !existsSync(path.join(dir, "node_modules")) };
  }

  for (const candidate of ["../client", "./client"]) {
    const dir = path.resolve(backendRoot, candidate);
    if (isFrontendCheckout(dir)) return { dir, install: !existsSync(path.join(dir, "node_modules")) };
  }

  log(`No local frontend checkout found; cloning ${repoUrl} (${repoBranch})...`);
  rmSync(cloneDir, { recursive: true, force: true });
  runOrFail(
    `git clone --depth 1 --branch ${quote(repoBranch)} ${quote(repoUrl)} ${quote(cloneDir)}`,
  );
  return { dir: cloneDir, install: true };
}

function countFiles(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    total += entry.isDirectory() ? countFiles(entryPath) : 1;
  }
  return total;
}

const frontend = resolveFrontendDir();
log(`Using frontend checkout: ${frontend.dir}`);
log(`NEXT_PUBLIC_API_URL=${apiUrl}`);

if (frontend.install) {
  const installed = run(`npm ci --include=dev --no-audit --no-fund`, { cwd: frontend.dir });
  if (!installed) {
    log("npm ci failed; falling back to npm install...");
    runOrFail(`npm install --include=dev --no-audit --no-fund`, { cwd: frontend.dir });
  }
}

runOrFail(`npm run build`, {
  cwd: frontend.dir,
  env: {
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});

const outDir = path.join(frontend.dir, "out");
for (const required of ["index.html", "404.html", "_next"]) {
  if (!existsSync(path.join(outDir, required))) {
    fail(
      `Next.js export is missing "${required}" in ${outDir}. ` +
        `Check that next.config has output: "export".`,
    );
  }
}

log(`Copying ${outDir} -> ${publicDir}`);
rmSync(publicDir, { recursive: true, force: true });
cpSync(outDir, publicDir, { recursive: true });

if (!statSync(path.join(publicDir, "index.html")).isFile()) {
  fail(`index.html was not copied into ${publicDir}.`);
}
if (!existsSync(path.join(publicDir, "_next", "static"))) {
  fail(`_next/static assets were not copied into ${publicDir}.`);
}

log(`Frontend ready at ${publicDir} (${countFiles(publicDir)} files).`);
