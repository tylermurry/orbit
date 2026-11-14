import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { diffContracts, parseContract, type Entity, type OrbitContract } from '@orbit/contract';

const root = resolve(fileURLToPath(import.meta.url), '..', '..');
const text = readFileSync(join(root, 'examples/tasky.orbit.json'), 'utf8');
const parsed = parseContract(text);
const contract = parsed.contract as OrbitContract;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
}

type Tree = [string, Tree[]];
const tree = (kind: Entity['kind'], parentId: string | null = null): Tree[] =>
  contract.entities
    .filter((e) => e.kind === kind && e.parentId === parentId)
    .map((e) => [e.name, tree(kind, e.id)] as Tree)
    .sort((a, b) => a[0].localeCompare(b[0]));

describe('examples/tasky.orbit.json', () => {
  it('validates with no errors or warnings', () => {
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.ok).toBe(true);
  });

  it('has the required capability and system hierarchies', () => {
    expect(tree('capability')).toEqual(
      [
        ['Task Discovery', [['Inbox and All Tasks', []], ['Today and Overdue', []]]],
        ['Task Management', [['Complete and Delete Tasks', []], ['Create and Edit Tasks', []]]],
        ['Task Organization', [['Custom Lists', []], ['Task Assignment', []]]],
      ].sort((a, b) => (a[0] as string).localeCompare(b[0] as string)),
    );
    expect(tree('system')).toEqual([
      ['Local Data', [['List Repository', []], ['Task Repository', []]]],
      ['Presentation Logic', [['Local Date Evaluation', []], ['Task Filtering and Sorting', []]]],
    ]);
  });

  it('keeps stable, dotted ids for the eight leaves', () => {
    const ids = contract.entities.map((e) => e.id);
    for (const id of [
      'cap.task-management', 'cap.task-management.create-edit', 'cap.task-management.complete-delete',
      'cap.task-organization', 'cap.task-organization.custom-lists', 'cap.task-organization.assignment',
      'cap.task-discovery', 'cap.task-discovery.inbox-all', 'cap.task-discovery.today-overdue',
      'sys.local-data', 'sys.task-repository', 'sys.list-repository',
      'sys.presentation-logic', 'sys.filtering-sorting', 'sys.local-date',
    ]) expect(ids).toContain(id);
  });

  it('has at least 18 behaviors, at least 12 mapped, and honest unmapped gaps', () => {
    const behaviors = contract.entities.flatMap((e) => e.behaviors);
    const mapped = behaviors.filter((b) => b.testIds.length > 0);
    expect(behaviors.length).toBeGreaterThanOrEqual(18);
    expect(mapped.length).toBeGreaterThanOrEqual(12);
    expect(behaviors.length - mapped.length).toBeGreaterThan(0);
    for (const b of behaviors) {
      expect(b.expected.length, b.id).toBeGreaterThan(40);
      expect(b.expected, b.id).not.toMatch(/\b(todo|tbd|placeholder|lorem)\b/i);
    }
    // every leaf entity of both kinds states its guarantees
    const leaves = contract.entities.filter((e) => !contract.entities.some((c) => c.parentId === e.id));
    expect(leaves).toHaveLength(10);
    for (const leaf of leaves) expect(leaf.behaviors.length, leaf.id).toBeGreaterThanOrEqual(2);
  });

  it('has defensible, described relationships of each allowed shape', () => {
    const byId = new Map(contract.entities.map((e) => [e.id, e]));
    expect(contract.relationships.length).toBeGreaterThanOrEqual(8);
    for (const r of contract.relationships) {
      expect(r.description?.length ?? 0, r.id).toBeGreaterThan(20);
      const [s, t] = [byId.get(r.sourceId)!, byId.get(r.targetId)!];
      if (r.type === 'implementedBy') expect([s.kind, t.kind], r.id).toEqual(['capability', 'system']);
      if (r.type === 'dependsOn') expect([s.kind, t.kind], r.id).toEqual(['capability', 'capability']);
    }
    const has = (type: string, source: string, target: string) =>
      contract.relationships.some((r) => r.type === type && r.sourceId === source && r.targetId === target);
    expect(has('dependsOn', 'cap.task-discovery.today-overdue', 'cap.task-management.create-edit')).toBe(true);
    expect(has('dependsOn', 'cap.task-organization.assignment', 'cap.task-organization.custom-lists')).toBe(true);
    expect(has('uses', 'cap.task-discovery.today-overdue', 'sys.local-date')).toBe(true);
    expect(has('uses', 'sys.filtering-sorting', 'sys.local-date')).toBe(true);
    expect(has('uses', 'cap.task-discovery.inbox-all', 'sys.filtering-sorting')).toBe(true);
    expect(has('implementedBy', 'cap.task-management.create-edit', 'sys.task-repository')).toBe(true);
  });

  it('references only real tests: each id appears literally in a Tasky test file under its stated location', () => {
    const files = walk(join(root, 'apps/tasky/tests')).filter((f) => f.endsWith('.ts'));
    const sources = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));
    expect(contract.tests.length).toBeGreaterThanOrEqual(14);
    for (const t of contract.tests) {
      expect([...sources.values()].some((src) => src.includes(`[${t.id}]`)), `${t.id} not found in any test file`).toBe(true);
      const [path, title] = t.location.split(' › ');
      expect(existsSync(join(root, path)), t.location).toBe(true);
      expect(readFileSync(join(root, path), 'utf8'), t.location).toContain(`${title} [${t.id}]`);
    }
    // and every test in the code that carries an id is modeled
    const idsInCode = new Set([...sources.values()].flatMap((src) => [...src.matchAll(/\[(test\.tasky\.[a-z0-9.-]+)\]/g)].map((m) => m[1])));
    expect([...idsInCode].sort()).toEqual(contract.tests.map((t) => t.id).sort());
    // every defined test is referenced by at least one behavior
    const referenced = new Set(contract.entities.flatMap((e) => e.behaviors.flatMap((b) => b.testIds)));
    for (const t of contract.tests) expect(referenced.has(t.id), `${t.id} is not mapped to a behavior`).toBe(true);
  });

  it('carries real evidence records only for defined tests', () => {
    const defined = new Set(contract.tests.map((t) => t.id));
    expect(contract.evidence.length).toBeGreaterThan(0);
    for (const e of contract.evidence) {
      expect(defined.has(e.testId), e.id).toBe(true);
      expect(e.id).toMatch(/^run\.[a-z0-9.-]+\.\d{8}T\d{6}Z/);
      if (e.commit === undefined) expect(e.details, e.id).toMatch(/commit unknown/);
    }
  });

  it('is the source of the demo base snapshot (semantically identical apart from evidence)', () => {
    const base = parseContract(readFileSync(join(root, 'examples/demo/01-base.orbit.json'), 'utf8')).contract as OrbitContract;
    const d = diffContracts({ ...contract, evidence: [] }, base);
    expect(d.changes).toEqual([]);
  });
});
