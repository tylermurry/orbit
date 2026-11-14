import type { OrbitContract } from './types.js';

function slug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'new';
}

/** e.g. ('cap', ids, 'Custom Lists') -> 'cap.custom-lists'; appends -2, -3 ... when taken. */
export function generateId(prefix: string, existing: Iterable<string>, name?: string): string {
  const taken = new Set(existing);
  const base = `${prefix}.${slug(name ?? '')}`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function allIds(contract: OrbitContract): {
  entities: Set<string>;
  behaviors: Set<string>;
  relationships: Set<string>;
  tests: Set<string>;
  evidence: Set<string>;
} {
  return {
    entities: new Set(contract.entities.map((e) => e.id)),
    behaviors: new Set(contract.entities.flatMap((e) => e.behaviors.map((b) => b.id))),
    relationships: new Set(contract.relationships.map((r) => r.id)),
    tests: new Set(contract.tests.map((t) => t.id)),
    evidence: new Set(contract.evidence.map((e) => e.id)),
  };
}

/** Human descriptions of everything that refers to the given item (for delete confirmations). */
export function referencesTo(contract: OrbitContract, kind: 'entity' | 'behavior' | 'test', id: string): string[] {
  const out: string[] = [];
  if (kind === 'entity') {
    const name = (eid: string) => contract.entities.find((e) => e.id === eid)?.name ?? eid;
    const self = contract.entities.find((e) => e.id === id);
    if (self && self.behaviors.length) out.push(`Owns ${self.behaviors.length} behavior${self.behaviors.length === 1 ? '' : 's'}`);
    for (const e of contract.entities) if (e.parentId === id) out.push(`Parent of ${e.kind} '${e.name}'`);
    for (const r of contract.relationships) {
      if (r.sourceId === id) out.push(`Relationship '${r.id}': ${r.type} ${name(r.targetId)}`);
      else if (r.targetId === id) out.push(`Relationship '${r.id}': ${name(r.sourceId)} ${r.type} this`);
    }
  } else if (kind === 'test') {
    for (const e of contract.entities) {
      for (const b of e.behaviors) if (b.testIds.includes(id)) out.push(`Verifies behavior '${b.name}' of '${e.name}'`);
    }
    for (const ev of contract.evidence) if (ev.testId === id) out.push(`Evidence record '${ev.id}' (${ev.status})`);
  }
  // Nothing in the contract references a behavior id.
  return out;
}

/** Remove an entity (and its relationships; its behaviors go with it). Throws when blocked or unknown. */
export function removeEntity(contract: OrbitContract, id: string, opts: { children: 'reparent-to-grandparent' | 'block' }): OrbitContract {
  const target = contract.entities.find((e) => e.id === id);
  if (!target) throw new Error(`Entity '${id}' does not exist.`);
  const kids = contract.entities.filter((e) => e.parentId === id);
  if (kids.length > 0 && opts.children === 'block') {
    throw new Error(`Entity '${id}' still has ${kids.length} child ${kids.length === 1 ? 'entity' : 'entities'}; move or delete them first.`);
  }
  return {
    ...contract,
    entities: contract.entities
      .filter((e) => e.id !== id)
      .map((e) => (e.parentId === id ? { ...e, parentId: target.parentId } : e)),
    relationships: contract.relationships.filter((r) => r.sourceId !== id && r.targetId !== id),
  };
}

/** Remove a test definition; optionally unmap it from behaviors and delete its evidence. */
export function removeTest(contract: OrbitContract, id: string, opts: { unmap: boolean; removeEvidence: boolean }): OrbitContract {
  if (!contract.tests.some((t) => t.id === id)) throw new Error(`Test '${id}' does not exist.`);
  return {
    ...contract,
    tests: contract.tests.filter((t) => t.id !== id),
    entities: opts.unmap
      ? contract.entities.map((e) => ({
          ...e,
          behaviors: e.behaviors.map((b) => (b.testIds.includes(id) ? { ...b, testIds: b.testIds.filter((t) => t !== id) } : b)),
        }))
      : contract.entities,
    evidence: opts.removeEvidence ? contract.evidence.filter((ev) => ev.testId !== id) : contract.evidence,
  };
}
