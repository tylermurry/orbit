import { descendantIdsOf } from '@orbit/contract';
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
  passing: 'Has passing evidence',
  'no-current-evidence': 'Mapped, no current evidence',
  untested: 'No tests',
};

export const EVIDENCE_LABEL: Record<string, string> = { passed: 'Passed', failed: 'Failed', skipped: 'Skipped', error: 'Error' };

export interface TreeNode {
  entity: Entity;
  ghost: boolean;
  children: TreeNode[];
}

/** Build a forest of the given kind. `ghosts` are entities not present in `contract` (rendered read-only). */
export function buildTree(contract: OrbitContract, kind: EntityKind, ghosts: Entity[] = []): TreeNode[] {
  const all = [...contract.entities.filter((e) => e.kind === kind).map((e) => ({ e, ghost: false })), ...ghosts.filter((e) => e.kind === kind).map((e) => ({ e, ghost: true }))];
  const ids = new Set(all.map((x) => x.e.id));
  const nodes = new Map<string, TreeNode>(all.map((x) => [x.e.id, { entity: x.e, ghost: x.ghost, children: [] }]));
  const roots: TreeNode[] = [];
  for (const { e } of all) {
    const node = nodes.get(e.id)!;
    if (e.parentId && ids.has(e.parentId) && e.parentId !== e.id) nodes.get(e.parentId)!.children.push(node);
    else roots.push(node);
  }
  const sort = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.entity.name.localeCompare(b.entity.name));
    arr.forEach((n) => sort(n.children));
  };
  sort(roots);
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
    const bm = n.ghost ? [] : e.behaviors.filter((b) => b.name.toLowerCase().includes(q) || b.expected.toLowerCase().includes(q));
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
