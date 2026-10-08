#!/usr/bin/env node
// Fails (exit 1) if any package in package-lock.json declares an install script
// (hasInstallScript: true) that is not listed in tools/allowed-install-scripts.json.
// Install scripts are never executed (.npmrc ignore-scripts=true); this check keeps the
// set of packages that *would* want to run code at install time explicit and reviewed.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
const allowFile = JSON.parse(readFileSync(join(root, 'tools', 'allowed-install-scripts.json'), 'utf8'));
const allowed = new Set(Array.isArray(allowFile.allowed) ? allowFile.allowed.map((a) => a.name ?? a) : []);

const offenders = [];
for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path || !meta || meta.hasInstallScript !== true) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
  if (!allowed.has(name)) offenders.push(`${name}@${meta.version ?? '?'} (${path})`);
}

if (offenders.length > 0) {
  console.error('Packages declaring install scripts that are not allow-listed:');
  for (const o of offenders) console.error(`  - ${o}`);
  console.error('Review them, then add {"name": "<pkg>", "reason": "..."} to tools/allowed-install-scripts.json if justified.');
  process.exit(1);
}
console.log(`verify-no-install-scripts: OK (${allowed.size} allow-listed)`);
