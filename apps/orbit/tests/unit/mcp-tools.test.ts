/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import Ajv from 'ajv';
import { parseContract } from '@orbit/contract';
import { createToolRuntime, UnknownToolError } from '../../src/mcp/tools';
import { runEdit } from '../../src/mcp/tools/edit';
import { OPS_BY_NAME } from '../../src/mcp/tools/ops';
import { canon, isDirty } from '../../src/state/store';
import { DEMO_IMPL, FILE, INVALID, SHA1, SHA2, TASKY, gitSeed, setup } from './util';

const NOW = new Date('2026-11-14T10:00:00.456Z');

async function boot(opts: { git?: boolean; text?: string; open?: boolean } = {}) {
  const { host, store, ctrl } = setup(opts.git ? { git: gitSeed() } : {}, opts.text ?? TASKY);
  if (opts.open !== false) {
    await ctrl.openPath(FILE);
    await ctrl.pollResults(true); // the app's background loop does this on open
  }
  const rt = createToolRuntime({ store, ctrl, host, now: () => NOW });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rt.callTool(name, args);
    return { r, d: r.structuredContent as any, err: !!r.isError };
  };
  const ok = async (name: string, args: Record<string, unknown> = {}) => {
    const x = await call(name, args);
    expect(x.err, JSON.stringify(x.d)).toBe(false);
    return x.d as any;
  };
  const fail = async (name: string, args: Record<string, unknown> = {}) => {
    const x = await call(name, args);
    expect(x.err, JSON.stringify(x.d)).toBe(true);
    return x.d as any;
  };
  const toasts = () => store.getState().toasts.map((t) => t.message);
  return { host, store, ctrl, rt, call, ok, fail, toasts, contract: () => store.getState().contract! };
}

/** Pretend a test run wrote results for these tests (matched by their [test.id] tag). */
function results(store: Awaited<ReturnType<typeof boot>>['store'], byId: Record<string, 'passed' | 'failed' | 'skipped'>, at = '2026-11-14T12:00:00.000Z') {
  const cases = Object.entries(byId).map(([id, status]) => ({ file: 'x.test.ts', name: `case [${id}]`, status }));
  store.dispatch({ type: 'setResultsFile', file: { path: '/work/repo/apps/tasky/test-results/junit.xml', state: 'ok', at, cases } });
}

const ENTITY = 'cap.task-organization.custom-lists';
const BEHAVIOR = 'behavior.today.due-today';

describe('tool registry', () => {
  it('lists tools with valid JSON Schemas, annotations and strict properties', async () => {
    const { rt } = await boot();
    const tools = rt.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(45);
    const ajv = new Ajv({ strict: true, allErrors: true });
    const names = new Set<string>();
    for (const t of tools) {
      expect(names.has(t.name), `duplicate ${t.name}`).toBe(false);
      names.add(t.name);
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.title.length).toBeGreaterThan(3);
      expect(t.description.length).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(() => ajv.compile(t.inputSchema), t.name).not.toThrow();
      expect(Object.keys(t.annotations).sort()).toEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint']);
      expect(t.annotations.openWorldHint).toBe(false);
      if (t.annotations.readOnlyHint) expect(t.annotations.destructiveHint).toBe(false);
    }
    for (const n of ['get_status', 'get_contract', 'list_entities', 'get_entity', 'search', 'get_assurance', 'list_tests', 'get_diagnostics', 'open_file', 'create_contract', 'save_file', 'save_file_as', 'reload_from_disk', 'review_external_changes', 'list_recent_files', 'update_product', 'create_entity', 'update_entity', 'delete_entity', 'create_behavior', 'update_behavior', 'delete_behavior', 'map_tests', 'unmap_tests', 'create_test', 'update_test', 'delete_test', 'set_validation', 'run_tests', 'create_relationship', 'update_relationship', 'delete_relationship', 'undo', 'redo', 'get_raw_json', 'set_raw_json', 'apply_edits', 'navigate', 'list_git_refs', 'compare', 'get_change', 'get_impact', 'clear_comparison']) {
      expect(names.has(n), n).toBe(true);
    }
  });

  it('throws UnknownToolError (-32602) for an unknown tool and reports schema-invalid args as tool errors', async () => {
    const { rt, fail, contract } = await boot();
    await expect(rt.callTool('nope', {})).rejects.toBeInstanceOf(UnknownToolError);
    await expect(rt.callTool('nope', {})).rejects.toMatchObject({ code: -32602 });
    const before = contract();
    const d1 = await fail('create_entity', { kind: 'capability', summary: 's' });
    expect(d1.error).toMatch(/arguments\.name: required/);
    const d2 = await fail('create_entity', { kind: 'widget', name: 'x', summary: 's' });
    expect(d2.error).toMatch(/arguments\.kind: must be one of/);
    const d3 = await fail('get_entity', { id: 'x', extra: 1 });
    expect(d3.error).toMatch(/unknown property/);
    const d4 = await fail('create_entity', { kind: 'capability', name: '   ', summary: 's' });
    expect(d4.error).toMatch(/blank/);
    expect(contract()).toBe(before);
  });

  it('serializes concurrent calls so edits never interleave', async () => {
    const { rt, store } = await boot();
    const names = ['A', 'B', 'C', 'D'];
    await Promise.all(names.map((n) => rt.callTool('create_entity', { kind: 'system', name: `Sys ${n}`, summary: 's' })));
    expect(store.getState().contract!.entities.filter((e) => e.name.startsWith('Sys ')).map((e) => e.name)).toEqual(names.map((n) => `Sys ${n}`));
    expect(store.getState().undo).toHaveLength(4);
  });
});

describe('reading', () => {
  it('get_status summarizes the app', async () => {
    const { ok } = await boot({ git: true });
    const d = await ok('get_status');
    expect(d.file.name).toBe('tasky.orbit.json');
    expect(d.product.id).toBe('tasky');
    expect(d).toMatchObject({ dirty: false, valid: true, loadedInvalid: false, readOnly: false, view: 'product' });
    expect(d.history).toMatchObject({ canUndo: false, canRedo: false });
    expect(d.git).toMatchObject({ available: true, branch: 'main', headCommit: SHA1 });
    expect(d.refsCount).toBeGreaterThan(0);
    expect(d.comparison).toBeNull();
    expect(d.testResults).toMatchObject({ configured: true, command: 'npm run validate -w @orbit/tasky', state: 'missing', lastRunAt: null, running: false });
    expect(d.counts).toMatchObject({ capabilities: 9, systems: 6, tests: 44, placeholderTests: 0 });
    expect(d.externalChange).toBeNull();
  });

  it('get_status without a file and with no git', async () => {
    const a = await boot({ open: false });
    expect((await a.ok('get_status')).file).toBeNull();
    const d = await a.fail('get_contract');
    expect(d.error).toMatch(/No contract file is open/);
    const b = await boot();
    expect((await b.ok('get_status')).git).toMatchObject({ available: false });
  });

  it('get_contract returns canonical working and disk versions', async () => {
    const { ok } = await boot();
    await ok('update_product', { name: 'Renamed' });
    const w = await ok('get_contract');
    expect(w.contract.product.name).toBe('Renamed');
    expect(w.dirty).toBe(true);
    const disk = await ok('get_contract', { source: 'disk' });
    expect(disk.contract.product.name).toBe('Tasky');
  });

  it('list_entities returns tree order with depth, counts and filters', async () => {
    const { ok, fail } = await boot();
    const d = await ok('list_entities');
    expect(d.total).toBe(15);
    expect(d.entities[0]).toMatchObject({ kind: 'capability', depth: 0, parentId: null });
    const idx = (id: string) => d.entities.findIndex((e: any) => e.id === id);
    expect(idx('cap.task-management')).toBeLessThan(idx('cap.task-management.create-edit'));
    expect(d.entities[idx('cap.task-management.create-edit')].depth).toBe(1);
    expect(idx('sys.local-data')).toBeGreaterThan(idx('cap.task-discovery.today-overdue'));
    const row = d.entities[idx('cap.task-discovery.today-overdue')];
    expect(row.behaviorCount).toBe(4);
    expect(row.assurance).toMatchObject({ total: 4, withTests: 3, untested: 1 });
    expect((await ok('list_entities', { kind: 'system' })).entities.every((e: any) => e.kind === 'system')).toBe(true);
    const sub = await ok('list_entities', { parentId: 'cap.task-discovery' });
    expect(sub.entities.map((e: any) => e.id).sort()).toEqual(['cap.task-discovery.inbox-all', 'cap.task-discovery.today-overdue']);
    expect((await ok('list_entities', { query: 'overdue' })).entities.map((e: any) => e.id)).toContain('cap.task-discovery.today-overdue');
    expect((await ok('list_entities', { limit: 2 })).entities).toHaveLength(2);
    expect((await fail('list_entities', { parentId: 'cap.task-managment' })).suggestions).toContain('cap.task-management');
  });

  it('get_entity gives behaviors with per-test assurance, relationships and ancestors', async () => {
    const { ok, fail } = await boot();
    const d = await ok('get_entity', { id: 'cap.task-discovery.today-overdue' });
    expect(d.ancestors.map((a: any) => a.id)).toEqual(['cap.task-discovery']);
    expect(d.entity.name).toBe('Today and Overdue');
    const b = d.behaviors.find((x: any) => x.id === BEHAVIOR);
    expect(b.status).toBe('unconfirmed'); // no test results yet
    expect(b.tests[0]).toMatchObject({ id: 'test.tasky.views.today-overdue', defined: true, status: 'unconfirmed' });
    expect(b.tests[0].lastResult).toBeUndefined();
    expect(d.subtreeAssurance.behaviorIds.all).toHaveLength(4);
    expect(d.relationships.outgoing.map((r: any) => r.type).sort()).toEqual(['dependsOn', 'implementedBy', 'uses']);
    expect(d.relationships.outgoing[0].other.name).toBeTruthy();
    const parent = await ok('get_entity', { id: 'cap.task-discovery' });
    expect(parent.children).toHaveLength(2);
    expect(parent.subtreeAssurance.total).toBe(8);
    const miss = await fail('get_entity', { id: 'cap.task-organization.custom-list' });
    expect(miss.error).toContain('Did you mean');
    expect(miss.suggestions).toContain(ENTITY);
    expect(miss.closestMatches.length).toBeLessThanOrEqual(5);
    const byName = await fail('get_entity', { id: 'Today and Overdue' });
    expect(byName.suggestions).toContain('cap.task-discovery.today-overdue');
  });

  it('search finds entities, behaviors and tests', async () => {
    const { ok } = await boot();
    const d = await ok('search', { query: 'overdue' });
    expect(d.entities.map((e: any) => e.id)).toContain('cap.task-discovery.today-overdue');
    expect(d.behaviors.map((b: any) => b.id)).toContain('behavior.today.overdue-labeled');
    expect(d.tests.length).toBeGreaterThan(0);
    expect((await ok('search', { query: 'zzzzzz' })).totals).toEqual({ entities: 0, behaviors: 0, tests: 0 });
  });

  it('get_assurance for an entity and for the product, from the latest test results', async () => {
    const { ok, store } = await boot({ git: true });
    const p0 = await ok('get_assurance');
    expect(p0.scope).toBe('product');
    expect(p0.passing).toBe(0);
    expect(p0.testResults.state).toBe('missing');
    results(store, { 'test.tasky.views.today-overdue': 'passed' });
    const p = await ok('get_assurance');
    expect(p.passing).toBeGreaterThan(0);
    expect(p.passing + p.failing + p.unconfirmed).toBe(p.withTests);
    expect(p.total).toBe(p.behaviors.length);
    expect(p.topLevel.length).toBeGreaterThan(0);
    const e = await ok('get_assurance', { entityId: 'cap.task-discovery.today-overdue' });
    expect(e).toMatchObject({ scope: 'cap.task-discovery.today-overdue', total: 4, untested: 1 });
  });

  it('list_tests reports status from the results file and filters by it', async () => {
    const { ok, store } = await boot();
    const t = await ok('list_tests');
    expect(t.total).toBe(44);
    const row = t.tests.find((x: any) => x.id === 'test.tasky.views.today-overdue');
    expect(row.mappedBehaviors.map((b: any) => b.behaviorId)).toContain(BEHAVIOR);
    expect(row.status).toBe('unconfirmed');
    const un = await ok('list_tests', { unmapped: true });
    expect(un.tests.every((x: any) => x.mappedBehaviors.length === 0)).toBe(true);
    expect((await ok('list_tests', { query: 'rollover' })).tests.length).toBeGreaterThan(0);
    results(store, { 'test.tasky.views.today-overdue': 'passed', 'test.tasky.local-date.rollover': 'failed' });
    const failing = await ok('list_tests', { status: 'failing' });
    expect(failing.tests.map((x: any) => x.id)).toEqual(['test.tasky.local-date.rollover']);
    expect(failing.tests[0].lastResult).toMatchObject({ status: 'failed' });
    expect((await ok('list_tests', { status: 'passing' })).total).toBe(1);
  });

  it('get_diagnostics reports the text the user sees', async () => {
    const { ok, store, fail } = await boot();
    expect(await ok('get_diagnostics')).toMatchObject({ source: 'working', errors: 0 });
    store.dispatch({ type: 'setRawDraft', text: '{ "schemaVersion": 1, ' });
    const d = await ok('get_diagnostics');
    expect(d.source).toBe('raw-draft');
    expect(d.errors).toBeGreaterThan(0);
    expect(d.diagnostics[0]).toMatchObject({ severity: 'error', code: 'json.syntax' });
    const status = await ok('get_status');
    expect(status.raw.hasUnappliedDraft).toBe(true);
    const e = await fail('create_entity', { kind: 'capability', name: 'x', summary: 'y' });
    expect(e.error).toMatch(/unapplied edits/);
  });
});

describe('editing entities', () => {
  it('create_entity auto-generates ids, toasts, expands the parent and is undoable', async () => {
    const { ok, store, toasts, contract } = await boot();
    const d = await ok('create_entity', { kind: 'capability', name: 'Reminders', summary: 'Nudges', parentId: 'cap.task-management' });
    expect(d.entity.id).toBe('cap.reminders');
    expect(d.state).toMatchObject({ dirty: true, canUndo: true });
    expect(contract().entities.at(-1)).toMatchObject({ id: 'cap.reminders', parentId: 'cap.task-management', description: '', behaviors: [] });
    expect(store.getState().expanded['cap.task-management']).toBe(true);
    expect(toasts()).toContain("AI · Created capability 'Reminders'");
    const again = await ok('create_entity', { kind: 'capability', name: 'Reminders', summary: 'Nudges' });
    expect(again.entity.id).toBe('cap.reminders-2');
    const sys = await ok('create_entity', { kind: 'system', name: 'Notifier', summary: 's', id: 'sys.notifier', description: 'desc' });
    expect(sys.entity.id).toBe('sys.notifier');
    await ok('undo');
    expect(contract().entities.some((e) => e.id === 'sys.notifier')).toBe(false);
  });

  it('rejects duplicate ids, cross-kind parents and unknown parents', async () => {
    const { fail, contract } = await boot();
    const before = contract();
    expect((await fail('create_entity', { kind: 'capability', name: 'X', summary: 's', id: 'cap.task-management' })).error).toMatch(/already exists/);
    const cross = await fail('create_entity', { kind: 'capability', name: 'X', summary: 's', parentId: 'sys.local-data' });
    expect(cross.error).toMatch(/is a system; a capability can only be nested under a capability/);
    const unk = await fail('create_entity', { kind: 'capability', name: 'X', summary: 's', parentId: 'cap.task-managment' });
    expect(unk.suggestions).toContain('cap.task-management');
    expect(contract()).toBe(before);
  });

  it('update_entity edits fields, reparents with kind and cycle checks', async () => {
    const { ok, fail, contract } = await boot();
    const d = await ok('update_entity', { id: ENTITY, name: 'Lists', description: 'More' });
    expect(d.entity.name).toBe('Lists');
    expect(contract().entities.find((e) => e.id === ENTITY)).toMatchObject({ name: 'Lists', description: 'More' });
    await ok('update_entity', { id: ENTITY, parentId: null });
    expect(contract().entities.find((e) => e.id === ENTITY)!.parentId).toBeNull();
    expect((await fail('update_entity', { id: ENTITY, parentId: 'sys.local-data' })).error).toMatch(/can only be nested under a capability/);
    const cyc = await fail('update_entity', { id: 'cap.task-management', parentId: 'cap.task-management.create-edit' });
    expect(cyc.error).toMatch(/cycle/);
    expect((await fail('update_entity', { id: 'cap.task-management', parentId: 'cap.task-management' })).error).toMatch(/cycle/);
    expect((await fail('update_entity', { id: ENTITY })).error).toMatch(/Nothing to update/);
    const idChange = await fail('update_entity', { id: ENTITY, newId: 'x' });
    expect(idChange.error).toMatch(/unknown property/);
  });

  it('a no-op update changes nothing and shows no toast', async () => {
    const { ok, toasts, store } = await boot();
    const d = await ok('update_entity', { id: ENTITY, name: 'Custom Lists' });
    expect(d.changed).toBe(false);
    expect(store.getState().undo).toHaveLength(0);
    expect(toasts()).toHaveLength(0);
  });

  it('delete_entity reports implications, reparents children or blocks, and can dry-run', async () => {
    const { ok, fail, contract } = await boot();
    const dry = await ok('delete_entity', { id: 'cap.task-management', dryRun: true });
    expect(dry.dryRun).toBe(true);
    expect(contract().entities.some((e) => e.id === 'cap.task-management')).toBe(true);
    const blocked = await fail('delete_entity', { id: 'cap.task-management', children: 'block' });
    expect(blocked.error).toMatch(/still has 2 child/);
    const d = await ok('delete_entity', { id: 'cap.task-organization.assignment' });
    expect(d.implications.some((s: string) => s.startsWith('Owns 2 behaviors'))).toBe(true);
    expect(d.removedRelationships.length).toBeGreaterThan(0);
    expect(contract().relationships.some((r) => r.sourceId === 'cap.task-organization.assignment' || r.targetId === 'cap.task-organization.assignment')).toBe(false);
    const top = await ok('delete_entity', { id: 'sys.local-data' });
    expect(top.reparentedChildren).toHaveLength(2);
    expect(contract().entities.filter((e) => e.id.startsWith('sys.') && e.parentId === null).map((e) => e.id)).toEqual(expect.arrayContaining(['sys.task-repository', 'sys.list-repository']));
    expect((await fail('delete_entity', { id: 'sys.task-repositry' })).suggestions).toContain('sys.task-repository');
  });

  it('update_product edits and removes the description', async () => {
    const { ok, contract, fail } = await boot();
    await ok('update_product', { name: 'Tasky 2', description: null });
    expect(contract().product.name).toBe('Tasky 2');
    expect(contract().product.description).toBeUndefined();
    expect((await fail('update_product', {})).error).toMatch(/Nothing to update/);
  });
});

describe('editing behaviors and tests', () => {
  it('create/update/delete behavior including ownership moves and dangling tests', async () => {
    const { ok, fail, contract, toasts } = await boot();
    const c = await ok('create_behavior', { entityId: 'cap.task-discovery.today-overdue', name: 'Overdue items remain visible', expected: 'Overdue tasks stay in Today until done.', testIds: ['test.tasky.views.today-overdue'] });
    expect(c.behavior.id).toBe('behavior.task-discovery.today-overdue.overdue-items-remain-visible');
    expect(toasts()).toContain("AI · Created behavior 'Overdue items remain visible'");
    const dangling = await fail('create_behavior', { entityId: ENTITY, name: 'X', expected: 'y', testIds: ['test.tasky.views.today-overdu'] });
    expect(dangling.error).toMatch(/Unknown test id/);
    expect(dangling.suggestions).toContain('test.tasky.views.today-overdue');
    expect((await fail('create_behavior', { entityId: ENTITY, name: 'X', expected: 'y', id: BEHAVIOR })).error).toMatch(/already exists/);
    expect((await fail('create_behavior', { entityId: 'nope', name: 'X', expected: 'y' })).error).toMatch(/not found/);
    await ok('update_behavior', { id: c.behavior.id, expected: 'Changed', name: 'Renamed' });
    expect(contract().entities.flatMap((e) => e.behaviors).find((b) => b.id === c.behavior.id)).toMatchObject({ name: 'Renamed', expected: 'Changed' });
    const moved = await ok('update_behavior', { id: c.behavior.id, entityId: ENTITY });
    expect(moved.behavior.entityId).toBe(ENTITY);
    expect(contract().entities.find((e) => e.id === ENTITY)!.behaviors.some((b) => b.id === c.behavior.id)).toBe(true);
    expect(contract().entities.find((e) => e.id === 'cap.task-discovery.today-overdue')!.behaviors.some((b) => b.id === c.behavior.id)).toBe(false);
    expect((await fail('update_behavior', { id: c.behavior.id, testIds: ['nope'] })).error).toMatch(/Unknown test id/);
    expect((await fail('update_behavior', { id: c.behavior.id, entityId: 'nope' })).error).toMatch(/not found/);
    const del = await ok('delete_behavior', { id: c.behavior.id });
    expect(del.deleted.id).toBe(c.behavior.id);
    expect((await fail('delete_behavior', { id: c.behavior.id })).error).toMatch(/not found/);
  });

  it('map_tests and unmap_tests are validated and idempotent', async () => {
    const { ok, fail, contract } = await boot();
    const tid = 'test.tasky.views.today-rollover';
    const d = await ok('map_tests', { behaviorId: 'behavior.today.timezone-change', testIds: [tid, tid] });
    expect(d.testIds).toEqual([tid]);
    const again = await ok('map_tests', { behaviorId: 'behavior.today.timezone-change', testIds: [tid] });
    expect(again.changed).toBe(false);
    expect(again.warnings[0]).toMatch(/Already mapped/);
    expect((await fail('map_tests', { behaviorId: 'behavior.today.timezone-change', testIds: ['zzz'] })).error).toMatch(/Unknown test/);
    const u = await ok('unmap_tests', { behaviorId: 'behavior.today.timezone-change', testIds: [tid, 'whatever'] });
    expect(u.removed).toEqual([tid]);
    expect(u.warnings[0]).toMatch(/Not mapped/);
    expect(contract().entities.flatMap((e) => e.behaviors).find((b) => b.id === 'behavior.today.timezone-change')!.testIds).toEqual([]);
  });

  it('create/update/delete test; delete unmaps and reports implications', async () => {
    const { ok, fail, contract } = await boot();
    const t = await ok('create_test', { name: 'Lists e2e', location: 'tests/lists.spec.ts' });
    expect(t.test.id).toBe('test.lists-e2e');
    await ok('update_test', { id: t.test.id, location: 'tests/other.spec.ts' });
    expect(contract().tests.find((x) => x.id === t.test.id)!.location).toBe('tests/other.spec.ts');
    expect((await fail('create_test', { name: 'x', location: 'y', id: t.test.id })).error).toMatch(/already exists/);
    const id = 'test.tasky.views.today-overdue';
    const dry = await ok('delete_test', { id, dryRun: true });
    expect(dry.implications.length).toBeGreaterThan(0);
    const del = await ok('delete_test', { id });
    expect(del.implications.length).toBeGreaterThan(0);
    expect(contract().tests.some((x) => x.id === id)).toBe(false);
    expect(contract().entities.flatMap((e) => e.behaviors).some((b) => b.testIds.includes(id))).toBe(false);
    expect((await fail('update_test', { id: 'nope', name: 'x' })).error).toMatch(/not found/);
  });
});

describe('editing the test setup and relationships', () => {
  it('set_validation sets, updates and removes how the suite runs', async () => {
    const { ok, fail, contract } = await boot({ text: TASKY.replace(/,\n {2}"validation": \{[^}]*\}/, '') });
    expect(contract().validation).toBeUndefined();
    expect((await fail('set_validation', { results: 'r.xml' })).error).toMatch(/command and a results file/);
    await ok('set_validation', { command: 'npm test', results: 'test-results/junit.xml' });
    expect(contract().validation).toEqual({ command: 'npm test', results: 'test-results/junit.xml' });
    await ok('set_validation', { results: 'out/junit.xml' });
    expect(contract().validation).toEqual({ command: 'npm test', results: 'out/junit.xml' });
    await ok('set_validation', { command: null });
    expect(contract().validation).toBeUndefined();
    expect((await fail('set_validation', { command: null })).error).toMatch(/No validation setup/);
  });

  it('relationships: create, refuse self-edges, no-op on duplicates, update and delete', async () => {
    const { ok, fail, contract } = await boot();
    const r = await ok('create_relationship', { type: 'uses', sourceId: 'cap.task-management', targetId: 'sys.local-date', description: 'Dates' });
    expect(r.created).toBe(true);
    expect(r.relationship.id).toBe('rel.task-management-uses-local-date-evaluation');
    const self = await fail('create_relationship', { type: 'uses', sourceId: 'sys.local-date', targetId: 'sys.local-date' });
    expect(self.error).toMatch(/itself/);
    const dup = await ok('create_relationship', { type: 'uses', sourceId: 'cap.task-management', targetId: 'sys.local-date' });
    expect(dup.created).toBe(false);
    expect(dup.changed).toBe(false);
    expect(dup.warnings[0]).toMatch(/Duplicate/);
    expect((await fail('create_relationship', { type: 'uses', sourceId: 'cap.task-managment', targetId: 'sys.local-date' })).suggestions).toContain('cap.task-management');
    const u = await ok('update_relationship', { id: r.relationship.id, type: 'dependsOn', description: null });
    expect(u.relationship).toMatchObject({ type: 'dependsOn' });
    expect(u.relationship.description).toBeUndefined();
    expect((await fail('update_relationship', { id: r.relationship.id, targetId: r.relationship.sourceId })).error).toMatch(/itself/);
    await ok('create_relationship', { type: 'dependsOn', sourceId: 'cap.task-discovery.today-overdue', targetId: 'sys.local-date', id: 'rel.x' });
    expect((await fail('update_relationship', { id: 'rel.x', type: 'uses' })).error).toMatch(/duplicate/);
    await ok('delete_relationship', { id: r.relationship.id });
    expect(contract().relationships.some((x) => x.id === r.relationship.id)).toBe(false);
    expect((await fail('delete_relationship', { id: 'rel.nope' })).error).toMatch(/not found/);
  });
});

describe('batching, undo and rejection', () => {
  it('apply_edits is atomic and a single undo step', async () => {
    const { ok, fail, store, contract, toasts } = await boot();
    const base = canon(contract());
    const d = await ok('apply_edits', {
      operations: [
        { tool: 'create_entity', args: { kind: 'capability', name: 'Sharing', summary: 'Share lists', id: 'cap.sharing' } },
        { tool: 'create_test', args: { name: 'Sharing e2e', location: 'tests/share.spec.ts', id: 'test.sharing' } },
        { tool: 'create_behavior', args: { entityId: 'cap.sharing', name: 'Invite works', expected: 'Invites are sent', testIds: ['test.sharing'], id: 'behavior.sharing.invite' } },
        { tool: 'create_relationship', args: { type: 'dependsOn', sourceId: 'cap.sharing', targetId: ENTITY } },
      ],
    });
    expect(d.results).toHaveLength(4);
    expect(store.getState().undo).toHaveLength(1);
    expect(toasts().some((t) => t.startsWith('AI · Applied 4 edits'))).toBe(true);
    expect(contract().entities.find((e) => e.id === 'cap.sharing')!.behaviors[0].testIds).toEqual(['test.sharing']);
    await ok('undo');
    expect(canon(contract())).toBe(base);
    await ok('redo');
    expect(contract().entities.some((e) => e.id === 'cap.sharing')).toBe(true);
    await ok('undo');

    const depth = store.getState().undo.length;
    const bad = await fail('apply_edits', {
      operations: [
        { tool: 'create_entity', args: { kind: 'capability', name: 'Good', summary: 's', id: 'cap.good' } },
        { tool: 'create_behavior', args: { entityId: 'cap.good', name: 'B', expected: 'e', testIds: ['test.missing'] } },
      ],
    });
    expect(bad.error).toMatch(/Operation 2 of 2 \(create_behavior\) failed, so NOTHING was applied/);
    expect(bad.failedOperationIndex).toBe(1);
    expect(store.getState().undo).toHaveLength(depth);
    expect(canon(contract())).toBe(base);

    const badArgs = await fail('apply_edits', { operations: [{ tool: 'create_test', args: { name: 'x' } }] });
    expect(badArgs.error).toMatch(/operations\[0\]\.args\.location: required/);
    const dry = await ok('apply_edits', { dryRun: true, operations: [{ tool: 'update_product', args: { name: 'Dry' } }] });
    expect(dry).toMatchObject({ dryRun: true, wouldChange: true });
    expect(contract().product.name).toBe('Tasky');
    expect((await fail('apply_edits', { operations: [{ tool: 'save_file', args: {} }] })).error).toMatch(/must be one of/);
  });

  it('undo/redo report when there is nothing to do and what changed otherwise', async () => {
    const { ok, fail } = await boot();
    expect((await fail('undo')).error).toMatch(/Nothing to undo/);
    expect((await fail('redo')).error).toMatch(/Nothing to redo/);
    await ok('update_product', { name: 'A' });
    const u = await ok('undo');
    expect(u.summary).toMatch(/Undid last edit \(1 change\)/);
    expect(u.state).toMatchObject({ canRedo: true, dirty: false });
    expect((await ok('redo')).state.dirty).toBe(true);
  });

  it('rejects an edit that would add semantic errors and returns the would-be diagnostics', async () => {
    const { store, ctrl, host, contract } = await boot();
    OPS_BY_NAME.set('__bad', {
      name: '__bad',
      title: 'bad',
      description: 'bad',
      schema: { type: 'object' },
      destructive: false,
      idempotent: false,
      run: (c) => ({ contract: { ...c, entities: [...c.entities, { ...c.entities[0] }] }, summary: 'Duplicated an entity' }),
    });
    try {
      const before = contract();
      let err: any;
      try {
        runEdit({ store, ctrl, host, now: () => NOW }, [{ op: '__bad', args: {} }]);
      } catch (e) {
        err = e;
      }
      expect(err.message).toMatch(/Edit rejected: it would introduce \d+ validation error/);
      expect(err.data.wouldBeDiagnostics[0].code).toBe('id.duplicate');
      expect(contract()).toBe(before);
    } finally {
      OPS_BY_NAME.delete('__bad');
    }
  });
});

describe('raw JSON', () => {
  it('get_raw_json, validate-only, malformed rejection and apply', async () => {
    const { ok, fail, contract, store } = await boot();
    const raw = await ok('get_raw_json');
    expect(raw).toMatchObject({ source: 'working', hasUnappliedDraft: false, errors: 0 });
    const edited = JSON.parse(raw.text);
    edited.product.name = 'Via raw';
    const text = JSON.stringify(edited, null, 2);
    const v = await ok('set_raw_json', { text, apply: false });
    expect(v).toMatchObject({ applied: false, valid: true });
    expect(contract().product.name).toBe('Tasky');
    const before = contract();
    const bad = await fail('set_raw_json', { text: '{ "schemaVersion": 1, ', apply: true });
    expect(bad.valid).toBe(false);
    expect(bad.diagnostics[0].code).toBe('json.syntax');
    expect(contract()).toBe(before);
    const schemaBad = await fail('set_raw_json', { text: JSON.stringify({ ...edited, entities: 'x' }), apply: true });
    expect(schemaBad.diagnostics.length).toBeGreaterThan(0);
    const applied = await ok('set_raw_json', { text, apply: true });
    expect(applied).toMatchObject({ applied: true, changed: true });
    expect(contract().product.name).toBe('Via raw');
    expect(store.getState().undo).toHaveLength(1);
    await ok('undo');
    expect(contract().product.name).toBe('Tasky');
    const same = await ok('set_raw_json', { text: raw.text, apply: true });
    expect(same.changed).toBe(false);
  });

  it('repairs a read-only invalid file through set_raw_json and refuses structured edits meanwhile', async () => {
    const { ok, fail, store } = await boot({ text: INVALID });
    expect(store.getState().loadedInvalid).toBe(true);
    const status = await ok('get_status');
    expect(status).toMatchObject({ loadedInvalid: true, readOnly: true, valid: false });
    for (const [name, args] of [
      ['create_entity', { kind: 'capability', name: 'x', summary: 'y' }],
      ['update_product', { name: 'x' }],
      ['apply_edits', { operations: [{ tool: 'update_product', args: { name: 'x' } }] }],
      ['undo', {}],
    ] as const) {
      const d = await fail(name, args as Record<string, unknown>);
      expect(d.error, name).toMatch(/read-only/);
    }
    const diag = await ok('get_diagnostics');
    expect(diag.source).toBe('disk');
    expect(diag.errors).toBeGreaterThan(0);
    const d = await ok('set_raw_json', { text: TASKY, apply: true });
    expect(d.applied).toBe(true);
    expect(store.getState().loadedInvalid).toBe(false);
    await ok('update_product', { name: 'Fixed' });
    expect(store.getState().contract!.product.name).toBe('Fixed');
  });
});

describe('files', () => {
  it('save_file writes canonical text and then reports nothing to save', async () => {
    const { ok, host, store, toasts } = await boot();
    expect((await ok('save_file')).saved).toBe(false);
    await ok('update_product', { name: 'Saved name' });
    const d = await ok('save_file');
    expect(d).toMatchObject({ saved: true, path: FILE });
    expect(parseContract(host.getFile(FILE)!).contract!.product.name).toBe('Saved name');
    expect(isDirty(store.getState())).toBe(false);
    expect(toasts()).toContain('AI · Saved tasky.orbit.json');
    expect((await ok('save_file')).saved).toBe(false);
  });

  it('save_file never overwrites external changes and points at the resolutions', async () => {
    const { ok, fail, host, store } = await boot();
    await ok('update_product', { name: 'Mine' });
    await host.externalWrite(FILE, TASKY.replace('"Tasky"', '"Theirs"'));
    const d = await fail('save_file');
    expect(d.reason).toBe('conflict');
    expect(d.suggestions.join(' ')).toMatch(/review_external_changes/);
    expect(d.suggestions.join(' ')).toMatch(/reload_from_disk/);
    expect(d.suggestions.join(' ')).toMatch(/save_file_as/);
    expect(host.getFile(FILE)).toContain('Theirs');
    expect(host.writes).toHaveLength(0);
    expect(store.getState().externalChange?.kind).toBe('modified');
    const review = await ok('review_external_changes');
    expect(review.externalChange).toBe('modified');
    expect(review.identical).toBe(false);
    expect(review.changes.some((c: any) => c.category === 'product' && c.fields.some((f: any) => f.field === 'name' && f.before === 'Theirs' && f.after === 'Mine'))).toBe(true);
    await ok('review_external_changes', { showInApp: true });
    expect(store.getState().review?.title).toMatch(/Disk version/);
    const as = await ok('save_file_as', { path: '/work/repo/mine.orbit.json' });
    expect(as.saved).toBe(true);
    expect(parseContract(host.getFile('/work/repo/mine.orbit.json')!).contract!.product.name).toBe('Mine');
    expect(store.getState().filePath).toBe('/work/repo/mine.orbit.json');
  });

  it('save_file refuses on validation errors unless saveDespiteErrors, writing the exact text', async () => {
    const { ok, fail, host, store } = await boot();
    store.dispatch({ type: 'setRawDraft', text: '{ "broken": ' });
    const d = await fail('save_file');
    expect(d.reason).toBe('validation');
    expect(d.diagnostics.length).toBeGreaterThan(0);
    expect(host.writes).toHaveLength(0);
    const forced = await ok('save_file', { saveDespiteErrors: true });
    expect(forced.saved).toBe(true);
    expect(host.getFile(FILE)).toBe('{ "broken": ');
    expect(store.getState().loadedInvalid).toBe(true);
  });

  it('save_file refuses to apply a valid unapplied raw draft implicitly', async () => {
    const { fail, store } = await boot();
    store.dispatch({ type: 'setRawDraft', text: TASKY.replace('"Tasky"', '"Drafted"') });
    const d = await fail('save_file');
    expect(d.reason).toBe('raw-draft');
  });

  it('save_file_as refuses to overwrite unless asked', async () => {
    const { ok, fail, host } = await boot();
    await host.externalWrite('/work/repo/other.orbit.json', '{}');
    const d = await fail('save_file_as', { path: '/work/repo/other.orbit.json' });
    expect(d.reason).toBe('exists');
    await ok('save_file_as', { path: '/work/repo/other.orbit.json', overwrite: true });
    expect(parseContract(host.getFile('/work/repo/other.orbit.json')!).ok).toBe(true);
  });

  it('reload_from_disk requires discardUnsavedChanges when dirty', async () => {
    const { ok, fail, contract, host, store } = await boot();
    await ok('update_product', { name: 'Unsaved' });
    const d = await fail('reload_from_disk');
    expect(d.dirty).toBe(true);
    expect(contract().product.name).toBe('Unsaved');
    const r = await ok('reload_from_disk', { discardUnsavedChanges: true });
    expect(r.reloaded).toBe(true);
    expect(contract().product.name).toBe('Tasky');
    expect(store.getState().undo).toHaveLength(0);
    await host.externalWrite(FILE, TASKY.replace('"Tasky"', '"Disk"'));
    const clean = await ok('reload_from_disk');
    expect(clean.reloaded).toBe(true);
    expect(contract().product.name).toBe('Disk');
  });

  it('open_file, create_contract and list_recent_files, with the discard guard', async () => {
    const { ok, fail, host, store, contract } = await boot();
    await host.externalWrite('/work/repo/b.orbit.json', TASKY.replace('"Tasky"', '"B"'));
    await ok('update_product', { name: 'Dirty' });
    const g = await fail('open_file', { path: '/work/repo/b.orbit.json' });
    expect(g.dirty).toBe(true);
    expect((await fail('open_file', { path: '/work/repo/missing.orbit.json', discardUnsavedChanges: true })).error).toMatch(/not found/i);
    const o = await ok('open_file', { path: '/work/repo/b.orbit.json', discardUnsavedChanges: true });
    expect(o).toMatchObject({ opened: true, path: '/work/repo/b.orbit.json', errors: 0 });
    expect(contract().product.name).toBe('B');
    const created = await ok('create_contract', { path: '/work/repo/new.orbit.json', product: { name: 'Brand New', summary: 'Fresh' } });
    expect(created.product).toEqual({ id: 'brand-new', name: 'Brand New' });
    expect(parseContract(host.getFile('/work/repo/new.orbit.json')!).ok).toBe(true);
    expect((await fail('create_contract', { path: '/work/repo/new.orbit.json', product: { name: 'X', summary: 'Y' } })).error).toMatch(/already exists/);
    expect((await ok('list_recent_files')).current).toBe('/work/repo/new.orbit.json');
    expect(store.getState().filePath).toBe('/work/repo/new.orbit.json');
  });

  it('open_file reports an invalid file as read-only with diagnostics', async () => {
    const { ok, host } = await boot();
    await host.externalWrite('/work/repo/bad.orbit.json', INVALID);
    const d = await ok('open_file', { path: '/work/repo/bad.orbit.json' });
    expect(d).toMatchObject({ loadedInvalid: true, readOnly: true });
    expect(d.diagnostics.length).toBeGreaterThan(0);
  });
});

describe('navigation and comparison', () => {
  it('navigate selects entities (expanding ancestors), switches views and opens panels', async () => {
    const { ok, fail, store } = await boot();
    const d = await ok('navigate', { entityId: 'cap.task-discovery.today-overdue', behaviorId: BEHAVIOR });
    expect(d.view).toBe('product');
    expect(store.getState().selected.capability).toBe('cap.task-discovery.today-overdue');
    expect(store.getState().focusBehaviorId).toBe(BEHAVIOR);
    expect(store.getState().expanded['cap.task-discovery']).toBe(true);
    await ok('navigate', { entityId: 'sys.local-date' });
    expect(store.getState().view).toBe('engineering');
    expect(store.getState().expanded['sys.presentation-logic']).toBe(true);
    await ok('navigate', { behaviorId: 'behavior.today.rollover' });
    expect(store.getState().selected.capability).toBe('cap.task-discovery.today-overdue');
    expect((await fail('navigate', { entityId: 'sys.local-date', view: 'product' })).error).toMatch(/engineering view/);
    expect((await fail('navigate', { entityId: 'cap.task-management', behaviorId: BEHAVIOR })).error).toMatch(/belongs to/);
    expect((await fail('navigate', { entityId: 'cap.zzz' })).error).toMatch(/not found/);
    await ok('navigate', { openRaw: true });
    expect(store.getState().rawMode).toBe(true);
    await ok('navigate', { view: 'engineering' });
    expect(store.getState()).toMatchObject({ rawMode: false, view: 'engineering' });
  });

  it('filter_view narrows the view with a banner description, and clear_filter removes it', async () => {
    const { ok, fail, store } = await boot();
    await ok('navigate', { view: 'engineering' });
    const d = await ok('filter_view', { description: 'Showing everything about overdue tasks.', entityIds: ['cap.task-discovery.today-overdue'], behaviorIds: ['behavior.today.rollover'] });
    expect(d.view).toBe('product'); // the engineering view had no matches
    expect(d.matchesPerView).toEqual({ product: 2, engineering: 0 });
    expect(store.getState().viewFilter).toEqual({ description: 'Showing everything about overdue tasks.', entityIds: ['cap.task-discovery.today-overdue'], behaviorIds: ['behavior.today.rollover'] });
    expect(store.getState().view).toBe('product');
    expect((await ok('get_status')).viewFilter.description).toMatch(/overdue/);
    expect((await fail('filter_view', { description: 'x' })).error).toMatch(/at least one/);
    expect((await fail('filter_view', { description: 'x', entityIds: ['cap.zzz'] })).error).toMatch(/not found/);
    expect(store.getState().viewFilter?.description).toMatch(/overdue/); // a failed call keeps the old filter
    // Selecting an entity hidden by the filter drops the filter; a visible one keeps it.
    store.dispatch({ type: 'selectEntity', id: 'cap.task-discovery.today-overdue', kind: 'capability' });
    expect(store.getState().viewFilter).not.toBeNull();
    store.dispatch({ type: 'selectEntity', id: 'sys.local-date', kind: 'system' });
    expect(store.getState().viewFilter).toBeNull();
    await ok('filter_view', { description: 'Systems.', entityIds: ['sys.local-date'] });
    expect(store.getState().view).toBe('engineering');
    expect(await ok('clear_filter')).toEqual({ cleared: true });
    expect(store.getState().viewFilter).toBeNull();
    expect(await ok('clear_filter')).toEqual({ cleared: false });
  });

  it('navigate refuses to leave the raw editor with an unapplied draft', async () => {
    const { ok, fail, store } = await boot();
    await ok('navigate', { openRaw: true });
    store.dispatch({ type: 'setRawDraft', text: TASKY + ' ' });
    expect((await fail('navigate', { view: 'product' })).error).toMatch(/unapplied edits/);
  });

  it('list_git_refs and its not-a-repo form', async () => {
    const a = await boot({ git: true });
    const d = await a.ok('list_git_refs');
    expect(d).toMatchObject({ available: true, branch: 'main', headCommit: SHA1 });
    expect(d.refs.map((r: any) => r.name)).toEqual(expect.arrayContaining(['HEAD', 'main', 'impl']));
    const b = await boot();
    expect(await b.ok('list_git_refs')).toMatchObject({ available: false, refs: [] });
  });

  it('compare main → impl returns totals, direct changes, potential impact and drives the UI state', async () => {
    const { ok, fail, store } = await boot({ git: true, text: DEMO_IMPL });
    const d = await ok('compare', { base: 'main', target: 'impl' });
    expect(d.totalChanges).toBe(9);
    expect(d.directlyChanged).toHaveLength(3);
    expect(d.potentiallyAffected).toHaveLength(3);
    expect(d.potentiallyAffected[0].via).toMatch(/→|depends on|uses|is implemented by/);
    expect(d.totals.behavior).toEqual({ added: 1, modified: 4, removed: 0 });
    expect(d.totals).not.toHaveProperty('evidence');
    expect(d.guaranteeChanges + d.verificationChanges).toBe(9);
    expect(d.changes[0]).toEqual(expect.objectContaining({ key: expect.any(String), category: expect.any(String), kind: expect.any(String), label: expect.any(String), group: expect.stringMatching(/guarantee|verification/) }));
    expect(store.getState().compare).toEqual({ base: { type: 'ref', name: 'main' }, target: { type: 'ref', name: 'impl' } });
    expect(store.getState().compareResult?.status).toBe('ready');
    const status = await ok('get_status');
    expect(status.comparison).toMatchObject({ base: 'ref:main', target: 'ref:impl', status: 'ready' });
    // entities now carry diff status
    const rows = await ok('list_entities');
    expect(rows.comparing).toBe(true);
    expect(rows.entities.some((e: any) => e.diffStatus === 'modified')).toBe(true);
    // field-level detail
    const key = d.changes.find((c: any) => c.key === 'behavior:behavior.localdate.overdue-classification').key;
    const ch = await ok('get_change', { key });
    expect(ch.fields.map((f: any) => f.field)).toContain('expected');
    expect(ch.fields.find((f: any) => f.field === 'expected').before).not.toEqual(ch.fields.find((f: any) => f.field === 'expected').after);
    const moved = await ok('get_change', { key: 'behavior:behavior.tasks.complete-toggle' });
    expect(moved.ownerBefore).not.toBe(moved.ownerAfter);
    expect((await fail('get_change', { key: 'behavior:behavior.tasks.complete-togle' })).suggestions).toContain('behavior:behavior.tasks.complete-toggle');
    // impact from the comparison
    const imp = await ok('get_impact');
    expect(imp.directlyChanged).toHaveLength(3);
    expect(imp.count).toBe(3);
    // clear
    expect((await ok('clear_comparison')).cleared).toBe(true);
    expect(store.getState().compare).toBeNull();
    expect((await fail('get_change', { key })).error).toMatch(/no ready comparison/i);
    expect((await fail('get_impact')).error).toMatch(/No comparison is active/);
  });

  it('compare supports HEAD, working, unsaved and shas, and rejects bad revisions', async () => {
    const { ok, fail, store } = await boot({ git: true });
    await ok('update_product', { name: 'Edited' });
    const d = await ok('compare', { base: 'HEAD', target: 'unsaved', show: true });
    expect(d.totals.product).toEqual({ added: 0, modified: 1, removed: 0 });
    expect(store.getState().view).toBe('impact');
    const sha = await ok('compare', { base: SHA1.slice(0, 7), target: SHA2 });
    expect(sha.comparison.base).toBe(`sha:${SHA1.slice(0, 7)}`);
    const w = await ok('compare', { base: 'HEAD', target: 'working' });
    expect(w.totalChanges).toBeGreaterThan(0);
    const bad = await fail('compare', { base: 'mian', target: 'impl' });
    expect(bad.error).toMatch(/Cannot resolve revision 'mian'/);
    expect(bad.error).toContain('main');
    const nogit = await boot();
    expect((await nogit.fail('compare', { base: 'HEAD', target: 'working' })).error).toMatch(/Git is not available/);
  });

  it('get_impact for arbitrary entities uses the working contract relationships', async () => {
    const { ok, fail } = await boot();
    const d = await ok('get_impact', { entityIds: ['sys.local-date'] });
    const ids = d.potentiallyAffected.map((p: any) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['cap.task-discovery.today-overdue', 'sys.filtering-sorting', 'cap.task-discovery.inbox-all']));
    expect(ids).not.toContain('sys.local-date');
    expect(d.potentiallyAffected.find((p: any) => p.id === 'cap.task-discovery.inbox-all').hops).toBe(2);
    expect(d.potentiallyAffected[0].via).toContain('Local Date Evaluation');
    expect((await fail('get_impact', { entityIds: ['sys.local-dat'] })).suggestions).toContain('sys.local-date');
  });

  it('test results drive behavior status; results from before the proposal are unconfirmed', async () => {
    const { ok, store } = await boot({ git: true });
    const status = async () => (await ok('get_entity', { id: 'cap.task-discovery.today-overdue' })).behaviors.find((x: any) => x.id === BEHAVIOR);
    expect((await status()).status).toBe('unconfirmed');
    results(store, { 'test.tasky.views.today-overdue': 'passed' }, '2026-11-14T12:00:00.000Z');
    const b = await status();
    expect(b.status).toBe('passing');
    expect(b.tests[0]).toMatchObject({ status: 'passing', lastResult: { status: 'passed', at: '2026-11-14T12:00:00.000Z' } });
    // a proposal committed after that run makes the result unconfirmed until the tests run again
    const s = store.getState();
    store.dispatch({ type: 'setGit', git: s.git, refs: [...s.refs, { name: 'orbit/proposal/main', kind: 'tag', commit: SHA1, subject: 'proposal', date: '2026-11-14T13:00:00Z' }] });
    expect((await status()).status).toBe('unconfirmed');
    expect((await ok('get_status')).testResults.proposalTime).toBe('2026-11-14T13:00:00Z');
    results(store, { 'test.tasky.views.today-overdue': 'failed' }, '2026-11-14T14:00:00.000Z');
    expect((await status()).status).toBe('failing');
  });
});

describe('placeholder tests', () => {
  it('create_test with placeholder, list_tests reports it, update_test clears it', async () => {
    const { ok } = await boot();
    const t = await ok('create_test', { name: 'Overdue tasks stay in Today', location: 'tests/e2e/today.spec.ts › overdue stays', placeholder: true });
    expect(t.test).toMatchObject({ placeholder: true });
    const listed = await ok('list_tests', { query: 'overdue stays' });
    expect(listed.tests[0]).toMatchObject({ id: t.test.id, placeholder: true });
    const u = await ok('update_test', { id: t.test.id, placeholder: false });
    expect(u.test.placeholder).toBeUndefined();
    expect((await ok('list_tests', { query: 'overdue stays' })).tests[0].placeholder).toBe(false);
  });
});
