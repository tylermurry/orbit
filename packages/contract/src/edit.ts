import type { Flow, OrbitContract } from './types.js';

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
  flows: Set<string>;
} {
  return {
    entities: new Set(contract.entities.map((e) => e.id)),
    behaviors: new Set(contract.entities.flatMap((e) => e.behaviors.map((b) => b.id))),
    relationships: new Set(contract.relationships.map((r) => r.id)),
    tests: new Set(contract.tests.map((t) => t.id)),
    flows: new Set((contract.flows ?? []).map((f) => f.id)),
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
    for (const f of contract.flows ?? []) {
      if (f.capabilityId === id) out.push(`Owns flow '${f.name}' (deleted with it)`);
      else {
        const lost = f.steps.filter((s) => {
          const r = contract.relationships.find((x) => x.id === s.relationshipId);
          return r && (r.sourceId === id || r.targetId === id);
        }).length;
        if (lost) out.push(`Flow '${f.name}' loses ${lost} step${lost === 1 ? '' : 's'}`);
      }
    }
  } else if (kind === 'test') {
    for (const e of contract.entities) {
      for (const b of e.behaviors) if (b.testIds.includes(id)) out.push(`Verifies behavior '${b.name}' of '${e.name}'`);
    }
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
  const gone = new Set(contract.relationships.filter((r) => r.sourceId === id || r.targetId === id).map((r) => r.id));
  const next: OrbitContract = {
    ...contract,
    entities: contract.entities
      .filter((e) => e.id !== id)
      .map((e) => (e.parentId === id ? { ...e, parentId: target.parentId } : e)),
    relationships: contract.relationships.filter((r) => !gone.has(r.id)),
  };
  if (contract.flows) next.flows = contract.flows.filter((f) => f.capabilityId !== id).map((f) => dropSteps(f, gone));
  return next;
}

function dropSteps(f: Flow, relationshipIds: ReadonlySet<string>): Flow {
  return f.steps.some((s) => relationshipIds.has(s.relationshipId)) ? { ...f, steps: f.steps.filter((s) => !relationshipIds.has(s.relationshipId)) } : f;
}

/** Remove a relationship and every flow step that travels along it. Throws when unknown. */
export function removeRelationship(contract: OrbitContract, id: string): OrbitContract {
  if (!contract.relationships.some((r) => r.id === id)) throw new Error(`Relationship '${id}' does not exist.`);
  const gone = new Set([id]);
  const next: OrbitContract = { ...contract, relationships: contract.relationships.filter((r) => r.id !== id) };
  if (contract.flows) next.flows = contract.flows.map((f) => dropSteps(f, gone));
  return next;
}

/** Remove a test definition; optionally unmap it from behaviors. */
export function removeTest(contract: OrbitContract, id: string, opts: { unmap: boolean }): OrbitContract {
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
  };
}
