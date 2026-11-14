#!/usr/bin/env node
// Example external evidence producer for Orbit contracts. NOT part of Orbit itself.
//
// Converts machine-readable test reports (Vitest JSON, Playwright JSON) into Orbit `evidence` records.
// Test ids are read from test titles written as "... [test.tasky.area.name]" and only ids that are
// defined in the contract's `tests` array produce evidence. Nothing is fabricated: failed results are
// recorded as failed, and a missing commit is omitted (never invented).
//
// Usage:
//   node scripts/generate-evidence.mjs --contract examples/tasky.orbit.json [--run]
//        [--vitest-report path] [--playwright-report path] [--commit <sha>]
//        [--keep <n>] [--write | --out file]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseContract, serializeContract } from '@orbit/contract/dist';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const taskyDir = resolve(repoRoot, 'apps/tasky');

const USAGE = `Usage: node scripts/generate-evidence.mjs --contract <file> [options]

  --contract <file>           Orbit contract to update (required)
  --run                       Run Tasky's Vitest and Playwright suites and use their JSON reports
  --vitest-report <file>      Read a Vitest JSON report (--reporter=json)
  --playwright-report <file>  Read a Playwright JSON report (--reporter=json)
  --commit <sha>              Full 40-hex SHA of the tested code (default: HEAD only if the tree is clean)
  --keep <n>                  Keep only the latest <n> evidence records per test
  --write                     Write the updated contract back to --contract
  --out <file>                Write the updated contract to <file>
  (default)                   Print the updated contract JSON to stdout`;

function fail(message, code = 1) {
  console.error(`error: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  const opts = { run: false, write: false };
  const valueFlags = new Set(['contract', 'vitest-report', 'playwright-report', 'commit', 'keep', 'out']);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    }
    if (!arg.startsWith('--')) fail(`unexpected argument "${arg}"\n\n${USAGE}`);
    const name = arg.slice(2);
    if (name === 'run' || name === 'write') {
      opts[name] = true;
    } else if (valueFlags.has(name)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) fail(`--${name} needs a value`);
      opts[name.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    } else {
      fail(`unknown option "${arg}"\n\n${USAGE}`);
    }
  }
  if (!opts.contract) fail(`--contract is required\n\n${USAGE}`);
  if (opts.write && opts.out) fail('use either --write or --out, not both');
  if (opts.run && (opts.vitestReport || opts.playwrightReport)) fail('--run cannot be combined with report paths');
  if (!opts.run && !opts.vitestReport && !opts.playwrightReport) fail(`give --run or at least one report file\n\n${USAGE}`);
  if (opts.commit !== undefined && !/^[0-9a-f]{40}$/.test(opts.commit)) fail('--commit must be a full 40-character lowercase hex SHA');
  if (opts.keep !== undefined && !(Number.isInteger(Number(opts.keep)) && Number(opts.keep) >= 1)) fail('--keep must be a positive integer');
  return opts;
}

// ---------- test result extraction ----------

const ID_RE = /\[(test\.[A-Za-z0-9._-]+)\]/g;
const idsInTitle = (title) => [...title.matchAll(ID_RE)].map((m) => m[1]);
// eslint-disable-next-line no-control-regex
const stripAnsi = (s) => String(s ?? '').replace(/\u001b\[[0-9;]*m/g, '');
const firstLine = (s) => stripAnsi(s).split('\n').find((l) => l.trim()) ?? '';
const toRfc3339 = (value) => new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');

const VITEST_STATUS = { passed: 'passed', failed: 'failed', pending: 'skipped', skipped: 'skipped', todo: 'skipped' };
const PLAYWRIGHT_STATUS = { passed: 'passed', failed: 'failed', skipped: 'skipped', timedOut: 'error', interrupted: 'error' };

/** @returns {{id: string, status: string, startedAt: string, source: string, error?: string}[]} */
function readVitest(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const results = [];
  for (const file of report.testResults ?? []) {
    const fileName = relative(repoRoot, file.name ?? '');
    for (const t of file.assertionResults ?? []) {
      for (const id of idsInTitle(`${t.title ?? ''} ${t.fullName ?? ''}`.slice(0, 2000)).filter((x, i, a) => a.indexOf(x) === i)) {
        results.push({
          id,
          status: VITEST_STATUS[t.status] ?? 'error',
          startedAt: toRfc3339(file.startTime ?? report.startTime ?? Date.now()),
          source: `vitest ${fileName}`,
          error: t.failureMessages?.length ? firstLine(t.failureMessages[0]) : undefined,
        });
      }
    }
  }
  return results;
}

function readPlaywright(path) {
  const report = JSON.parse(readFileSync(path, 'utf8'));
  const results = [];
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const id of idsInTitle(spec.title ?? '')) {
        for (const test of spec.tests ?? []) {
          const last = (test.results ?? []).at(-1);
          let status = last ? (PLAYWRIGHT_STATUS[last.status] ?? 'error') : test.status === 'skipped' ? 'skipped' : 'error';
          if (!last && test.status !== 'skipped') status = 'error';
          results.push({
            id,
            status,
            startedAt: toRfc3339(last?.startTime ?? report.stats?.startTime ?? Date.now()),
            source: `playwright ${suite.file ?? spec.file ?? ''}${test.projectName ? ` (${test.projectName})` : ''}`.trim(),
            error: last?.error?.message ? firstLine(last.error.message) : undefined,
          });
        }
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  };
  for (const suite of report.suites ?? []) visit(suite);
  return results;
}

function runSuites() {
  const dir = mkdtempSync(resolve(tmpdir(), 'orbit-evidence-'));
  const vitestOut = resolve(dir, 'vitest.json');
  const playwrightOut = resolve(dir, 'playwright.json');
  // Child stdout goes to our stderr so `--out`-less runs keep stdout clean for the JSON document.
  const stdio = ['ignore', 2, 2];
  console.error('Running Tasky unit tests (vitest)...');
  spawnSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${vitestOut}`], { cwd: taskyDir, stdio });
  console.error('Running Tasky end-to-end tests (playwright)...');
  spawnSync('npx', ['playwright', 'test', '--reporter=json'], {
    cwd: taskyDir,
    stdio,
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_FILE: playwrightOut },
  });
  // A failed run is a legitimate outcome and is recorded; a missing report is not.
  for (const f of [vitestOut, playwrightOut]) if (!existsSync(f)) fail(`test run produced no report at ${f}`);
  return { vitestReport: vitestOut, playwrightReport: playwrightOut };
}

// ---------- commit provenance ----------

function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.error ? { ok: false, out: '', err: String(r.error) } : { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

/** Returns { commit?: string, reason?: string }. Never invents a SHA. */
function resolveCommit(explicit, contractPath) {
  if (explicit) return { commit: explicit };
  const cwd = dirname(contractPath);
  const top = git(cwd, ['rev-parse', '--show-toplevel']);
  if (!top.ok) return { reason: 'not inside a git repository; commit unknown' };
  const head = git(top.out, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (!head.ok || !/^[0-9a-f]{40}$/.test(head.out)) return { reason: 'repository has no commits yet; commit unknown' };
  const status = git(top.out, ['status', '--porcelain', '--untracked-files=all']);
  if (!status.ok) return { reason: 'git status failed; commit unknown' };
  const contractRel = relative(top.out, contractPath).split('\\').join('/');
  const dirty = status.out
    .split('\n')
    .filter(Boolean)
    .filter((line) => line.slice(3).replace(/^"|"$/g, '') !== contractRel);
  if (dirty.length > 0) return { reason: `uncommitted changes present (${dirty.length} path${dirty.length === 1 ? '' : 's'}); commit unknown` };
  return { commit: head.out };
}

// ---------- evidence building ----------

const SEVERITY = { error: 3, failed: 2, skipped: 1, passed: 0 };

function combine(results) {
  /** One record per test id: worst status wins, earliest start time. */
  const byId = new Map();
  for (const r of results) {
    const cur = byId.get(r.id);
    if (!cur) {
      byId.set(r.id, { ...r, sources: [r.source], count: 1 });
      continue;
    }
    cur.count += 1;
    if (!cur.sources.includes(r.source)) cur.sources.push(r.source);
    if (SEVERITY[r.status] > SEVERITY[cur.status]) {
      cur.status = r.status;
      cur.error = r.error;
    }
    if (r.startedAt < cur.startedAt) cur.startedAt = r.startedAt;
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

const compactStamp = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '');

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const contractPath = resolve(process.cwd(), opts.contract);
  let text;
  try {
    text = readFileSync(contractPath, 'utf8');
  } catch (e) {
    fail(`cannot read contract ${contractPath}: ${e.message}`);
  }
  const parsed = parseContract(text);
  if (!parsed.ok || !parsed.contract) {
    for (const d of parsed.diagnostics) console.error(`${d.severity} ${d.code} ${d.message}`);
    fail('the input contract is invalid; fix it before generating evidence');
  }
  const contract = parsed.contract;

  const reports = opts.run ? runSuites() : { vitestReport: opts.vitestReport, playwrightReport: opts.playwrightReport };
  const raw = [];
  try {
    if (reports.vitestReport) raw.push(...readVitest(resolve(process.cwd(), reports.vitestReport)));
    if (reports.playwrightReport) raw.push(...readPlaywright(resolve(process.cwd(), reports.playwrightReport)));
  } catch (e) {
    fail(`cannot read a test report: ${e.message}`);
  }

  const defined = new Set(contract.tests.map((t) => t.id));
  const combined = combine(raw);
  const unknownIds = combined.filter((r) => !defined.has(r.id)).map((r) => r.id);
  const results = combined.filter((r) => defined.has(r.id));
  for (const id of unknownIds) console.error(`warning: test id "${id}" is in the reports but not in the contract tests; ignored`);
  const covered = new Set(results.map((r) => r.id));
  for (const t of contract.tests) {
    if (!covered.has(t.id)) console.error(`warning: contract test "${t.id}" has no result in the reports; no evidence recorded`);
  }

  const { commit, reason } = resolveCommit(opts.commit, contractPath);
  const productPrefix = `test.${contract.product.id}.`;
  const usedIds = new Set(contract.evidence.map((e) => e.id));
  const added = [];
  for (const r of results) {
    const duplicate = contract.evidence.find(
      (e) => e.testId === r.id && e.executedAt === r.startedAt && e.status === r.status && e.commit === commit,
    );
    if (duplicate) {
      console.error(`note: evidence for "${r.id}" at ${r.startedAt} already recorded as ${duplicate.id}; skipped`);
      continue;
    }
    const short = r.id.startsWith(productPrefix) ? r.id.slice(productPrefix.length) : r.id.replace(/^test\./, '');
    const base = `run.${short}.${compactStamp(r.startedAt)}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    const details = [
      r.sources.join(', '),
      r.count > 1 ? `${r.count} tests carry this id; worst status recorded` : null,
      r.error ? r.error.slice(0, 300) : null,
      commit ? null : reason,
    ]
      .filter(Boolean)
      .join('; ');
    added.push({ id, testId: r.id, status: r.status, executedAt: r.startedAt, ...(commit ? { commit } : {}), details });
  }

  let evidence = [...contract.evidence, ...added];
  let pruned = 0;
  if (opts.keep) {
    const keep = Number(opts.keep);
    const byTest = new Map();
    for (const e of evidence) byTest.set(e.testId, [...(byTest.get(e.testId) ?? []), e]);
    const drop = new Set();
    for (const list of byTest.values()) {
      list.sort((a, b) => (a.executedAt === b.executedAt ? b.id.localeCompare(a.id) : b.executedAt.localeCompare(a.executedAt)));
      for (const e of list.slice(keep)) drop.add(e.id);
    }
    pruned = drop.size;
    evidence = evidence.filter((e) => !drop.has(e.id));
  }

  const next = { ...contract, evidence };
  const output = serializeContract(next);
  const check = parseContract(output);
  if (!check.ok) {
    for (const d of check.diagnostics) console.error(`${d.severity} ${d.code} ${d.message}`);
    fail('the resulting contract is invalid; refusing to write it');
  }

  const toStdout = !opts.write && !opts.out;
  const log = toStdout ? console.error : console.log;
  log(`\nEvidence summary (${added.length} added, ${pruned} pruned, commit: ${commit ?? `none (${reason})`})`);
  const counts = { passed: 0, failed: 0, skipped: 0, error: 0 };
  const width = Math.max(10, ...added.map((e) => e.testId.length));
  log(`${'STATUS'.padEnd(8)}  ${'TEST'.padEnd(width)}  EXECUTED AT`);
  for (const e of added) {
    counts[e.status] += 1;
    log(`${e.status.padEnd(8)}  ${e.testId.padEnd(width)}  ${e.executedAt}`);
  }
  log(`passed ${counts.passed}  failed ${counts.failed}  skipped ${counts.skipped}  error ${counts.error}`);

  if (opts.write || opts.out) {
    const target = opts.write ? contractPath : resolve(process.cwd(), opts.out);
    const tmp = `${target}.tmp-${process.pid}`;
    writeFileSync(tmp, output);
    renameSync(tmp, target);
    log(`Wrote ${target}`);
  } else {
    process.stdout.write(output);
  }
}

main();
