import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { diffContracts, parseContract, type OrbitContract } from '@orbit/contract';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const script = join(root, 'scripts/create-demo-repo.mjs');
const FILE = 'tasky.orbit.json';

let work: string;
let repo: string;
let info: {
  dir: string;
  checkedOut: string;
  branches: string[];
  commits: { base: string; main: string; proposal: string; implementationCode: string; implementationContract: string };
};

const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
function contractAt(ref: string): OrbitContract {
  const text = ref === 'WORKING' ? readFileSync(join(repo, FILE), 'utf8') : git('show', `${ref}:${FILE}`);
  const parsed = parseContract(text);
  expect(parsed.diagnostics.filter((d) => d.severity === 'error'), `contract at ${ref}`).toEqual([]);
  return parsed.contract as OrbitContract;
}
const diff = (from: string, to: string) => diffContracts(contractAt(from), contractAt(to));
const zero = { added: 0, removed: 0, modified: 0 };

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'orbit-demo-test-'));
  const dir = join(work, 'repo');
  const out = execFileSync('node', [script, '--dir', dir, '--json'], { encoding: 'utf8' });
  info = JSON.parse(out);
  repo = info.dir;
});

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe('demo repository structure', () => {
  it('creates main, proposal and implementation branches with the implementation checked out', () => {
    expect([...info.branches].sort()).toEqual(['implementation', 'main', 'proposal']);
    expect(git('rev-parse', '--abbrev-ref', 'HEAD')).toBe('implementation');
    expect(git('rev-parse', 'main')).toBe(info.commits.main);
    expect(git('rev-parse', 'proposal~1')).toBe(info.commits.main);
    expect(git('rev-parse', 'implementation~2')).toBe(info.commits.main);
    expect(git('rev-parse', 'implementation~1')).toBe(info.commits.implementationCode);
    expect(git('rev-parse', 'implementation')).toBe(info.commits.implementationContract);
  });

  it('commits code changes with every contract change and uses an uncommitted working-tree edit', () => {
    const touched = (ref: string) => git('show', '--name-only', '--format=', ref).split('\n').sort();
    expect(touched(info.commits.main)).toEqual(['src/tasky.js', FILE]);
    expect(touched(info.commits.proposal)).toEqual(['src/tasky.js', FILE]);
    expect(touched(info.commits.implementationCode)).toEqual(['src/tasky.js']);
    expect(touched(info.commits.implementationContract)).toEqual([FILE]);
    expect(git('status', '--porcelain')).toBe(`M ${FILE}`); // (git() trims the leading space of " M")
  });

  it('refuses to reuse a non-empty directory', () => {
    const r = spawnSync('node', [script, '--dir', repo, '--json'], { encoding: 'utf8' });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/not empty/);
  });

  it('never configures the repository outside the temporary directory', () => {
    expect(git('config', '--local', 'user.email')).toBe('orbit-demo@example.invalid');
    expect(existsSync(join(repo, '.git'))).toBe(true);
    expect(git('rev-parse', '--show-toplevel')).toBe(repo);
  });
});

describe('reformatted snapshot', () => {
  it('has zero semantic changes versus the base even though the text differs', () => {
    expect(git('show', `${info.commits.base}:${FILE}`)).not.toBe(git('show', `${info.commits.main}:${FILE}`));
    const d = diff(info.commits.base, info.commits.main);
    expect(d.changes).toEqual([]);
    expect(d.directlyChangedEntityIds).toEqual([]);
    expect(d.potentiallyAffected).toEqual([]);
    for (const totals of Object.values(d.totals)) expect(totals).toEqual(zero);
    expect(Object.values(d.entityStates).every((s) => s.status === 'unchanged')).toBe(true);
  });
});

describe('main -> proposal', () => {
  const d = () => diff('main', 'proposal');

  it('counts one added behavior, relationship and test and nothing else', () => {
    const { totals } = d();
    expect(totals.behavior).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(totals.relationship).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(totals.test).toEqual({ added: 1, removed: 0, modified: 0 });
    for (const c of ['product', 'entity'] as const) expect(totals[c]).toEqual(zero);
  });

  it('reports the added behavior and relationship as product-guarantee changes and the test as verification', () => {
    const changes = d().changes;
    const behavior = changes.find((c) => c.key === 'behavior:behavior.today.overdue-stays-visible');
    expect(behavior).toMatchObject({ kind: 'added', group: 'guarantee', ownerAfter: 'cap.task-discovery.today-overdue', label: 'Overdue items remain visible in Today' });
    const relationship = changes.find((c) => c.key === 'relationship:rel.today-overdue.depends-on.complete-delete');
    expect(relationship).toMatchObject({ kind: 'added', group: 'guarantee', entityIds: ['cap.task-discovery.today-overdue'] });
    const test = changes.find((c) => c.key === 'test:test.tasky.views.overdue-stays-visible');
    expect(test).toMatchObject({ kind: 'added', group: 'verification', entityIds: [] });
  });

  it('marks only Today and Overdue as directly changed and finds no consumers', () => {
    const r = d();
    expect(r.directlyChangedEntityIds).toEqual(['cap.task-discovery.today-overdue']);
    expect(r.potentiallyAffected).toEqual([]);
    expect(r.entityStates['cap.task-discovery.today-overdue'].status).toBe('modified');
    // a modified source does not impact its targets
    expect(r.entityStates['cap.task-management.complete-delete'].status).toBe('unchanged');
    // the parent is not "modified", but reports a changed descendant
    expect(r.entityStates['cap.task-discovery']).toMatchObject({ status: 'unchanged', changedDescendants: 1 });
  });
});

describe('main -> implementation', () => {
  const d = () => diff('main', 'implementation');

  it('has the expected counts by category', () => {
    const { totals } = d();
    expect(totals.entity).toEqual({ added: 0, removed: 1, modified: 0 });
    expect(totals.behavior).toEqual({ added: 1, removed: 0, modified: 4 });
    expect(totals.relationship).toEqual({ added: 0, removed: 1, modified: 1 });
    expect(totals.test).toEqual({ added: 1, removed: 0, modified: 0 });
    expect(totals.product).toEqual(zero);
  });

  it('reports field-level before/after deltas by id', () => {
    const changes = d().changes;
    const overdue = changes.find((c) => c.key === 'behavior:behavior.localdate.overdue-classification');
    expect(overdue).toMatchObject({ kind: 'modified', group: 'guarantee' });
    expect(overdue?.fields.map((f) => f.field)).toEqual(['expected']);
    expect(overdue?.fields[0].before).toMatch(/^A due date before the local date is overdue, a due date on or before/);
    expect(overdue?.fields[0].after).toMatch(/for the whole day/);

    const moved = changes.find((c) => c.key === 'behavior:behavior.tasks.delete-confirm');
    expect(moved).toMatchObject({
      kind: 'modified',
      ownerBefore: 'cap.task-management.complete-delete',
      ownerAfter: 'cap.task-management.create-edit',
    });
    expect(moved?.fields.map((f) => f.field)).toContain('owner');

    const reworded = changes.find((c) => c.key === 'relationship:rel.create-edit.implemented-by.task-repository');
    expect(reworded).toMatchObject({ kind: 'modified', group: 'guarantee' });
    expect(reworded?.fields.map((f) => f.field)).toEqual(['description']);

    expect(changes.find((c) => c.key === 'relationship:rel.complete-delete.implemented-by.task-repository')).toMatchObject({ kind: 'removed' });
    expect(changes.find((c) => c.key === 'behavior:behavior.tasks.edit-notes')).toMatchObject({ kind: 'added', ownerAfter: 'cap.task-management.create-edit' });
  });

  it('shows the removed entity as a ghost that is directly changed', () => {
    const r = d();
    const ghost = r.entityStates['cap.task-management.complete-delete'];
    expect(ghost).toMatchObject({ status: 'removed', ghost: true });
    expect(r.target?.entities.some((e) => e.id === 'cap.task-management.complete-delete')).toBe(false);
    expect(r.base?.entities.some((e) => e.id === 'cap.task-management.complete-delete')).toBe(true);
    expect([...r.directlyChangedEntityIds].sort()).toEqual([
      'cap.task-management.complete-delete',
      'cap.task-management.create-edit',
      'sys.local-date',
    ]);
  });

  it('finds reverse-edge, multi-hop potential impact with relationship paths', () => {
    const r = d();
    const affected = new Map(r.potentiallyAffected.map((p) => [p.entityId, p]));
    expect([...affected.keys()].sort()).toEqual(['cap.task-discovery.inbox-all', 'cap.task-discovery.today-overdue', 'sys.filtering-sorting']);

    const filtering = affected.get('sys.filtering-sorting');
    expect(filtering?.changedEntityId).toBe('sys.local-date');
    expect(filtering?.path.map((s) => s.relationshipId)).toEqual(['rel.filtering-sorting.uses.local-date']);

    const inbox = affected.get('cap.task-discovery.inbox-all');
    expect(inbox?.changedEntityId).toBe('sys.local-date');
    expect(inbox?.path.map((s) => s.relationshipId)).toEqual(['rel.inbox-all.uses.filtering-sorting', 'rel.filtering-sorting.uses.local-date']);
    expect(inbox?.path.map((s) => `${s.sourceId}>${s.targetId}`)).toEqual([
      'cap.task-discovery.inbox-all>sys.filtering-sorting',
      'sys.filtering-sorting>sys.local-date',
    ]);

    // reachable through two routes (Create and Edit, Local Date) but reported once, by shortest path
    expect(r.potentiallyAffected.filter((p) => p.entityId === 'cap.task-discovery.today-overdue')).toHaveLength(1);
    expect(affected.get('cap.task-discovery.today-overdue')?.path).toHaveLength(1);

    // affected and directly changed sets never overlap, and states are labelled accordingly
    for (const id of r.directlyChangedEntityIds) expect(affected.has(id)).toBe(false);
    expect(r.entityStates['cap.task-discovery.inbox-all'].status).toBe('affected');
    expect(r.entityStates['sys.local-date'].status).toBe('modified');
  });

  it('does not flag dependencies of changed sources, and parents only summarize descendants', () => {
    const r = d();
    // Create and Edit (a changed source) does not impact its target; Local Date's own dependencies don't exist.
    expect(r.entityStates['sys.task-repository'].status).toBe('unchanged');
    expect(r.entityStates['cap.task-organization.custom-lists'].status).toBe('unchanged');
    expect(r.entityStates['sys.presentation-logic']).toMatchObject({ status: 'unchanged', changedDescendants: 2 });
    expect(r.entityStates['cap.task-discovery']).toMatchObject({ status: 'unchanged', changedDescendants: 2 });
  });

  it('treats a relationship removed in the target as a change of its source, with the base-only edge still visible', () => {
    // proposal adds "Today depends on Complete and Delete"; implementation removes that entity and edge.
    const r = diff('proposal', 'implementation');
    expect(r.base?.relationships.some((x) => x.id === 'rel.today-overdue.depends-on.complete-delete')).toBe(true);
    expect(r.target?.relationships.some((x) => x.id === 'rel.today-overdue.depends-on.complete-delete')).toBe(false);
    expect(r.directlyChangedEntityIds).toContain('cap.task-discovery.today-overdue');
    expect(r.potentiallyAffected.some((p) => p.entityId === 'cap.task-discovery.today-overdue')).toBe(false);
  });
});

describe('HEAD -> working tree', () => {
  it('shows exactly the uncommitted summary edit', () => {
    const r = diff('HEAD', 'WORKING');
    expect(r.changes).toHaveLength(1);
    expect(r.changes[0]).toMatchObject({ key: 'entity:cap.task-discovery', kind: 'modified' });
    expect(r.changes[0].fields.map((f) => f.field)).toEqual(['summary']);
    expect(r.changes[0].fields[0].after).toMatch(/\(wording under review\)$/);
    expect(r.directlyChangedEntityIds).toEqual(['cap.task-discovery']);
  });
});
