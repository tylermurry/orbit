import { describe, expect, it } from 'vitest';
import { allIds, generateId, referencesTo, removeEntity, removeTest, validateContract } from '../src/index.js';
import { beh, contract, ent, rel, tdef } from './fixtures.js';

const c = () =>
  contract({
    entities: [
      ent('cap.root', { behaviors: [beh('b.1', ['t.1'])] }),
      ent('cap.mid', { parentId: 'cap.root', name: 'Mid' }),
      ent('cap.leaf', { parentId: 'cap.mid' }),
      ent('sys.s'),
    ],
    relationships: [rel('r.1', 'cap.mid', 'sys.s'), rel('r.2', 'cap.leaf', 'cap.mid'), rel('r.3', 'cap.root', 'sys.s')],
    tests: [tdef('t.1'), tdef('t.2')],
  });

describe('generateId', () => {
  it('slugs names under a prefix', () => {
    expect(generateId('cap', [], 'Custom Lists')).toBe('cap.custom-lists');
    expect(generateId('cap', [], '  Café & Crème!! ')).toBe('cap.cafe-creme');
  });
  it('appends a counter when taken', () => {
    expect(generateId('cap', ['cap.custom-lists'], 'Custom Lists')).toBe('cap.custom-lists-2');
    expect(generateId('cap', new Set(['cap.custom-lists', 'cap.custom-lists-2']), 'Custom Lists')).toBe('cap.custom-lists-3');
  });
  it('falls back when there is no usable name', () => {
    expect(generateId('test', [])).toBe('test.new');
    expect(generateId('test', ['test.new'], '???')).toBe('test.new-2');
  });
});

describe('allIds', () => {
  it('collects id namespaces', () => {
    const ids = allIds(c());
    expect([...ids.entities]).toEqual(['cap.root', 'cap.mid', 'cap.leaf', 'sys.s']);
    expect([...ids.behaviors]).toEqual(['b.1']);
    expect(ids.relationships.size).toBe(3);
    expect(ids.tests.has('t.2')).toBe(true);
  });
});

describe('referencesTo', () => {
  it('describes entity references', () => {
    const refs = referencesTo(c(), 'entity', 'cap.mid');
    expect(refs.some((r) => r.includes('Parent of') && r.includes('cap.leaf'))).toBe(true);
    expect(refs.filter((r) => r.startsWith('Relationship'))).toHaveLength(2);
    expect(referencesTo(c(), 'entity', 'cap.root')[0]).toBe('Owns 1 behavior');
  });
  it('describes test references', () => {
    const refs = referencesTo(c(), 'test', 't.1');
    expect(refs).toHaveLength(1);
    expect(refs[0]).toContain("behavior 'b.1'");
    expect(referencesTo(c(), 'test', 'nope')).toEqual([]);
  });
  it('behaviors are never referenced', () => {
    expect(referencesTo(c(), 'behavior', 'b.1')).toEqual([]);
  });
});

describe('removeEntity', () => {
  it('reparents children to the grandparent and removes its relationships, immutably', () => {
    const orig = c();
    const out = removeEntity(orig, 'cap.mid', { children: 'reparent-to-grandparent' });
    expect(out.entities.map((e) => e.id)).toEqual(['cap.root', 'cap.leaf', 'sys.s']);
    expect(out.entities.find((e) => e.id === 'cap.leaf')!.parentId).toBe('cap.root');
    expect(out.relationships.map((r) => r.id)).toEqual(['r.3']);
    expect(orig.entities).toHaveLength(4);
    expect(validateContract(out)).toEqual([]);
  });
  it('reparents to null for root entities', () => {
    const out = removeEntity(c(), 'cap.root', { children: 'reparent-to-grandparent' });
    expect(out.entities.find((e) => e.id === 'cap.mid')!.parentId).toBeNull();
  });
  it('blocks when children exist, but allows leaves', () => {
    expect(() => removeEntity(c(), 'cap.mid', { children: 'block' })).toThrow(/child/);
    expect(removeEntity(c(), 'cap.leaf', { children: 'block' }).entities).toHaveLength(3);
  });
  it('throws for unknown ids', () => {
    expect(() => removeEntity(c(), 'nope', { children: 'block' })).toThrow(/does not exist/);
  });
});

describe('removeTest', () => {
  it('unmap yields a valid contract', () => {
    const out = removeTest(c(), 't.1', { unmap: true });
    expect(out.tests.map((t) => t.id)).toEqual(['t.2']);
    expect(out.entities[0]!.behaviors[0]!.testIds).toEqual([]);
    expect(validateContract(out)).toEqual([]);
  });
  it('leaves dangling references when not asked to clean them (validator catches it)', () => {
    const out = removeTest(c(), 't.1', { unmap: false });
    expect(out.entities[0]!.behaviors[0]!.testIds).toEqual(['t.1']);
    expect(validateContract(out).map((d) => d.code)).toEqual(['ref.behavior.test']);
  });
  it('throws for unknown tests', () => {
    expect(() => removeTest(c(), 'nope', { unmap: true })).toThrow(/does not exist/);
  });
});
