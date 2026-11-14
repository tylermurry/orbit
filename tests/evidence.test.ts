import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseContract, type OrbitContract } from '@orbit/contract';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const script = join(root, 'scripts/generate-evidence.mjs');
const START = Date.UTC(2026, 10, 13, 18, 0, 0);

let work: string;
let contractPath: string;
let vitestReport: string;
let playwrightReport: string;

const T = (s: string) => `test.tasky.${s}`;
const run = (...args: string[]) => spawnSync('node', [script, '--contract', contractPath, ...args], { encoding: 'utf8' });

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'orbit-evidence-test-'));
  // Start from the demo base snapshot: valid, no evidence.
  contractPath = join(work, 'contract.orbit.json');
  writeFileSync(contractPath, readFileSync(join(root, 'examples/demo/01-base.orbit.json'), 'utf8'));
  vitestReport = join(work, 'vitest.json');
  writeFileSync(
    vitestReport,
    JSON.stringify({
      startTime: START,
      testResults: [
        {
          name: join(root, 'apps/tasky/tests/unit/x.test.ts'),
          startTime: START + 5_000,
          assertionResults: [
            { title: `ok [${T('filtering.ordering')}]`, status: 'passed', failureMessages: [] },
            { title: `boom [${T('local-date.overdue')}]`, status: 'failed', failureMessages: ['AssertionError: expected true to be false\n  at x'] },
            { title: `later [${T('local-date.rollover')}]`, status: 'todo', failureMessages: [] },
            { title: `skipme [${T('filtering.all-tasks')}]`, status: 'pending', failureMessages: [] },
            { title: `ghost [test.tasky.not.in.contract]`, status: 'passed', failureMessages: [] },
            { title: 'no id at all', status: 'passed', failureMessages: [] },
          ],
        },
      ],
    }),
  );
  playwrightReport = join(work, 'playwright.json');
  const spec = (title: string, status: string, offset: number) => ({
    title,
    file: 'tasks.spec.ts',
    tests: [{ projectName: 'chromium', status: 'x', results: [{ status, startTime: new Date(START + offset).toISOString(), duration: 5, error: status === 'passed' ? undefined : { message: `\u001b[31mTimeout\u001b[39m of 5000ms exceeded` } }] }],
  });
  writeFileSync(
    playwrightReport,
    JSON.stringify({
      suites: [
        { title: 'tasks.spec.ts', file: 'tasks.spec.ts', specs: [], suites: [{ title: 'inner', specs: [spec(`creates [${T('tasks.create')}]`, 'passed', 1000), spec(`hangs [${T('tasks.edit')}]`, 'timedOut', 2000), spec(`cut [${T('tasks.delete')}]`, 'interrupted', 3000), spec(`fails [${T('tasks.complete')}]`, 'failed', 4000), spec(`off [${T('tasks.default-inbox')}]`, 'skipped', 5000)] }] },
      ],
    }),
  );
});

afterAll(() => rmSync(work, { recursive: true, force: true }));

describe('generate-evidence.mjs', () => {
  it('maps statuses, uses report start times and prints JSON by default without touching the contract', () => {
    const before = readFileSync(contractPath, 'utf8');
    const r = run('--vitest-report', vitestReport, '--playwright-report', playwrightReport);
    expect(r.status).toBe(0);
    expect(readFileSync(contractPath, 'utf8')).toBe(before);
    const parsed = parseContract(r.stdout);
    expect(parsed.ok).toBe(true);
    const evidence = (parsed.contract as OrbitContract).evidence;
    const by = Object.fromEntries(evidence.map((e) => [e.testId, e]));
    expect(by[T('filtering.ordering')].status).toBe('passed');
    expect(by[T('local-date.overdue')].status).toBe('failed');
    expect(by[T('local-date.overdue')].details).toContain('AssertionError: expected true to be false');
    expect(by[T('local-date.rollover')].status).toBe('skipped'); // todo
    expect(by[T('filtering.all-tasks')].status).toBe('skipped'); // pending
    expect(by[T('tasks.create')].status).toBe('passed');
    expect(by[T('tasks.edit')].status).toBe('error'); // timedOut
    expect(by[T('tasks.delete')].status).toBe('error'); // interrupted
    expect(by[T('tasks.complete')].status).toBe('failed');
    expect(by[T('tasks.default-inbox')].status).toBe('skipped');
    expect(by[T('tasks.edit')].details).not.toContain('\u001b'); // ANSI stripped
    // actual start times from the reports, RFC3339 UTC
    expect(by[T('tasks.create')].executedAt).toBe('2026-11-13T18:00:01Z');
    expect(by[T('tasks.edit')].executedAt).toBe('2026-11-13T18:00:02Z');
    expect(by[T('filtering.ordering')].executedAt).toBe('2026-11-13T18:00:05Z');
    // ids, and no invented data
    expect(by[T('tasks.create')].id).toBe('run.tasks.create.20261113T180001Z');
    expect(evidence).toHaveLength(9);
    expect(evidence.some((e) => e.testId === 'test.tasky.not.in.contract')).toBe(false);
    expect(evidence.some((e) => e.testId === T('lists.create-rename'))).toBe(false);
    // stderr explains what was ignored or missing
    expect(r.stderr).toMatch(/test.tasky.not.in.contract.*not in the contract/);
    expect(r.stderr).toMatch(/contract test "test.tasky.lists.create-rename" has no result/);
  });

  it('omits the commit and says why when it cannot be known, and never invents one', () => {
    const r = run('--vitest-report', vitestReport);
    const evidence = (parseContract(r.stdout).contract as OrbitContract).evidence;
    expect(evidence.length).toBeGreaterThan(0);
    for (const e of evidence) {
      expect(e).not.toHaveProperty('commit');
      expect(e.details).toMatch(/commit unknown/);
    }
  });

  it('records an explicit --commit and rejects malformed SHAs', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567';
    const ok = run('--vitest-report', vitestReport, '--commit', sha);
    expect((parseContract(ok.stdout).contract as OrbitContract).evidence.every((e) => e.commit === sha)).toBe(true);
    const bad = run('--vitest-report', vitestReport, '--commit', 'abc123');
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toMatch(/40/);
  });

  it('--out appends history, skips exact duplicates, and --keep prunes per test', () => {
    const out1 = join(work, 'out1.json');
    expect(run('--vitest-report', vitestReport, '--out', out1).status).toBe(0);
    const count1 = (parseContract(readFileSync(out1, 'utf8')).contract as OrbitContract).evidence.length;
    expect(count1).toBe(4);

    // second run with a later report on top of out1 -> history grows
    const later = join(work, 'vitest-later.json');
    const report = JSON.parse(readFileSync(vitestReport, 'utf8'));
    report.testResults[0].startTime += 60_000;
    writeFileSync(later, JSON.stringify(report));
    const out2 = join(work, 'out2.json');
    const r2 = spawnSync('node', [script, '--contract', out1, '--vitest-report', later, '--out', out2], { encoding: 'utf8' });
    expect(r2.status).toBe(0);
    const ev2 = (parseContract(readFileSync(out2, 'utf8')).contract as OrbitContract).evidence;
    expect(ev2).toHaveLength(8);
    expect(new Set(ev2.map((e) => e.id)).size).toBe(8);

    // identical report again -> nothing new
    const out3 = join(work, 'out3.json');
    const r3 = spawnSync('node', [script, '--contract', out2, '--vitest-report', later, '--out', out3], { encoding: 'utf8' });
    expect(r3.stderr).toMatch(/already recorded/);
    expect((parseContract(readFileSync(out3, 'utf8')).contract as OrbitContract).evidence).toHaveLength(8);

    // --keep 1 retains the latest per test
    const out4 = join(work, 'out4.json');
    const r4 = spawnSync('node', [script, '--contract', out2, '--vitest-report', later, '--keep', '1', '--out', out4], { encoding: 'utf8' });
    expect(r4.status).toBe(0);
    const ev4 = (parseContract(readFileSync(out4, 'utf8')).contract as OrbitContract).evidence;
    expect(ev4).toHaveLength(4);
    expect(ev4.every((e) => e.executedAt === '2026-11-13T18:01:05Z')).toBe(true);
  });

  it('--write updates the contract file in place', () => {
    const copy = join(work, 'write.orbit.json');
    writeFileSync(copy, readFileSync(contractPath, 'utf8'));
    const r = spawnSync('node', [script, '--contract', copy, '--playwright-report', playwrightReport, '--write'], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Evidence summary/);
    expect((parseContract(readFileSync(copy, 'utf8')).contract as OrbitContract).evidence).toHaveLength(5);
  });

  it('refuses an invalid contract and writes nothing', () => {
    const bad = join(work, 'bad.orbit.json');
    writeFileSync(bad, '{"schemaVersion": 1}');
    const out = join(work, 'bad-out.json');
    const r = spawnSync('node', [script, '--contract', bad, '--vitest-report', vitestReport, '--out', out], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/invalid/);
    expect(existsSync(out)).toBe(false);
  });
});
