import { describe, expect, it } from 'vitest';
import { activePreset, computeComparison, presetComparison, revFromKey, revKey, revLabel } from '../../src/state/compare';
import { createToolRuntime } from '../../src/mcp/tools';
import type { MemorySeed } from '../../src/host/memoryHost';
import { DEMO_BASE, DEMO_IMPL, FILE, SHA1, read, setup } from './util';

const PROPOSAL = read('examples/demo/03-proposal.orbit.json');
const SHA_P = 'c3'.repeat(20);
const SHA_MAIN2 = 'e5'.repeat(20);
const REL = 'tasky.orbit.json';

/** main: base -> main2 (main moved on). feat: base -> proposal (HEAD). Working tree: implementation. */
function featureRepo(opts: { tagged?: boolean; head?: string } = {}): NonNullable<MemorySeed['git']> {
  return {
    repoRoot: '/work/repo',
    commits: {
      [SHA1]: { subject: 'base', date: '2026-11-01T00:00:00Z', files: { [REL]: DEMO_BASE } },
      [SHA_MAIN2]: { subject: 'main moves on', date: '2026-11-02T00:00:00Z', files: { [REL]: DEMO_IMPL }, parents: [SHA1] },
      [SHA_P]: { subject: 'propose', date: '2026-11-03T00:00:00Z', files: { [REL]: PROPOSAL }, parents: [SHA1] },
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
  it('round-trips the baseline revision and labels the proposal tag', () => {
    const b = { type: 'baseline', branch: 'main' } as const;
    expect(revFromKey(revKey(b))).toEqual(b);
    expect(revLabel(b)).toBe('Baseline (main)');
    expect(revLabel({ type: 'ref', name: 'orbit/proposal/feat' })).toBe('Proposal');
  });

  it('builds the three comparisons, and explains why proposal views are unavailable without a tag', async () => {
    const { store } = await boot(featureRepo());
    const s = store.getState();
    expect(presetComparison('actual', s.git, s.refs, false)).toEqual({ ok: true, comparison: { base: { type: 'baseline', branch: 'main' }, target: { type: 'working' } } });
    const p = presetComparison('proposal', s.git, s.refs, false);
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toContain('orbit/proposal/feat');
    expect(presetComparison('vs-proposal', s.git, s.refs, true).ok).toBe(false);

    const t = await boot(featureRepo({ tagged: true }));
    const s2 = t.store.getState();
    expect(presetComparison('proposal', s2.git, s2.refs, false)).toEqual({ ok: true, comparison: { base: { type: 'baseline', branch: 'main' }, target: { type: 'ref', name: 'orbit/proposal/feat' } } });
    expect(presetComparison('vs-proposal', s2.git, s2.refs, true)).toEqual({ ok: true, comparison: { base: { type: 'ref', name: 'orbit/proposal/feat' }, target: { type: 'unsaved' } } });
    // "latest" matches working tree or unsaved edits
    expect(activePreset({ base: { type: 'ref', name: 'orbit/proposal/feat' }, target: { type: 'working' } }, s2.git, s2.refs, true)).toBe('vs-proposal');
    expect(activePreset({ base: { type: 'ref', name: 'HEAD' }, target: { type: 'working' } }, s2.git, s2.refs, false)).toBeNull();
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

describe('mark_proposal / view_changes', () => {
  it('refuses while the contract differs from HEAD, then tags HEAD once committed', async () => {
    const { call } = await boot(featureRepo(), DEMO_IMPL);
    const no = await call('mark_proposal');
    expect(no.err).toBe(true);
    expect(no.d.error ?? JSON.stringify(no.d)).toMatch(/differs from what is committed/);

    // after the AI commits the proposal, the working tree equals HEAD
    const { call: call2, store: store2 } = await boot(featureRepo(), PROPOSAL);
    const yes = await call2('mark_proposal', { show: true });
    expect(yes.err, JSON.stringify(yes.d)).toBe(false);
    expect(yes.d).toMatchObject({ tag: 'orbit/proposal/feat', commit: SHA_P, replaced: false });
    const s = store2.getState();
    expect(s.refs.some((r) => r.name === 'orbit/proposal/feat')).toBe(true);
    expect(s.view).toBe('impact');
    expect(activePreset(s.compare, s.git, s.refs, false)).toBe('proposal');

    const again = await call2('mark_proposal');
    expect(again.err).toBe(true);
    expect((await call2('mark_proposal', { replace: true })).d).toMatchObject({ replaced: true });
  });

  it('refuses on the base branch', async () => {
    const git = featureRepo({ head: 'main' });
    const { call } = await boot(git, DEMO_IMPL);
    const r = await call('mark_proposal');
    expect(r.err).toBe(true);
    expect(JSON.stringify(r.d)).toContain('base branch');
  });

  it('view_changes returns the semantic diff for each view', async () => {
    const { call } = await boot(featureRepo({ tagged: true }), DEMO_IMPL);
    const prop = await call('view_changes', { view: 'proposal' });
    expect(prop.err, JSON.stringify(prop.d)).toBe(false);
    expect(prop.d.label).toBe('Proposal');
    expect(prop.d.comparison.label).toBe('Baseline (main) → Proposal');
    expect(prop.d.totalChanges).toBeGreaterThan(0);
    const vs = await call('view_changes', { view: 'vs-proposal' });
    expect(vs.d.comparison.label).toBe('Proposal → Working tree');
    const act = await call('view_changes', { view: 'actual' });
    expect(act.d.comparison.label).toBe('Baseline (main) → Working tree');
    const st = await call('get_status');
    expect(st.d.git.proposal).toEqual({ tag: 'orbit/proposal/feat', commit: SHA_P });
    expect(st.d.comparison.view).toBe('actual');
    const viaCompare = await call('compare', { base: 'baseline', target: 'proposal' });
    expect(viaCompare.d.comparison.label).toBe('Baseline (main) → Proposal');
  });
});
