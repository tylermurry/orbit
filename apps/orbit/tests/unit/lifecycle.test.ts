import { describe, expect, it } from 'vitest';
import { computeComparison, presetComparison, revFromKey, revKey, revLabel } from '../../src/state/compare';
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
  it('round-trips the pinned baseline and proposal revision', () => {
    const baseline = { type: 'pinned', sha: SHA1 } as const;
    const approved = { type: 'proposal', revision: 'approved' } as const;
    expect(revFromKey(revKey(baseline))).toEqual(baseline);
    expect(revFromKey(revKey(approved))).toEqual(approved);
    expect(revLabel(approved)).toBe('Approved proposal');
  });

  it('ignores legacy tags and falls back to the Git baseline for Actual', async () => {
    const { store } = await boot(featureRepo({ tagged: true }));
    const s = store.getState();
    expect(presetComparison('actual', s.git, s.refs)).toEqual({ ok: true, comparison: { base: { type: 'baseline', branch: 'main' }, target: { type: 'working' } } });
    expect(presetComparison('proposal', s.git, s.refs)).toEqual({ ok: false, reason: 'Run /orbit-plan to create orbit.proposal.json.' });
    expect(presetComparison('vs-proposal', s.git, s.refs).ok).toBe(false);
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

const PROPOSAL_FILE = '/work/repo/orbit.proposal.json';
const addTest = { tool: 'create_test', args: { id: 'test.sample', name: 'Sample', location: 'tests/sample.ts › verifies sample' } };
const rename = { tool: 'update_product', args: { name: 'Proposed title' } };

describe('file-backed proposal tools', () => {
  it('creates from HEAD, pins approval, and keeps later drafts separate from Actual', async () => {
    const { call, host, store } = await boot(featureRepo());
    const made = await call('create_proposal', { operations: [addTest] });
    expect(made.err).toBe(false);
    expect(made.d).toMatchObject({ baseline: SHA_P, revision: 1, approvedRevision: null });
    expect(host.getFile(FILE)).toBe(DEMO_IMPL);
    expect((await call('view_changes', { view: 'vs-proposal' })).err).toBe(true);
    const preview = await call('view_changes', { view: 'proposal', show: true });
    expect(preview.err).toBe(false);
    expect(preview.d.changes).toContainEqual(expect.objectContaining({ key: 'test:test.sample', proposalStatus: 'Planned' }));
    expect((await call('approve_proposal', { revision: 1, fileHash: preview.d.proposalFileHash })).d.approvedRevision).toBe(1);
    expect((await call('revise_proposal', { revision: 1, operations: [rename] })).d).toMatchObject({ baseline: SHA_P, revision: 2, approvedRevision: 1 });
    expect((await call('approve_proposal', { revision: 1, fileHash: preview.d.proposalFileHash })).err).toBe(true);
    const comparison = await call('view_changes', { view: 'vs-proposal' });
    expect(comparison.err).toBe(false);
    expect(comparison.d.changes).toContainEqual(expect.objectContaining({ key: 'test:test.sample', proposalStatus: 'Pending' }));
    expect(store.getState().compareResult).toMatchObject({ status: 'ready', diff: { base: { product: { name: JSON.parse(PROPOSAL).product.name } } } });
    expect(JSON.parse(host.getFile(PROPOSAL_FILE)!).draft.contract.product.name).toBe('Proposed title');
    expect(host.getFile(FILE)).toBe(DEMO_IMPL);
  });

  it('checks explicit baselines and protects a different branch’s proposal', async () => {
    const { call, host } = await boot(featureRepo());
    expect((await call('create_proposal', { baseline: 'missing', operations: [addTest] })).err).toBe(true);
    expect((await call('create_proposal', { baseline: SHA1, operations: [addTest] })).d.baseline).toBe(SHA1);
    const file = JSON.parse(host.getFile(PROPOSAL_FILE)!);
    await host.externalWrite(PROPOSAL_FILE, JSON.stringify({ ...file, branch: 'other' }));
    expect((await call('create_proposal', { operations: [addTest] })).err).toBe(true);
    expect((await call('create_proposal', { operations: [addTest], replace: true, revision: 1 })).d.branch).toBe('feat');
  });

  it('refreshes the active proposal when the file changes or is removed', async () => {
    const { call, ctrl, host, store } = await boot(featureRepo());
    await call('create_proposal', { operations: [addTest] });
    await call('view_changes', { view: 'proposal' });
    const file = JSON.parse(host.getFile(PROPOSAL_FILE)!);
    file.draft.contract.product.name = 'Externally edited';
    const review = await call('view_changes', { view: 'proposal' });
    await host.externalWrite(PROPOSAL_FILE, JSON.stringify(file));
    expect((await call('approve_proposal', { revision: 1, fileHash: review.d.proposalFileHash })).err).toBe(true);
    await ctrl.refreshProposal();
    await ctrl.recomputeCompare();
    expect(store.getState().compareResult).toMatchObject({ status: 'ready', diff: { target: { product: { name: 'Externally edited' } } } });
    host.externalDelete(PROPOSAL_FILE);
    await ctrl.refreshProposal();
    expect((await call('view_changes', { view: 'proposal' })).err).toBe(true);
    expect((await call('view_changes', { view: 'actual' })).err).toBe(false);
  });
});
