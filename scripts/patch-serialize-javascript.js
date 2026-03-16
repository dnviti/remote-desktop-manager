#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Patch nested serialize-javascript to >=7.0.3 (fixes GHSA-5c6j-r48x-rmvq).
 *
 * workbox-build pins @rollup/plugin-terser@^0.4.3 which transitively depends
 * on serialize-javascript@^6.0.1. The upstream hasn't updated yet and npm
 * overrides don't resolve nested workspace dependencies in npm 11. This script
 * replaces the vulnerable nested copy with the safe top-level version.
 */
const fs = require('fs');
const path = require('path');

const SAFE_VERSION = '7.0.3';
const root = path.resolve(__dirname, '..');

// Find all nested serialize-javascript directories that are NOT the top-level one
function findNestedCopies(dir, depth = 0) {
  const results = [];
  const target = path.join(dir, 'node_modules', 'serialize-javascript');

  if (depth > 0 && fs.existsSync(target)) {
    const pkgPath = path.join(target, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      const [major, minor, patch] = pkg.version.split('.').map(Number);
      const [safeMajor, safeMinor, safePatch] = SAFE_VERSION.split('.').map(Number);

      if (
        major < safeMajor ||
        (major === safeMajor && minor < safeMinor) ||
        (major === safeMajor && minor === safeMinor && patch < safePatch)
      ) {
        results.push({ path: target, version: pkg.version });
      }
    }
  }

  // Recurse into node_modules subdirectories
  const nm = path.join(dir, 'node_modules');
  if (fs.existsSync(nm)) {
    for (const entry of fs.readdirSync(nm)) {
      if (entry === '.cache' || entry === '.package-lock.json') continue;
      const entryPath = path.join(nm, entry);
      if (entry.startsWith('@')) {
        // Scoped package — recurse into scope dir
        for (const scoped of fs.readdirSync(entryPath)) {
          results.push(...findNestedCopies(path.join(entryPath, scoped), depth + 1));
        }
      } else if (entry !== 'serialize-javascript' || depth > 0) {
        results.push(...findNestedCopies(entryPath, depth + 1));
      }
    }
  }

  return results;
}

// Check top-level version
const topLevel = path.join(root, 'node_modules', 'serialize-javascript', 'package.json');
if (!fs.existsSync(topLevel)) {
  // No top-level copy — nothing to patch with
  process.exit(0);
}

const topPkg = JSON.parse(fs.readFileSync(topLevel, 'utf8'));
const [topMajor, topMinor, topPatch] = topPkg.version.split('.').map(Number);
const [safeMajor, safeMinor, safePatch] = SAFE_VERSION.split('.').map(Number);

if (
  topMajor < safeMajor ||
  (topMajor === safeMajor && topMinor < safeMinor) ||
  (topMajor === safeMajor && topMinor === safeMinor && topPatch < safePatch)
) {
  // Top-level is also vulnerable — install safe version first
  console.log(`[patch] Top-level serialize-javascript@${topPkg.version} is also vulnerable, skipping patch.`);
  process.exit(0);
}

const copies = findNestedCopies(root);
if (copies.length === 0) {
  process.exit(0);
}

const topDir = path.join(root, 'node_modules', 'serialize-javascript');

for (const { path: nestedPath, version } of copies) {
  // Replace nested copy with symlink to top-level safe version
  fs.rmSync(nestedPath, { recursive: true, force: true });
  fs.symlinkSync(topDir, nestedPath, 'junction');
  console.log(`[patch] serialize-javascript@${version} → ${topPkg.version} (${path.relative(root, nestedPath)})`);
}
