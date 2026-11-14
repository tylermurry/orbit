import type { Behavior, Entity, Evidence, OrbitContract, Relationship } from '../src/index.js';

export const SHA_A = 'a'.repeat(40);
export const SHA_B = 'b'.repeat(40);

export function ent(id: string, over: Partial<Entity> = {}): Entity {
  return { id, kind: id.startsWith('sys.') ? 'system' : 'capability', parentId: null, name: id, summary: `${id} summary`, description: '', behaviors: [], ...over };
}
export function beh(id: string, testIds: string[] = [], over: Partial<Behavior> = {}): Behavior {
  return { id, name: id, expected: `${id} works`, testIds, ...over };
}
export function rel(id: string, sourceId: string, targetId: string, type: Relationship['type'] = 'dependsOn'): Relationship {
  return { id, type, sourceId, targetId };
}
export function ev(id: string, testId: string, status: Evidence['status'], executedAt: string, commit?: string): Evidence {
  return { id, testId, status, executedAt, ...(commit ? { commit } : {}) };
}
export function contract(over: Partial<OrbitContract> = {}): OrbitContract {
  return {
    schemaVersion: 1,
    product: { id: 'p', name: 'P', summary: 'S' },
    entities: [],
    relationships: [],
    tests: [],
    evidence: [],
    ...over,
  };
}
export const tdef = (id: string) => ({ id, name: id, location: `${id}.ts` });
