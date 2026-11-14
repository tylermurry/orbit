#!/usr/bin/env node
// Validate Orbit contract files.
// Usage: node scripts/validate-contract.mjs [--json] [file ...]   (default: examples/tasky.orbit.json)
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContract } from '@orbit/contract/dist';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const json = args.includes('--json');
const files = args.filter((a) => !a.startsWith('--'));
if (files.length === 0) files.push(resolve(root, 'examples/tasky.orbit.json'));

let errors = 0;
let warnings = 0;
const report = [];

for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    const d = { severity: 'error', code: 'file.read', message: `Cannot read file: ${e.message}`, path: '' };
    report.push({ file, ok: false, diagnostics: [d] });
    errors++;
    if (!json) console.log(`${file}:1:1  error  ${d.code}  ${d.message}`);
    continue;
  }
  const result = parseContract(text);
  report.push({ file, ok: result.ok, diagnostics: result.diagnostics });
  for (const d of result.diagnostics) {
    if (d.severity === 'error') errors++;
    else warnings++;
    if (!json) console.log(`${file}:${d.line ?? 1}:${d.column ?? 1}  ${d.severity.padEnd(7)}  ${d.code}  ${d.message}`);
  }
}

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const n = files.length;
  console.log(`\n${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'} in ${n} file${n === 1 ? '' : 's'}.`);
}
process.exit(errors > 0 ? 1 : 0);
