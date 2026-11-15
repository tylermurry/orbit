import { describe, expect, it } from 'vitest';
import { computeComparison, presetComparison, revFromKey, revKey, revLabel } from '../../src/state/compare';
import { createToolRuntime } from '../../src/mcp/tools';
import { planPath } from '../../src/state/plan';
import type { MemorySeed } from '../../src/host/memoryHost';
import { DEMO_BASE, DEMO_IMPL, FILE, SHA1, read, setup } from './util';

const PLAN_CONTRACT = read('examples/demo/03-proposal.orbit.json');
const SHA_P = 'c3'.repeat(20);
const SHA_MAIN2 = 'e5'.repeat(20);
const REL = 'tasky.orbit.json';

/** main: base -> main2 (main moved on). feat: base -> plan (HEAD). Working tree: implementation. */
function featureRepo(opts: { tagged?: boolean; head?: string } = {}): NonNullable<MemorySeed['git']> {
  return {
    repoRoot: '/work/repo',
    commits: {
      [SHA1]: { subject: 'base', date: '2026-11-01T00:00:00Z', files: { [REL]: DEMO_BASE } },
      [SHA_MAIN2]: { subject: 'main moves on', date: '2026-11-02T00:00:00Z', files: { [REL]: DEMO_IMPL }, parents: [SHA1] },
      [SHA_P]: { subject: 'propose', date: '2026-11-03T00:00:00Z', files: { [REL]: PLAN_CONTRACT }, parents: [SHA1] },
    },
    refs: [
      { name: 'main', kind: 'branch', commit: SHA_MAIN2 },
      { name: 'feat', kind: 'branch', commit: SHA_P },
      ...(opts.tagged ? [{ name: 'orbit/proposal/feat', kind: 'tag' as const, commit: SHA_P }] : []),
    ],
    head: { branch: opts.head ?? 'feat' },
  };
}

async function boot(git: NonNullable<MemorySeed['git']>, text = DEMO_IMPL) {
  const s = setup({ git }, text);
  await s.ctrl.openPath(FILE);
  const rt = createToolRuntime({ store: s.store, ctrl: s.ctrl, host: s.host, now: () => new Date('2026-11-14T00:00:00Z') });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rt.callTool(name, args);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { d: r.structuredContent as any, err: !!r.isError };
  };
  return { ...s, call };
}

describe('lifecycle presets', () => {
  it('keeps orbit.plan.json next to the contract', () => {
    expect(planPath({ available: true, repoRoot: '/r', relPath: 'orbit.json' } as never)).toBe('/r/orbit.plan.json');
    expect(planPath({ available: true, repoRoot: '/r/', relPath: 'apps/web/orbit.json' } as never)).toBe('/r/apps/web/orbit.plan.json');
    expect(planPath(null)).toBeNull();
  });

  it('round-trips the pinned baseline and the plan', () => {
    const baseline = { type: 'pinned', sha: SHA1 } as const;
    const plan = { type: 'plan' } as const;
    expect(revFromKey(revKey(baseline))).toEqual(baseline);
    expect(revFromKey(revKey(plan))).toEqual(plan);
    expect(revLabel(plan)).toBe('Plan');
  });

  it('ignores legacy tags and falls back to the Git baseline for Actual', async () => {
    const { store } = await boot(featureRepo({ tagged: true }));
    const s = store.getState();
    expect(presetComparison('actual', s.git, s.refs)).toEqual({ ok: true, comparison: { base: { type: 'baseline', branch: 'main' }, target: { type: 'working' } } });
    expect(presetComparison('plan', s.git, s.refs)).toEqual({ ok: false, reason: 'Run /orbit-plan to create orbit.plan.json.' });
    expect(presetComparison('plan-vs-actual', s.git, s.refs).ok).toBe(false);
  });

  it('baseline is the merge-base, not the tip of main', async () => {
    const { host, store } = await boot(featureRepo());
    const git = store.getState().git!;
    const r = await computeComparison({ host, git, filePath: FILE, comparison: { base: { type: 'baseline', branch: 'main' }, target: { type: 'ref', name: 'HEAD' } }, unsavedContract: null });
    expect(r.status).toBe('ready');
    if (r.status === 'ready') expect(r.base.commit).toBe(SHA1);
  });

  it('a fresh feature branch shows no changes in View actual', async () => {
    const { ctrl, store } = await boot(featureRepo({ head: 'main' }), DEMO_IMPL);
    // on main itself, baseline == HEAD
    expect(ctrl.applyPreset('actual')).toBeNull();
    await ctrl.recomputeCompare();
    const r = store.getState().compareResult!;
    expect(r.status).toBe('ready');
    if (r.status === 'ready') expect(r.diff.changes).toHaveLength(0);
  });

});

const PLAN_FILE = '/work/repo/orbit.plan.json';
const addTest = { tool: 'create_test', args: { id: 'test.sample', name: 'Sample', location: 'tests/sample.ts › verifies sample' } };
const rename = { tool: 'update_product', args: { name: 'Proposed title' } };

describe('file-backed plan tools', () => {
  it('creates from HEAD, compares it with Actual without any approval, and revises it in place', async () => {
    const { call, host, store } = await boot(featureRepo());
    const made = await call('create_plan', { operations: [addTest] });
    expect(made.err).toBe(false);
    expect(made.d).toMatchObject({ baseline: SHA_P, fileHash: expect.any(String) });
    expect(host.getFile(FILE)).toBe(DEMO_IMPL);
    const preview = await call('view_changes', { view: 'plan', show: true });
    expect(preview.err).toBe(false);
    expect(preview.d.changes).toContainEqual(expect.objectContaining({ key: 'test:test.sample', planStatus: 'Planned' }));
    const before = await call('view_changes', { view: 'plan-vs-actual' });
    expect(before.err).toBe(false);
    expect(before.d.changes).toContainEqual(expect.objectContaining({ key: 'test:test.sample', planStatus: 'Pending' }));
    // revising needs the hash of the plan as last seen
    expect((await call('revise_plan', { fileHash: 'stale', operations: [rename] })).err).toBe(true);
    const revised = await call('revise_plan', { fileHash: made.d.fileHash, operations: [rename] });
    expect(revised.d).toMatchObject({ baseline: SHA_P });
    expect(revised.d.fileHash).not.toBe(made.d.fileHash);
    const comparison = await call('view_changes', { view: 'plan-vs-actual' });
    expect(comparison.err).toBe(false);
    expect(store.getState().compareResult).toMatchObject({ status: 'ready', diff: { base: { product: { name: 'Proposed title' } } } });
    const saved = JSON.parse(host.getFile(PLAN_FILE)!);
    expect(saved.contract.product.name).toBe('Proposed title');
    expect(saved).not.toHaveProperty('draft');
    expect(saved).not.toHaveProperty('approved');
    expect(host.getFile(FILE)).toBe(DEMO_IMPL);
  });

  it('checks explicit baselines and protects a different branch’s plan', async () => {
    const { call, host } = await boot(featureRepo());
    expect((await call('create_plan', { baseline: 'missing', operations: [addTest] })).err).toBe(true);
    expect((await call('create_plan', { baseline: SHA1, operations: [addTest] })).d.baseline).toBe(SHA1);
    const file = JSON.parse(host.getFile(PLAN_FILE)!);
    await host.externalWrite(PLAN_FILE, JSON.stringify({ ...file, branch: 'other' }));
    expect((await call('create_plan', { operations: [addTest] })).err).toBe(true);
    expect((await call('create_plan', { operations: [addTest], replace: true })).err).toBe(true);
    const current = await call('get_plan');
    expect((await call('create_plan', { operations: [addTest], replace: true, fileHash: current.d.fileHash })).d.branch).toBe('feat');
  });

  it('refreshes the active plan when the file changes or is removed', async () => {
    const { call, ctrl, host, store } = await boot(featureRepo());
    await call('create_plan', { operations: [addTest] });
    await call('view_changes', { view: 'plan' });
    const file = JSON.parse(host.getFile(PLAN_FILE)!);
    const seen = (await call('get_plan')).d.fileHash;
    file.contract.product.name = 'Externally edited';
    await host.externalWrite(PLAN_FILE, JSON.stringify(file));
    expect((await call('revise_plan', { fileHash: seen, operations: [rename] })).err).toBe(true);
    await ctrl.refreshPlan();
    await ctrl.recomputeCompare();
    expect(store.getState().compareResult).toMatchObject({ status: 'ready', diff: { target: { product: { name: 'Externally edited' } } } });
    host.externalDelete(PLAN_FILE);
    await ctrl.refreshPlan();
    expect((await call('view_changes', { view: 'plan' })).err).toBe(true);
    expect((await call('view_changes', { view: 'actual' })).err).toBe(false);
  });
});
