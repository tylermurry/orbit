import { describe, expect, it } from 'vitest';
import { computeComparison, defaultComparison, revFromKey, revKey, revLabel } from '../../src/state/compare';
import { buildTree, searchTree } from '../../src/lib/model';
import { localInputToRfc3339, relativeTime, rfc3339ToLocalInput, wordDiff } from '../../src/lib/format';
import { parseContract } from '@orbit/contract';
import { DEMO_BASE, DEMO_IMPL, FILE, SHA1, SHA2, TASKY, gitSeed, setup } from './util';

describe('comparison selection defaults', () => {
  it('is null without git', () => {
    expect(defaultComparison(null, false)).toBeNull();
    expect(defaultComparison({ available: false }, true)).toBeNull();
  });
  it('defaults to HEAD -> Working tree, or Unsaved edits when dirty', () => {
    const git = { available: true, headCommit: SHA1 };
    expect(defaultComparison(git, false)).toEqual({ base: { type: 'ref', name: 'HEAD' }, target: { type: 'working' } });
    expect(defaultComparison(git, true)).toEqual({ base: { type: 'ref', name: 'HEAD' }, target: { type: 'unsaved' } });
  });
  it('round-trips revision keys and labels', () => {
    for (const sel of [{ type: 'working' }, { type: 'unsaved' }, { type: 'ref', name: 'feature/x' }, { type: 'sha', sha: SHA1 }] as const) {
      expect(revFromKey(revKey(sel))).toEqual(sel);
    }
    expect(revLabel({ type: 'sha', sha: SHA1 })).toBe(`Commit ${SHA1.slice(0, 7)}`);
  });
});

describe('computeComparison', () => {
  async function run(workingText: string, comparison: Parameters<typeof computeComparison>[0]['comparison']) {
    const { host } = setup({ git: gitSeed() }, workingText);
    const git = await host.gitContext(FILE);
    return computeComparison({ host, git, filePath: FILE, comparison, unsavedContract: null });
  }

  it('compares HEAD with the working tree semantically', async () => {
    const r = await run(DEMO_IMPL, { base: { type: 'ref', name: 'HEAD' }, target: { type: 'working' } });
    expect(r.status).toBe('ready');
    if (r.status !== 'ready') return;
    expect(r.diff.changes.length).toBeGreaterThan(0);
    expect(r.diff.contractStatus).toBe('present');
  });

  it('reports no changes for an identical working tree', async () => {
    const r = await run(DEMO_BASE, { base: { type: 'ref', name: 'HEAD' }, target: { type: 'working' } });
    expect(r.status === 'ready' && r.diff.changes).toEqual([]);
  });

  it('blocks (never text-diffs) when a side is invalid', async () => {
    const r = await run('{ "broken": ', { base: { type: 'ref', name: 'HEAD' }, target: { type: 'working' } });
    expect(r.status).toBe('blocked');
    if (r.status === 'blocked') {
      expect(r.target.invalid).toBe(true);
      expect(r.target.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it('gives an actionable error for an unknown ref', async () => {
    const r = await run(TASKY, { base: { type: 'ref', name: 'nope' }, target: { type: 'working' } });
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.message).toMatch(/Cannot resolve revision 'nope'/);
  });

  it('treats a missing file at a revision as added/removed', async () => {
    const { host } = setup({ git: { ...gitSeed(), commits: { [SHA1]: { subject: 'empty', date: '2026-11-01T00:00:00Z', files: {} }, [SHA2]: gitSeed().commits[SHA2] } } }, DEMO_IMPL);
    const git = await host.gitContext(FILE);
    const r = await computeComparison({ host, git, filePath: FILE, comparison: { base: { type: 'ref', name: 'HEAD' }, target: { type: 'working' } }, unsavedContract: null });
    expect(r.status === 'ready' && r.diff.contractStatus).toBe('added');
  });

  it('uses unsaved in-memory edits when selected', async () => {
    const { host } = setup({ git: gitSeed() }, DEMO_BASE);
    const git = await host.gitContext(FILE);
    const edited = parseContract(DEMO_BASE).contract!;
    edited.entities = edited.entities.map((e, i) => (i === 0 ? { ...e, name: 'Edited in Orbit' } : e));
    const r = await computeComparison({ host, git, filePath: FILE, comparison: { base: { type: 'ref', name: 'HEAD' }, target: { type: 'unsaved' } }, unsavedContract: edited });
    expect(r.status === 'ready' && r.diff.changes.some((c) => c.fields.some((f) => f.field === 'name'))).toBe(true);
  });
});

describe('tree and search helpers', () => {
  const contract = parseContract(TASKY).contract!;
  it('builds a same-kind forest sorted by name', () => {
    const roots = buildTree(contract, 'capability');
    expect(roots.map((r) => r.entity.name)).toEqual(['Task Discovery', 'Task Management', 'Task Organization']);
    expect(roots.every((r) => r.children.every((c) => c.entity.kind === 'capability'))).toBe(true);
  });
  it('shows ghosts under their parent', () => {
    const ghost = { ...contract.entities.find((e) => e.id === 'cap.task-management.create-edit')!, id: 'cap.ghost', name: 'Ghost', parentId: 'cap.task-management' };
    const roots = buildTree(contract, 'capability', [ghost]);
    const tm = roots.find((r) => r.entity.id === 'cap.task-management')!;
    expect(tm.children.find((c) => c.entity.id === 'cap.ghost')?.ghost).toBe(true);
  });
  it('search matches names, ids and behaviors, keeping ancestors visible', () => {
    const roots = buildTree(contract, 'capability');
    const sr = searchTree(roots, 'overdue')!;
    expect(sr.matches.size).toBeGreaterThan(0);
    expect(sr.visible.has('cap.task-discovery')).toBe(true);
    expect(searchTree(roots, 'zzzz-no-such-thing')!.visible.size).toBe(0);
    expect(searchTree(roots, '  ')).toBeNull();
  });
});

describe('format helpers', () => {
  it('converts datetime-local input to RFC3339 UTC', () => {
    const iso = localInputToRfc3339('2026-11-13T10:30:00');
    expect(iso).toMatch(/^2026-11-13T\d\d:30:00Z$/);
    expect(localInputToRfc3339('')).toBeNull();
    expect(rfc3339ToLocalInput('2026-11-13T10:30:00Z')).toMatch(/^2026-11-1[23]T\d\d:30:00$/);
  });
  it('word diff highlights only changed words', () => {
    const parts = wordDiff('a quick brown fox', 'a slow brown fox');
    expect(parts.filter((p) => p.type === 'del').map((p) => p.text.trim())).toEqual(['quick']);
    expect(parts.filter((p) => p.type === 'add').map((p) => p.text.trim())).toEqual(['slow']);
  });
  it('relative time', () => {
    const now = Date.parse('2026-11-13T12:00:00Z');
    expect(relativeTime('2026-11-13T11:00:00Z', now)).toBe('1 hour ago');
    expect(relativeTime('2026-11-10T12:00:00Z', now)).toBe('3 days ago');
  });
});
