import type { Behavior, Entity, EntityKind, Flow, ImpactPath, ImpactStep, OrbitContract, Relationship } from './types.js';

export function entityById(contract: OrbitContract): Map<string, Entity> {
  const m = new Map<string, Entity>();
  for (const e of contract.entities) if (!m.has(e.id)) m.set(e.id, e);
  return m;
}

export function behaviorIndex(contract: OrbitContract): Map<string, { behavior: Behavior; entity: Entity }> {
  const m = new Map<string, { behavior: Behavior; entity: Entity }>();
  for (const entity of contract.entities) {
    for (const behavior of entity.behaviors) if (!m.has(behavior.id)) m.set(behavior.id, { behavior, entity });
  }
  return m;
}

/** Children of parentId (null = roots), sorted by name for display. */
export function childrenOf(contract: OrbitContract, parentId: string | null, kind?: EntityKind): Entity[] {
  return contract.entities
    .filter((e) => e.parentId === parentId && (kind === undefined || e.kind === kind))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Nearest ancestor first. Stops at missing parents and cycles. */
export function ancestorsOf(contract: OrbitContract, id: string): Entity[] {
  const byId = entityById(contract);
  const out: Entity[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parentId ?? null;
  while (cur !== null && !seen.has(cur)) {
    const e = byId.get(cur);
    if (!e) break;
    out.push(e);
    seen.add(cur);
    cur = e.parentId;
  }
  return out;
}

/** Same-kind children lookup in contract array order (not name-sorted). */
export function sameKindChildren(contract: OrbitContract): Map<string, Entity[]> {
  const byId = entityById(contract);
  const m = new Map<string, Entity[]>();
  for (const e of contract.entities) {
    if (e.parentId === null || byId.get(e.parentId)?.kind !== e.kind) continue;
    if (byId.get(e.id) !== e) continue; // ignore duplicate-id shadows
    const list = m.get(e.parentId);
    if (list) list.push(e);
    else m.set(e.parentId, [e]);
  }
  return m;
}

/** Same-kind subtree ids in pre-order (contract array order), excluding `id`. Cycle-safe. */
export function descendantIdsOf(contract: OrbitContract, id: string): string[] {
  const children = sameKindChildren(contract);
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const walk = (cur: string) => {
    for (const c of children.get(cur) ?? []) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c.id);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/** Would setting entityId's parent to newParentId create a cycle (or make it its own parent)? */
export function wouldCreateCycle(contract: OrbitContract, entityId: string, newParentId: string | null): boolean {
  if (newParentId === null) return false;
  if (newParentId === entityId) return true;
  return ancestorsOf(contract, newParentId).some((a) => a.id === entityId);
}

export function focusedRelations(contract: OrbitContract, entityId: string): { incoming: Relationship[]; outgoing: Relationship[] } {
  return {
    incoming: contract.relationships.filter((r) => r.targetId === entityId),
    outgoing: contract.relationships.filter((r) => r.sourceId === entityId),
  };
}

/**
 * Reverse reachability: a changed target potentially affects every source that (transitively) depends on,
 * uses, or is implemented by it. Parenthood is not an edge. Each entity is reported once with a shortest path.
 */
export function potentialImpact(relationships: Relationship[], changedEntityIds: Iterable<string>): ImpactPath[] {
  const incoming = new Map<string, Relationship[]>();
  for (const r of relationships) {
    if (r.sourceId === r.targetId) continue;
    const list = incoming.get(r.targetId);
    if (list) list.push(r);
    else incoming.set(r.targetId, [r]);
  }
  const changed = new Set(changedEntityIds);
  // Per reached entity: the path to its changed entity.
  const reached = new Map<string, { path: ImpactStep[]; changedEntityId: string }>();
  for (const c of changed) reached.set(c, { path: [], changedEntityId: c });
  const queue = [...changed];
  for (let head = 0; head < queue.length; head++) {
    const target = queue[head]!;
    const targetInfo = reached.get(target)!;
    for (const r of incoming.get(target) ?? []) {
      if (reached.has(r.sourceId)) continue;
      const step: ImpactStep = { relationshipId: r.id, type: r.type, sourceId: r.sourceId, targetId: r.targetId };
      reached.set(r.sourceId, { path: [step, ...targetInfo.path], changedEntityId: targetInfo.changedEntityId });
      queue.push(r.sourceId);
    }
  }
  const out: ImpactPath[] = [];
  for (const [entityId, info] of reached) {
    if (changed.has(entityId)) continue;
    out.push({ entityId, path: info.path, changedEntityId: info.changedEntityId });
  }
  return out.sort((a, b) => a.path.length - b.path.length || a.entityId.localeCompare(b.entityId));
}

/** Flows owned by the entity or passing through it (as either end of a step's relationship). Contract order. */
export function flowsThrough(contract: OrbitContract, entityId: string): Flow[] {
  const rels = new Map(contract.relationships.map((r) => [r.id, r]));
  return (contract.flows ?? []).filter(
    (f) =>
      f.capabilityId === entityId ||
      f.steps.some((s) => {
        const r = rels.get(s.relationshipId);
        return r !== undefined && (r.sourceId === entityId || r.targetId === entityId);
      }),
  );
}

/** Flows with at least one step along the relationship. Contract order. */
export function flowsUsing(contract: OrbitContract, relationshipId: string): Flow[] {
  return (contract.flows ?? []).filter((f) => f.steps.some((s) => s.relationshipId === relationshipId));
}
