#!/usr/bin/env node
// Runs Tasky's whole test suite (Vitest unit tests, then Playwright end-to-end tests) and writes one combined JUnit
// XML file, test-results/junit.xml, which is what Orbit's "Validate capabilities" reads. Exits non-zero when either
// suite fails. Usage (from the repository root): npm run validate -w @orbit/tasky
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'test-results');
// The unit report lives outside test-results/: Playwright empties its output directory when it starts, which would
// delete it before the reports are combined.
const scratch = mkdtempSync(join(tmpdir(), 'tasky-validate-'));
const unit = join(scratch, 'unit.junit.xml');
const e2e = join(out, 'e2e.junit.xml');
mkdirSync(out, { recursive: true });
rmSync(e2e, { force: true });

const run = (cmd, args, env = {}) => spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } }).status ?? 1;

const unitStatus = run('npx', ['vitest', 'run', '--reporter=default', '--reporter=junit', `--outputFile.junit=${unit}`]);
const e2eStatus = run('npx', ['playwright', 'test', '--reporter=list,junit'], { PLAYWRIGHT_JUNIT_OUTPUT_FILE: e2e });

// Combine the suites of both reports under one <testsuites> root.
const suites = [unit, e2e]
  .filter((f) => existsSync(f))
  .map((f) => readFileSync(f, 'utf8').replace(/<\?xml[^>]*\?>/, '').replace(/<\/?testsuites\b[^>]*>/g, '').trim());
rmSync(scratch, { recursive: true, force: true });
writeFileSync(join(out, 'junit.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="tasky">\n${suites.join('\n')}\n</testsuites>\n`);
console.log(`\nWrote ${join(out, 'junit.xml')} (unit: ${unitStatus === 0 ? 'passed' : 'failed'}, e2e: ${e2eStatus === 0 ? 'passed' : 'failed'})`);
process.exit(unitStatus || e2eStatus);
