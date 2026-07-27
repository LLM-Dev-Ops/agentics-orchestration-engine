#!/usr/bin/env node
/**
 * ADR-0001 verification 1: no server-reachable module may import the mock
 * Core registry. Mocks are for tests only; production must fail closed on
 * missing Core configuration rather than silently delegating to nothing.
 *
 * Allowed: the mock module itself, and the barrels that re-export it for tests.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const srcRoot = join(repoRoot, 'src');

const ALLOWED = new Set([
  'src/integration/cores/mock-cores.ts',
  'src/integration/cores/index.ts',
  'src/index.ts',
]);

const PATTERN = /mock-cores(\.js)?['"]|createMockCoreClientRegistry/;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

const offenders = [];

for (const file of walk(srcRoot)) {
  const rel = relative(repoRoot, file).split('\\').join('/');
  if (ALLOWED.has(rel)) continue;

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (PATTERN.test(line)) {
      offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (offenders.length > 0) {
  console.error('ADR-0001 violation: mock Core registry reachable from src/\n');
  for (const offender of offenders) {
    console.error(`  ${offender}`);
  }
  console.error(
    '\nUse createCoreClientRegistryFromEnv() instead. Mock cores are test-only.'
  );
  process.exit(1);
}

console.log('[check-no-mock-cores] OK — no mock Core imports in server-reachable code');
