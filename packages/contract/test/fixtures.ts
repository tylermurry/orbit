import type { Behavior, Entity, OrbitContract, Relationship } from '../src/index.js';


export function ent(id: string, over: Partial<Entity> = {}): Entity {
  return { id, kind: id.startsWith('sys.') ? 'system' : 'capability', parentId: null, name: id, summary: `${id} summary`, description: '', behaviors: [], ...over };
}
export function beh(id: string, testIds: string[] = [], over: Partial<Behavior> = {}): Behavior {
  return { id, name: id, expected: `${id} works`, testIds, ...over };
}
export function rel(id: string, sourceId: string, targetId: string, type: Relationship['type'] = 'dependsOn'): Relationship {
  return { id, type, sourceId, targetId };
}
export function contract(over: Partial<OrbitContract> = {}): OrbitContract {
  return {
    schemaVersion: 1,
    product: { id: 'p', name: 'P', summary: 'S' },
    entities: [],
    relationships: [],
    tests: [],
    ...over,
  };
}
export const tdef = (id: string) => ({ id, name: id, location: `${id}.ts` });
