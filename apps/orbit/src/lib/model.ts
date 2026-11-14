import { descendantIdsOf, wouldCreateCycle } from '@orbit/contract';
import type { BehaviorStatus, Entity, EntityKind, OrbitContract, Relationship, RelationshipType } from '@orbit/contract';

export const KIND_LABEL: Record<EntityKind, string> = { capability: 'Capability', system: 'System' };
export const KIND_PLURAL: Record<EntityKind, string> = { capability: 'Capabilities', system: 'Systems' };

export const REL_INFO: Record<RelationshipType, { verb: string; inverse: string; meaning: string; dash: string }> = {
  dependsOn: { verb: 'depends on', inverse: 'is depended on by', meaning: "The source relies on the target's promised functionality.", dash: '' },
  uses: { verb: 'uses', inverse: 'is used by', meaning: 'The source utilizes the target as a supporting system or shared capability.', dash: '7 4' },
  implementedBy: { verb: 'is implemented by', inverse: 'implements', meaning: 'The source capability is supported by the target system.', dash: '2 4' },
};

export const STATUS_LABEL: Record<BehaviorStatus, string> = {
  failing: 'Failing',
  passing: 'Passing',
  unconfirmed: 'Unconfirmed',
  planned: 'Planned',
  untested: 'No tests',
};

export interface TreeNode {
  entity: Entity;
  children: TreeNode[];
}

/** Build a forest of the given kind. */
export function buildTree(contract: OrbitContract, kind: EntityKind): TreeNode[] {
  const all = contract.entities.filter((e) => e.kind === kind);
  const ids = new Set(all.map((e) => e.id));
  const nodes = new Map<string, TreeNode>(all.map((e) => [e.id, { entity: e, children: [] }]));
  const roots: TreeNode[] = [];
  for (const e of all) {
    const node = nodes.get(e.id)!;
    if (e.parentId && ids.has(e.parentId) && e.parentId !== e.id) nodes.get(e.parentId)!.children.push(node);
    else roots.push(node);
  }
  // Siblings keep their order from the file, so reordering in the tree is persisted.
  return roots;
}

export interface SearchResult {
  /** entity ids that match directly */
  matches: Set<string>;
  /** entity id -> matching behaviors */
  behaviorMatches: Map<string, { id: string; name: string; expected: string }[]>;
  /** matches plus their ancestors */
  visible: Set<string>;
}

export function searchTree(roots: TreeNode[], query: string): SearchResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const matches = new Set<string>();
  const behaviorMatches = new Map<string, { id: string; name: string; expected: string }[]>();
  const visible = new Set<string>();
  const walk = (n: TreeNode, trail: string[]) => {
    const e = n.entity;
    const self = e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q);
    const bm = e.behaviors.filter((b) => b.name.toLowerCase().includes(q) || b.expected.toLowerCase().includes(q));
    if (self) matches.add(e.id);
    if (bm.length) behaviorMatches.set(e.id, bm);
    if (self || bm.length) {
      visible.add(e.id);
      trail.forEach((t) => visible.add(t));
    }
    n.children.forEach((c) => walk(c, [...trail, e.id]));
  };
  roots.forEach((r) => walk(r, []));
  return { matches, behaviorMatches, visible };
}

export interface FilterResult {
  /** Entities that match on their own (all their behaviors are relevant). */
  matches: Set<string>;
  /** Matching behaviors per owner entity. */
  behaviorMatches: Map<string, { id: string; name: string; expected: string }[]>;
  /** Matches plus their ancestors. */
  visible: Set<string>;
}

/** Resolve a view filter against a tree: which entities stay visible and which behaviors matched. */
export function applyViewFilter(roots: TreeNode[], f: { entityIds: string[]; behaviorIds: string[] } | null): FilterResult | null {
  if (!f) return null;
  const ents = new Set(f.entityIds);
  const behs = new Set(f.behaviorIds);
  const matches = new Set<string>();
  const behaviorMatches: FilterResult['behaviorMatches'] = new Map();
  const visible = new Set<string>();
  const walk = (n: TreeNode, trail: string[]) => {
    const e = n.entity;
    const self = ents.has(e.id);
    const bm = e.behaviors.filter((b) => behs.has(b.id));
    if (self) matches.add(e.id);
    if (bm.length) behaviorMatches.set(e.id, bm);
    if (self || bm.length) {
      visible.add(e.id);
      trail.forEach((t) => visible.add(t));
    }
    n.children.forEach((c) => walk(c, [...trail, e.id]));
  };
  roots.forEach((r) => walk(r, []));
  return { matches, behaviorMatches, visible };
}

/** Keep only the visible nodes of a forest (structure preserved). */
export function pruneTree(roots: TreeNode[], visible: Set<string>): TreeNode[] {
  return roots.filter((n) => visible.has(n.entity.id)).map((n) => ({ entity: n.entity, children: pruneTree(n.children, visible) }));
}

export function descendantCount(contract: OrbitContract, id: string): number {
  return descendantIdsOf(contract, id).length;
}

export function relSentence(r: Pick<Relationship, 'type' | 'sourceId' | 'targetId'>, nameOf: (id: string) => string): string {
  return `${nameOf(r.sourceId)} ${REL_INFO[r.type].verb} ${nameOf(r.targetId)}`;
}

export function entityName(contracts: (OrbitContract | null | undefined)[], id: string): string {
  for (const c of contracts) {
    const e = c?.entities.find((x) => x.id === id);
    if (e) return e.name;
  }
  return id;
}

export type DropPosition = 'before' | 'after' | 'inside';

/**
 * Move an entity relative to another of the same kind. 'before'/'after' make it a sibling of the target
 * (adopting the target's parent); 'inside' makes it the last child of the target.
 * Returns the contract unchanged when the move is invalid or a no-op.
 */
export function moveEntity(contract: OrbitContract, id: string, targetId: string, pos: DropPosition): OrbitContract {
  if (id === targetId) return contract;
  const moving = contract.entities.find((e) => e.id === id);
  const target = contract.entities.find((e) => e.id === targetId);
  if (!moving || !target || moving.kind !== target.kind) return contract;
  const newParent = pos === 'inside' ? target.id : target.parentId;
  if (newParent !== null && wouldCreateCycle(contract, id, newParent)) return contract;
  const rest = contract.entities.filter((e) => e.id !== id);
  const moved = { ...moving, parentId: newParent };
  let at: number;
  if (pos === 'inside') {
    // after the target's last descendant in file order is not required; place after the last existing child, else after target
    const lastChild = rest.reduce((acc, e, i) => (e.parentId === target.id ? i : acc), -1);
    at = (lastChild >= 0 ? lastChild : rest.findIndex((e) => e.id === target.id)) + 1;
  } else {
    const ti = rest.findIndex((e) => e.id === target.id);
    at = pos === 'before' ? ti : ti + 1;
  }
  const entities = [...rest.slice(0, at), moved, ...rest.slice(at)];
  return { ...contract, entities };
}

/** Swap an entity with its previous/next sibling (same parent and kind). */
export function nudgeEntity(contract: OrbitContract, id: string, dir: -1 | 1): OrbitContract {
  const e = contract.entities.find((x) => x.id === id);
  if (!e) return contract;
  const sibs = contract.entities.filter((x) => x.kind === e.kind && x.parentId === e.parentId);
  const i = sibs.findIndex((x) => x.id === id);
  const other = sibs[i + dir];
  if (!other) return contract;
  return moveEntity(contract, id, other.id, dir < 0 ? 'before' : 'after');
}
