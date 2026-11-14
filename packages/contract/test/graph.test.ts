import { describe, expect, it } from 'vitest';
import {
  ancestorsOf,
  behaviorIndex,
  childrenOf,
  descendantIdsOf,
  entityById,
  focusedRelations,
  potentialImpact,
  wouldCreateCycle,
} from '../src/index.js';
import { beh, contract, ent, rel } from './fixtures.js';

const tree = contract({
  entities: [
    ent('cap.root', { name: 'Root' }),
    ent('cap.b', { parentId: 'cap.root', name: 'Bravo', behaviors: [beh('b.1')] }),
    ent('cap.a', { parentId: 'cap.root', name: 'Alpha' }),
    ent('cap.a1', { parentId: 'cap.a', name: 'Alpha One' }),
    ent('sys.s', { name: 'Sys' }),
    ent('sys.s1', { parentId: 'sys.s', name: 'Sys One' }),
  ],
});

describe('hierarchy', () => {
  it('indexes entities and behaviors', () => {
    expect(entityById(tree).get('cap.a')!.name).toBe('Alpha');
    expect(behaviorIndex(tree).get('b.1')!.entity.id).toBe('cap.b');
  });
  it('childrenOf sorts by name and filters by kind', () => {
    expect(childrenOf(tree, 'cap.root').map((e) => e.id)).toEqual(['cap.a', 'cap.b']);
    expect(childrenOf(tree, null).map((e) => e.id)).toEqual(['cap.root', 'sys.s']);
    expect(childrenOf(tree, null, 'system').map((e) => e.id)).toEqual(['sys.s']);
  });
  it('ancestorsOf is nearest first and cycle safe', () => {
    expect(ancestorsOf(tree, 'cap.a1').map((e) => e.id)).toEqual(['cap.a', 'cap.root']);
    expect(ancestorsOf(tree, 'nope')).toEqual([]);
    const cyc = contract({ entities: [ent('cap.x', { parentId: 'cap.y' }), ent('cap.y', { parentId: 'cap.x' })] });
    expect(ancestorsOf(cyc, 'cap.x').map((e) => e.id)).toEqual(['cap.y']);
  });
  it('descendantIdsOf covers the same-kind subtree, excludes self, and terminates on cycles', () => {
    expect(descendantIdsOf(tree, 'cap.root')).toEqual(['cap.b', 'cap.a', 'cap.a1']);
    expect(descendantIdsOf(tree, 'cap.a1')).toEqual([]);
    const mixed = contract({ entities: [ent('cap.p'), ent('sys.c', { parentId: 'cap.p' })] });
    expect(descendantIdsOf(mixed, 'cap.p')).toEqual([]); // cross-kind children are not same-kind descendants
    const cyc = contract({ entities: [ent('cap.x', { parentId: 'cap.y' }), ent('cap.y', { parentId: 'cap.x' })] });
    expect(descendantIdsOf(cyc, 'cap.x')).toEqual(['cap.y']);
  });
  it('wouldCreateCycle', () => {
    expect(wouldCreateCycle(tree, 'cap.root', 'cap.a1')).toBe(true);
    expect(wouldCreateCycle(tree, 'cap.a', 'cap.a')).toBe(true);
    expect(wouldCreateCycle(tree, 'cap.a', 'cap.b')).toBe(false);
    expect(wouldCreateCycle(tree, 'cap.a', null)).toBe(false);
    expect(wouldCreateCycle(tree, 'cap.a1', 'cap.root')).toBe(false);
  });
});

describe('focusedRelations', () => {
  it('splits incoming and outgoing', () => {
    const c = contract({ entities: [ent('cap.a'), ent('cap.b'), ent('cap.c')], relationships: [rel('1', 'cap.a', 'cap.b'), rel('2', 'cap.c', 'cap.a'), rel('3', 'cap.b', 'cap.c')] });
    const f = focusedRelations(c, 'cap.a');
    expect(f.outgoing.map((r) => r.id)).toEqual(['1']);
    expect(f.incoming.map((r) => r.id)).toEqual(['2']);
  });
});

describe('potentialImpact', () => {
  it('flows backward from target to source, multi-hop, with provenance path', () => {
    const rels = [rel('r1', 'a', 'b', 'uses'), rel('r2', 'b', 'c', 'dependsOn'), rel('r3', 'c', 'd', 'implementedBy')];
    const out = potentialImpact(rels, ['d']);
    expect(out.map((p) => p.entityId)).toEqual(['c', 'b', 'a']);
    const a = out.find((p) => p.entityId === 'a')!;
    expect(a.changedEntityId).toBe('d');
    expect(a.path.map((s) => s.relationshipId)).toEqual(['r1', 'r2', 'r3']);
    expect(a.path[0]).toEqual({ relationshipId: 'r1', type: 'uses', sourceId: 'a', targetId: 'b' });
  });
  it('does not impact the target of a changed source', () => {
    expect(potentialImpact([rel('r1', 'a', 'b')], ['a'])).toEqual([]);
  });
  it('terminates on cycles and excludes changed ids', () => {
    const rels = [rel('r1', 'a', 'b'), rel('r2', 'b', 'c'), rel('r3', 'c', 'a')];
    const out = potentialImpact(rels, ['a']);
    expect(out.map((p) => p.entityId).sort()).toEqual(['b', 'c']);
  });
  it('does not double count with multiple edges or multiple changed entities; shortest path wins', () => {
    const rels = [rel('r1', 'a', 'x'), rel('r2', 'a', 'y'), rel('r3', 'a', 'b'), rel('r4', 'b', 'x'), rel('r5', 'a', 'x', 'uses')];
    const out = potentialImpact(rels, ['x', 'y']);
    expect(out.filter((p) => p.entityId === 'a')).toHaveLength(1);
    expect(out.find((p) => p.entityId === 'a')!.path).toHaveLength(1);
    expect(out.find((p) => p.entityId === 'b')!.path).toHaveLength(1);
    expect(out.map((p) => p.entityId)).toEqual(['a', 'b']);
  });
  it('ignores self edges', () => {
    expect(potentialImpact([rel('r', 'a', 'a')], ['a'])).toEqual([]);
    expect(potentialImpact([rel('r', 'a', 'a'), rel('r2', 'b', 'a')], ['a']).map((p) => p.entityId)).toEqual(['b']);
  });
  it('treats parenthood as no edge (relationships only)', () => {
    expect(potentialImpact([], ['cap.a1'])).toEqual([]);
  });
  it('sorts by path length then id', () => {
    const rels = [rel('r1', 'z', 'x'), rel('r2', 'a', 'z'), rel('r3', 'b', 'x')];
    expect(potentialImpact(rels, ['x']).map((p) => p.entityId)).toEqual(['b', 'z', 'a']);
  });
  it('accepts any iterable', () => {
    expect(potentialImpact([rel('r', 'a', 'b')], new Set(['b'])).map((p) => p.entityId)).toEqual(['a']);
  });
});
