import { describe, expect, it } from 'vitest';
import { diffContracts, parseContract, serializeContract } from '../src/index.js';
import type { OrbitContract } from '../src/index.js';
import { beh, contract, ent, rel, tdef } from './fixtures.js';

const clone = (c: OrbitContract): OrbitContract => JSON.parse(JSON.stringify(c));

const base = (): OrbitContract =>
  contract({
    entities: [
      ent('cap.tasks', { name: 'Tasks', behaviors: [beh('b.create', ['t.create'])] }),
      ent('cap.lists', { name: 'Lists', behaviors: [beh('b.lists')] }),
      ent('cap.sched', { name: 'Scheduling', parentId: 'cap.tasks' }),
      ent('sys.repo', { name: 'Repository' }),
      ent('sys.storage', { name: 'Storage' }),
    ],
    relationships: [rel('r.tasks.repo', 'cap.tasks', 'sys.repo', 'implementedBy'), rel('r.repo.storage', 'sys.repo', 'sys.storage', 'uses'), rel('r.lists.tasks', 'cap.lists', 'cap.tasks')],
    tests: [tdef('t.create'), tdef('t.other')],
  });

describe('no-op comparisons', () => {
  it('identical contracts produce zero changes and all-unchanged states', () => {
    const d = diffContracts(base(), base());
    expect(d.changes).toEqual([]);
    expect(d.contractStatus).toBe('present');
    expect(d.directlyChangedEntityIds).toEqual([]);
    expect(d.potentiallyAffected).toEqual([]);
    expect(Object.values(d.entityStates).every((s) => s.status === 'unchanged' && !s.ghost && s.changedDescendants === 0)).toBe(true);
  });

  it('reordering and reformatting are ignored', () => {
    const b = base();
    const t = clone(b);
    t.entities.reverse();
    t.relationships.reverse();
    t.tests.reverse();
    t.entities = t.entities.map((e) => ({ ...e, behaviors: [...e.behaviors].reverse() }));
    const reformatted = parseContract(JSON.stringify(t)).contract!; // minified, then parsed
    const viaSerialize = parseContract(serializeContract(reformatted)).contract!;
    expect(diffContracts(b, viaSerialize).changes).toEqual([]);
  });

  it('testIds are compared as sets', () => {
    const b = base();
    b.entities[0]!.behaviors[0]!.testIds = ['t.create', 't.other'];
    const t = clone(b);
    t.entities[0]!.behaviors[0]!.testIds = ['t.other', 't.create'];
    expect(diffContracts(b, t).changes).toEqual([]);
  });
});

describe('entity changes', () => {
  it('modified entity: fields, status, reasons', () => {
    const t = base();
    t.entities[1]!.name = 'Task Lists';
    t.entities[1]!.parentId = 'cap.tasks';
    const d = diffContracts(base(), t);
    expect(d.changes).toHaveLength(1);
    const c = d.changes[0]!;
    expect(c).toMatchObject({ key: 'entity:cap.lists', category: 'entity', kind: 'modified', group: 'guarantee', label: 'Task Lists', entityIds: ['cap.lists'] });
    expect(c.fields.map((f) => f.field)).toEqual(['name', 'parentId']);
    expect(c.fields[0]).toEqual({ field: 'name', before: 'Lists', after: 'Task Lists' });
    expect(d.entityStates['cap.lists']).toMatchObject({ status: 'modified', reasons: ['name changed, parent changed'] });
    expect(d.totals.entity).toEqual({ added: 0, removed: 0, modified: 1 });
  });

  it('added entity and its behaviors', () => {
    const t = base();
    t.entities.push(ent('cap.new', { name: 'New', behaviors: [beh('b.new')] }));
    const d = diffContracts(base(), t);
    expect(d.entityStates['cap.new']).toMatchObject({ status: 'added', ghost: false });
    expect(d.changes.map((c) => c.key).sort()).toEqual(['behavior:b.new', 'entity:cap.new']);
    expect(d.directlyChangedEntityIds).toEqual(['cap.new']);
  });

  it('removed entity becomes a ghost from base data, and its consumers surface', () => {
    const t = base();
    t.entities = t.entities.filter((e) => e.id !== 'sys.repo');
    t.relationships = t.relationships.filter((r) => r.sourceId !== 'sys.repo' && r.targetId !== 'sys.repo');
    const d = diffContracts(base(), t);
    expect(d.entityStates['sys.repo']).toMatchObject({ status: 'removed', ghost: true });
    // cap.tasks lost its edge (direct change as relationship source) and lists depends on tasks.
    expect(d.entityStates['cap.tasks']!.status).toBe('modified');
    expect(d.entityStates['cap.lists']!.status).toBe('affected');
    expect(d.totals.relationship.removed).toBe(2);
    expect(d.totals.entity.removed).toBe(1);
  });

  it('changedDescendants counts same-kind descendants whose status is not unchanged', () => {
    const t = base();
    t.entities[2]!.summary = 'changed'; // cap.sched under cap.tasks
    const d = diffContracts(base(), t);
    expect(d.entityStates['cap.tasks']!.changedDescendants).toBe(1);
    expect(d.entityStates['cap.sched']!.changedDescendants).toBe(0);
    expect(d.entityStates['cap.lists']!.changedDescendants).toBe(0);
  });

  it('removed child ghost still counts toward its surviving parent', () => {
    const t = base();
    t.entities = t.entities.filter((e) => e.id !== 'cap.sched');
    const d = diffContracts(base(), t);
    expect(d.entityStates['cap.tasks']!.changedDescendants).toBe(1);
  });

  it('parent with affected descendants is not directly modified', () => {
    const t = base();
    t.entities[3]!.summary = 'repo changed';
    const d = diffContracts(base(), t);
    expect(d.entityStates['cap.tasks']!.status).toBe('affected');
    expect(d.entityStates['cap.sched']!.status).toBe('unchanged');
    expect(d.entityStates['cap.tasks']!.changedDescendants).toBe(0); // sched is unaffected; parenthood is not an edge
  });
});

describe('behaviors', () => {
  it('modified behavior is a guarantee change owned by its entity', () => {
    const t = base();
    t.entities[0]!.behaviors[0]!.expected = 'changed';
    const d = diffContracts(base(), t);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]).toMatchObject({ category: 'behavior', kind: 'modified', group: 'guarantee', entityIds: ['cap.tasks'], ownerBefore: 'cap.tasks', ownerAfter: 'cap.tasks' });
    expect(d.entityStates['cap.tasks']!.status).toBe('modified');
    expect(d.entityStates['cap.tasks']!.reasons[0]).toContain('behavior modified: b.create');
  });

  it('testIds-only change is verification and does not mark the entity changed', () => {
    const t = base();
    t.entities[0]!.behaviors[0]!.testIds = ['t.create', 't.other'];
    const d = diffContracts(base(), t);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]).toMatchObject({ group: 'verification', entityIds: [] });
    expect(d.changes[0]!.fields[0]).toMatchObject({ field: 'testIds', addedItems: ['t.other'], removedItems: [] });
    expect(d.directlyChangedEntityIds).toEqual([]);
    expect(d.entityStates['cap.tasks']!.status).toBe('unchanged');
    expect(d.potentiallyAffected).toEqual([]);
  });

  it('name + testIds change is a guarantee change', () => {
    const t = base();
    t.entities[0]!.behaviors[0]!.name = 'Renamed';
    t.entities[0]!.behaviors[0]!.testIds = [];
    expect(diffContracts(base(), t).changes[0]!.group).toBe('guarantee');
  });

  it('ownership move is one modification with before/after owners, marking both owners', () => {
    const t = base();
    const moved = t.entities[0]!.behaviors.pop()!;
    t.entities[1]!.behaviors.push(moved);
    const d = diffContracts(base(), t);
    expect(d.changes).toHaveLength(1);
    const c = d.changes[0]!;
    expect(c).toMatchObject({ key: 'behavior:b.create', kind: 'modified', ownerBefore: 'cap.tasks', ownerAfter: 'cap.lists', group: 'guarantee' });
    expect(c.fields.map((f) => f.field)).toEqual(['owner']);
    expect(c.entityIds.sort()).toEqual(['cap.lists', 'cap.tasks']);
    expect(d.totals.behavior).toEqual({ added: 0, removed: 0, modified: 1 });
    expect(d.entityStates['cap.tasks']!.reasons).toContain('behavior moved out: b.create');
    expect(d.entityStates['cap.lists']!.reasons).toContain('behavior moved in: b.create');
  });

  it('added and removed behaviors mark the owner', () => {
    const t = base();
    t.entities[0]!.behaviors.push(beh('b.added'));
    t.entities[1]!.behaviors = [];
    const d = diffContracts(base(), t);
    expect(d.totals.behavior).toEqual({ added: 1, removed: 1, modified: 0 });
    expect(d.entityStates['cap.tasks']!.reasons).toContain('behavior added: b.added');
    expect(d.entityStates['cap.lists']!.reasons).toContain('behavior removed: b.lists');
  });
});

describe('relationships and impact', () => {
  it('changed target impacts reverse-reachable sources only', () => {
    const t = base();
    t.entities[4]!.summary = 'storage changed';
    const d = diffContracts(base(), t);
    expect(d.directlyChangedEntityIds).toEqual(['sys.storage']);
    const ids = d.potentiallyAffected.map((p) => p.entityId);
    expect(ids).toEqual(['sys.repo', 'cap.tasks', 'cap.lists']);
    expect(d.potentiallyAffected.find((p) => p.entityId === 'cap.lists')!.path.map((s) => s.relationshipId)).toEqual(['r.lists.tasks', 'r.tasks.repo', 'r.repo.storage']);
    expect(d.entityStates['cap.lists']).toMatchObject({ status: 'affected' });
    expect(d.entityStates['cap.lists']!.impact!.changedEntityId).toBe('sys.storage');
    expect(d.entityStates['cap.lists']!.reasons.at(-1)).toContain('potentially affected');
  });

  it('changing a source does not impact its target', () => {
    const t = base();
    t.entities[0]!.summary = 'x';
    const d = diffContracts(base(), t);
    expect(d.entityStates['sys.repo']!.status).toBe('unchanged');
    expect(d.entityStates['cap.lists']!.status).toBe('affected');
  });

  it('added relationship marks its source as directly changed with a reason', () => {
    const t = base();
    t.relationships.push(rel('r.new', 'cap.lists', 'sys.storage', 'uses'));
    const d = diffContracts(base(), t);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]).toMatchObject({ category: 'relationship', kind: 'added', entityIds: ['cap.lists'], group: 'guarantee' });
    expect(d.entityStates['cap.lists']).toMatchObject({ status: 'modified', reasons: ['relationship added: uses Storage'] });
    expect(d.entityStates['sys.storage']!.status).toBe('unchanged');
  });

  it('removed edge still surfaces consumers via the union of base and target graphs', () => {
    // r.lists.tasks removed AND cap.tasks changed: lists no longer depends on tasks in target, but base consumers must surface.
    const t = base();
    t.relationships = t.relationships.filter((r) => r.id !== 'r.lists.tasks');
    t.entities[0]!.summary = 'changed';
    const d = diffContracts(base(), t);
    expect(d.directlyChangedEntityIds.sort()).toEqual(['cap.lists', 'cap.tasks']);
    // lists is directly changed (lost an outgoing edge), so it is modified, not affected.
    expect(d.entityStates['cap.lists']!.status).toBe('modified');
  });

  it('union graph surfaces a consumer whose edge was removed when the provider changed', () => {
    const b = contract({ entities: [ent('cap.consumer'), ent('sys.provider'), ent('cap.other')], relationships: [rel('r', 'cap.consumer', 'sys.provider', 'uses')] });
    const t = clone(b);
    t.relationships = [];
    t.entities[1]!.summary = 'changed';
    const d = diffContracts(b, t);
    // consumer lost the edge so it is directly changed; make a third party depend on consumer in base only
    expect(d.entityStates['cap.consumer']!.status).toBe('modified');

    const b2 = contract({
      entities: [ent('cap.consumer'), ent('sys.provider'), ent('cap.upstream')],
      relationships: [rel('r1', 'cap.consumer', 'sys.provider', 'uses'), rel('r2', 'cap.upstream', 'cap.consumer')],
    });
    const t2 = clone(b2);
    t2.relationships = [t2.relationships[1]!]; // removed consumer -> provider edge
    t2.entities[1]!.summary = 'changed';
    const d2 = diffContracts(b2, t2);
    // upstream depends on consumer; consumer is directly changed (edge removed) so upstream is affected.
    expect(d2.entityStates['cap.upstream']!.status).toBe('affected');
    expect(d2.potentiallyAffected.find((p) => p.entityId === 'cap.upstream')!.changedEntityId).toBe('cap.consumer');
  });

  it('relationship whose endpoints changed keeps both versions in the impact graph', () => {
    const b = contract({ entities: [ent('cap.a'), ent('sys.x'), ent('sys.y')], relationships: [rel('r', 'cap.a', 'sys.x', 'uses')] });
    const t = clone(b);
    t.relationships[0]!.targetId = 'sys.y';
    t.entities[1]!.summary = 'x changed'; // sys.x modified: under base edge a is a consumer
    const d = diffContracts(b, t);
    expect(d.changes.find((c) => c.key === 'relationship:r')!.fields.map((f) => f.field)).toEqual(['targetId']);
    expect(d.entityStates['cap.a']!.status).toBe('modified'); // source of a modified edge
    // sys.y gets a consumer only through the target version, sys.x through base: neither hides the other.
    const t2 = clone(t);
    t2.entities[2]!.summary = 'y changed';
    t2.entities[0]!.summary = 'a changed';
    expect(diffContracts(b, t2).entityStates['cap.a']!.status).toBe('modified');
  });

  it('moving an edge to a new source marks both sources', () => {
    const b = contract({ entities: [ent('cap.a'), ent('cap.b'), ent('sys.x')], relationships: [rel('r', 'cap.a', 'sys.x', 'uses')] });
    const t = clone(b);
    t.relationships[0]!.sourceId = 'cap.b';
    const d = diffContracts(b, t);
    expect(d.changes[0]!.entityIds.sort()).toEqual(['cap.a', 'cap.b']);
    expect(d.directlyChangedEntityIds.sort()).toEqual(['cap.a', 'cap.b']);
  });

  it('cycles terminate', () => {
    const b = contract({ entities: [ent('cap.a'), ent('cap.b'), ent('cap.c')], relationships: [rel('r1', 'cap.a', 'cap.b'), rel('r2', 'cap.b', 'cap.a'), rel('r3', 'cap.c', 'cap.a')] });
    const t = clone(b);
    t.entities[0]!.summary = 'x';
    const d = diffContracts(b, t);
    expect(d.potentiallyAffected.map((p) => p.entityId).sort()).toEqual(['cap.b', 'cap.c']);
  });

  it('multiple edges do not double count a consumer', () => {
    const b = contract({ entities: [ent('cap.a'), ent('sys.x')], relationships: [rel('r1', 'cap.a', 'sys.x', 'uses'), rel('r2', 'cap.a', 'sys.x', 'dependsOn')] });
    const t = clone(b);
    t.entities[1]!.summary = 'x';
    expect(diffContracts(b, t).potentiallyAffected).toHaveLength(1);
  });
});

describe('verification metadata', () => {
  it('test changes are verification-group and never touch entities', () => {
    const t = base();
    t.tests[0]!.location = 'moved.ts';
    t.tests.push(tdef('t.new'));
    const d = diffContracts(base(), t);
    expect(d.changes.every((c) => c.group === 'verification' && c.entityIds.length === 0)).toBe(true);
    expect(d.totals.test).toEqual({ added: 1, removed: 0, modified: 1 });
    expect(d.directlyChangedEntityIds).toEqual([]);
    expect(Object.values(d.entityStates).every((s) => s.status === 'unchanged')).toBe(true);
  });

  it('removed tests', () => {
    const t = base();
    t.tests = [];
    const d = diffContracts(base(), t);
    expect(d.totals.test.removed).toBe(2);
  });
});

describe('product', () => {
  it('reports a single modified product change with the product id', () => {
    const t = base();
    t.product.name = 'Renamed';
    t.product.description = 'new';
    const d = diffContracts(base(), t);
    expect(d.changes).toHaveLength(1);
    expect(d.changes[0]).toMatchObject({ key: 'product:p', category: 'product', kind: 'modified', group: 'guarantee', id: 'p' });
    expect(d.changes[0]!.fields.map((f) => f.field)).toEqual(['name', 'description']);
    expect(d.totals.product.modified).toBe(1);
  });
});

describe('missing contract on one side', () => {
  it('base null: everything added', () => {
    const d = diffContracts(null, base());
    expect(d.contractStatus).toBe('added');
    expect(d.base).toBeNull();
    expect(Object.values(d.entityStates).every((s) => s.status === 'added' && !s.ghost)).toBe(true);
    expect(d.totals.entity.added).toBe(5);
    expect(d.totals.relationship.added).toBe(3);
    expect(d.totals.product.added).toBe(1);
    expect(d.changes.every((c) => c.kind === 'added')).toBe(true);
    expect(d.potentiallyAffected).toEqual([]);
  });
  it('target null: everything removed as ghosts', () => {
    const d = diffContracts(base(), null);
    expect(d.contractStatus).toBe('removed');
    expect(Object.values(d.entityStates).every((s) => s.status === 'removed' && s.ghost)).toBe(true);
    expect(d.changes.every((c) => c.kind === 'removed')).toBe(true);
    expect(d.entityStates['cap.tasks']!.changedDescendants).toBe(1);
  });
  it('both null yields an empty diff', () => {
    const d = diffContracts(null, null);
    expect(d.changes).toEqual([]);
    expect(d.contractStatus).toBe('present');
  });
});
