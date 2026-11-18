import { potentialImpact } from './graph.js';
import type {
  Behavior,
  Change,
  ChangeCategory,
  ChangeGroup,
  ChangeKind,
  ChangeTotals,
  Entity,
  EntityDiffState,
  FieldChange,
  ImpactPath,
  OrbitContract,
  Relationship,
  SemanticDiff,
} from './types.js';

const CATEGORIES: ChangeCategory[] = ['product', 'entity', 'behavior', 'relationship', 'test', 'flow'];

type Rec = Record<string, unknown>;

const same = (a: unknown, b: unknown): boolean => {
  const x = a ?? undefined;
  const y = b ?? undefined;
  if (x !== null && typeof x === 'object' && y !== null && typeof y === 'object') return JSON.stringify(x) === JSON.stringify(y);
  return x === y;
};

function setDiff(before: string[], after: string[]): { added: string[]; removed: string[] } {
  const b = new Set(before);
  const a = new Set(after);
  return { added: [...a].filter((x) => !b.has(x)).sort(), removed: [...b].filter((x) => !a.has(x)).sort() };
}

function fieldChanges(fields: string[], before: Rec, after: Rec): FieldChange[] {
  const out: FieldChange[] = [];
  for (const field of fields) {
    if (field === 'testIds') {
      const { added, removed } = setDiff(before.testIds as string[], after.testIds as string[]);
      if (added.length || removed.length) out.push({ field, before: before[field], after: after[field], addedItems: added, removedItems: removed });
    } else if (!same(before[field], after[field])) {
      out.push({ field, before: before[field], after: after[field] });
    }
  }
  return out;
}

function mapById<T extends { id: string }>(items: T[] | undefined): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items ?? []) if (!m.has(it.id)) m.set(it.id, it);
  return m;
}

function behaviorMap(c: OrbitContract | null): Map<string, { behavior: Behavior; owner: string }> {
  const m = new Map<string, { behavior: Behavior; owner: string }>();
  for (const e of c?.entities ?? []) for (const b of e.behaviors) if (!m.has(b.id)) m.set(b.id, { behavior: b, owner: e.id });
  return m;
}

const withoutBehaviors = (e: Entity): Omit<Entity, 'behaviors'> => {
  const { behaviors: _behaviors, ...rest } = e;
  return rest;
};

/** Semantic comparison by stable id. Ignores array order, key order, formatting and testIds order. */
export function diffContracts(base: OrbitContract | null, target: OrbitContract | null): SemanticDiff {
  const changes: Change[] = [];
  const push = (c: Omit<Change, 'key'>) => changes.push({ key: `${c.category}:${c.id}`, ...c });

  /** Generic id-keyed collection diff; added/modified in target order, then removed in base order. */
  function collection<T extends { id: string }>(
    category: ChangeCategory,
    baseItems: Map<string, T>,
    targetItems: Map<string, T>,
    opts: {
      fields: string[];
      label: (item: T) => string;
      group: (fields: FieldChange[]) => ChangeGroup;
      entityIds: (kind: ChangeKind, b: T | undefined, t: T | undefined, group: ChangeGroup) => string[];
      snapshot?: (item: T) => unknown;
      extra?: (b: T | undefined, t: T | undefined) => Partial<Change>;
    },
  ) {
    const snap = opts.snapshot ?? ((x: T) => x);
    for (const [id, t] of targetItems) {
      const b = baseItems.get(id);
      if (!b) {
        push({ category, kind: 'added', id, label: opts.label(t), group: opts.group([]), fields: [], after: snap(t), entityIds: opts.entityIds('added', undefined, t, opts.group([])), ...opts.extra?.(undefined, t) });
        continue;
      }
      const fields = fieldChanges(opts.fields, b as unknown as Rec, t as unknown as Rec);
      const extra = opts.extra?.(b, t);
      if (extra?.ownerBefore !== extra?.ownerAfter) {
        fields.push({ field: 'owner', before: extra?.ownerBefore, after: extra?.ownerAfter });
      }
      if (fields.length === 0) continue;
      const group = opts.group(fields);
      push({ category, kind: 'modified', id, label: opts.label(t), group, fields, before: snap(b), after: snap(t), entityIds: opts.entityIds('modified', b, t, group), ...extra });
    }
    for (const [id, b] of baseItems) {
      if (targetItems.has(id)) continue;
      push({ category, kind: 'removed', id, label: opts.label(b), group: opts.group([]), fields: [], before: snap(b), entityIds: opts.entityIds('removed', b, undefined, opts.group([])), ...opts.extra?.(b, undefined) });
    }
  }

  // Product ------------------------------------------------------------------
  if (base?.product || target?.product) {
    const b = base?.product;
    const t = target?.product;
    if (b && t) {
      const fields = fieldChanges(['id', 'name', 'summary', 'description'], b as unknown as Rec, t as unknown as Rec);
      if (fields.length) push({ category: 'product', kind: 'modified', id: t.id, label: t.name, group: 'guarantee', fields, before: b, after: t, entityIds: [] });
    } else if (t) {
      push({ category: 'product', kind: 'added', id: t.id, label: t.name, group: 'guarantee', fields: [], after: t, entityIds: [] });
    } else if (b) {
      push({ category: 'product', kind: 'removed', id: b.id, label: b.name, group: 'guarantee', fields: [], before: b, entityIds: [] });
    }
  }

  // Entities -----------------------------------------------------------------
  const baseEntities = mapById(base?.entities);
  const targetEntities = mapById(target?.entities);
  collection('entity', baseEntities, targetEntities, {
    fields: ['name', 'summary', 'description', 'kind', 'parentId'],
    label: (e) => e.name,
    group: () => 'guarantee',
    entityIds: (_k, b, t) => [(t ?? b)!.id],
    snapshot: withoutBehaviors,
  });

  // Behaviors (global ids; ownership move is a modification, not add+remove) --------
  const baseBehaviors = behaviorMap(base);
  const targetBehaviors = behaviorMap(target);
  const bFlat = new Map([...baseBehaviors].map(([id, v]) => [id, { ...v.behavior, owner: v.owner }]));
  const tFlat = new Map([...targetBehaviors].map(([id, v]) => [id, { ...v.behavior, owner: v.owner }]));
  type FlatBehavior = Behavior & { owner: string };
  collection<FlatBehavior>('behavior', bFlat, tFlat, {
    fields: ['name', 'expected', 'testIds'],
    label: (b) => b.name,
    group: (fields) => (fields.length === 0 || fields.some((f) => f.field !== 'testIds') ? 'guarantee' : 'verification'),
    entityIds: (_k, b, t, group) => (group === 'guarantee' ? [...new Set([b?.owner, t?.owner].filter((x): x is string => x !== undefined))] : []),
    snapshot: ({ owner: _owner, ...b }) => b,
    extra: (b, t) => ({
      ...(b ? { ownerBefore: b.owner } : {}),
      ...(t ? { ownerAfter: t.owner } : {}),
    }),
  });

  // Relationships ------------------------------------------------------------
  const baseRels = mapById(base?.relationships);
  const targetRels = mapById(target?.relationships);
  collection<Relationship>('relationship', baseRels, targetRels, {
    fields: ['type', 'sourceId', 'targetId', 'description'],
    label: (r) => r.id,
    group: () => 'guarantee',
    entityIds: (_k, b, t) => [...new Set([b?.sourceId, t?.sourceId].filter((x): x is string => x !== undefined))],
  });

  // Tests (verification only) -----------------------------------------------
  collection('test', mapById(base?.tests), mapById(target?.tests), {
    fields: ['name', 'location', 'placeholder'],
    label: (t) => t.name,
    group: () => 'verification',
    entityIds: () => [],
  });

  // Flows (narrative only: never marks entities as changed). Step order is meaningful, so a reorder is a change.
  collection('flow', mapById(base?.flows), mapById(target?.flows), {
    fields: ['name', 'summary', 'trigger', 'capabilityId', 'steps'],
    label: (f) => f.name,
    group: () => 'guarantee',
    entityIds: () => [],
  });

  // Totals -------------------------------------------------------------------
  const totals = {} as Record<ChangeCategory, ChangeTotals>;
  for (const c of CATEGORIES) totals[c] = { added: 0, removed: 0, modified: 0 };
  for (const c of changes) totals[c.category][c.kind]++;

  // Directly changed entities --------------------------------------------------
  const direct = new Set<string>();
  for (const c of changes) if (c.group === 'guarantee') for (const id of c.entityIds) direct.add(id);

  // Impact over the union of both relationship graphs ----------------------------
  const seen = new Set<string>();
  const unionRels: Relationship[] = [];
  for (const r of [...(base?.relationships ?? []), ...(target?.relationships ?? [])]) {
    const key = `${r.id}|${r.type}|${r.sourceId}|${r.targetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unionRels.push(r);
  }
  const allEntities = new Map<string, Entity>([...baseEntities, ...targetEntities]);
  const potentiallyAffected = potentialImpact(unionRels, direct).filter((p) => allEntities.has(p.entityId));
  const impactBy = new Map<string, ImpactPath>(potentiallyAffected.map((p) => [p.entityId, p]));

  // Entity states ------------------------------------------------------------------
  const name = (id: string) => (targetEntities.get(id) ?? baseEntities.get(id))?.name ?? id;
  const reasons = new Map<string, string[]>();
  const why = (id: string, text: string) => {
    const list = reasons.get(id);
    if (list) list.push(text);
    else reasons.set(id, [text]);
  };
  const FIELD_WORDS: Record<string, string> = { parentId: 'parent', testIds: 'test mapping', sourceId: 'source', targetId: 'target' };
  const fieldList = (fields: FieldChange[]) => fields.map((f) => FIELD_WORDS[f.field] ?? f.field).join(', ');
  for (const c of changes) {
    if (c.group !== 'guarantee') continue;
    if (c.category === 'entity') {
      why(c.id, c.kind === 'modified' ? `${c.fields.map((f) => `${FIELD_WORDS[f.field] ?? f.field} changed`).join(', ')}` : `entity ${c.kind}`);
    } else if (c.category === 'behavior') {
      if (c.kind !== 'modified') why(c.entityIds[0]!, `behavior ${c.kind}: ${c.label}`);
      else if (c.ownerBefore !== c.ownerAfter) {
        why(c.ownerBefore!, `behavior moved out: ${c.label}`);
        why(c.ownerAfter!, `behavior moved in: ${c.label}`);
        const others = c.fields.filter((f) => f.field !== 'owner');
        if (others.length) why(c.ownerAfter!, `behavior modified: ${c.label} (${fieldList(others)} changed)`);
      } else why(c.entityIds[0]!, `behavior modified: ${c.label} (${fieldList(c.fields)} changed)`);
    } else if (c.category === 'relationship') {
      const r = (c.after ?? c.before) as Relationship;
      const src = c.kind === 'removed' ? (c.before as Relationship).sourceId : r.sourceId;
      const text = `relationship ${c.kind}: ${r.type} ${name(r.targetId)}`;
      why(src, c.kind === 'modified' ? `${text} (${fieldList(c.fields)} changed)` : text);
      const before = c.before as Relationship | undefined;
      if (c.kind === 'modified' && before && before.sourceId !== r.sourceId) why(before.sourceId, `relationship moved away: ${before.type} ${name(before.targetId)}`);
    }
  }

  // Hierarchy used for changedDescendants: each entity sits under its target parent (base parent for ghosts).
  const kids = new Map<string, string[]>();
  for (const [id, e] of allEntities) {
    const parent = targetEntities.get(id)?.parentId ?? (targetEntities.has(id) ? null : e.parentId);
    const pe = parent === null ? undefined : allEntities.get(parent);
    if (parent === null || !pe || pe.kind !== e.kind) continue;
    const l = kids.get(parent);
    if (l) l.push(id);
    else kids.set(parent, [id]);
  }

  const entityStates: Record<string, EntityDiffState> = {};
  for (const [id] of allEntities) {
    const inBase = baseEntities.has(id);
    const inTarget = targetEntities.has(id);
    let status: EntityDiffState['status'];
    if (!inBase) status = 'added';
    else if (!inTarget) status = 'removed';
    else if (direct.has(id)) status = 'modified';
    else if (impactBy.has(id)) status = 'affected';
    else status = 'unchanged';
    const list = reasons.get(id) ? [...reasons.get(id)!] : [];
    const impact = status === 'affected' ? impactBy.get(id) : undefined;
    if (impact) {
      list.push(`potentially affected: ${impact.path.map((s) => `${name(s.sourceId)} ${s.type} ${name(s.targetId)}`).join(' -> ')}`);
    }
    entityStates[id] = { entityId: id, status, reasons: list, ...(impact ? { impact } : {}), changedDescendants: 0, ghost: !inTarget };
  }
  const memo = new Map<string, number>();
  const countBelow = (id: string, path: Set<string>): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    let n = 0;
    for (const k of kids.get(id) ?? []) {
      if (path.has(k)) continue;
      path.add(k);
      n += (entityStates[k]!.status !== 'unchanged' ? 1 : 0) + countBelow(k, path);
      path.delete(k);
    }
    memo.set(id, n);
    return n;
  };
  for (const id of Object.keys(entityStates)) entityStates[id]!.changedDescendants = countBelow(id, new Set([id]));

  return {
    base,
    target,
    contractStatus: base === null && target !== null ? 'added' : target === null && base !== null ? 'removed' : 'present',
    changes,
    totals,
    directlyChangedEntityIds: [...direct],
    potentiallyAffected,
    entityStates,
  };
}

