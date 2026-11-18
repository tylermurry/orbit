import { flowsThrough } from '@orbit/contract';
import type { Entity, Flow, OrbitContract, Relationship } from '@orbit/contract';
import { REL_INFO, relSentence } from './model';

export const USER_LANE = 'user';

export interface FlowLane {
  /** Entity id, or USER_LANE for the person starting the flow. */
  id: string;
  name: string;
  kind: 'user' | 'capability' | 'system';
  /** false when the entity no longer exists. */
  known: boolean;
}

export interface FlowMessage {
  /** 0 is the trigger; n is the n-th step. */
  index: number;
  /** Step id, or null for the trigger. */
  stepId: string | null;
  from: string;
  to: string;
  /** Text for the arrow: the step's own label, else the relationship verb (or "replies"). */
  verb: string;
  description: string;
  reply: boolean;
  relationship: Relationship | null;
  /** The step's relationship is missing (or one of its ends is). */
  broken: boolean;
  /** Plain sentence for the relationship ("Add Task is implemented by Task Store"), or the missing id. */
  sentence: string;
}

export interface FlowScene {
  lanes: FlowLane[];
  messages: FlowMessage[];
}

/** Lanes: User, the capability, then entities in order of first appearance. Pure and tolerant of broken references. */
export function flowScene(contract: OrbitContract, flow: Flow): FlowScene {
  const entities = new Map<string, Entity>(contract.entities.map((e) => [e.id, e]));
  const rels = new Map<string, Relationship>(contract.relationships.map((r) => [r.id, r]));
  const nameOf = (id: string) => entities.get(id)?.name ?? id;
  const lanes: FlowLane[] = [{ id: USER_LANE, name: 'User', kind: 'user', known: true }];
  const seen = new Set<string>([USER_LANE]);
  const lane = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const e = entities.get(id);
    lanes.push({ id, name: nameOf(id), kind: e?.kind ?? 'system', known: !!e });
  };
  lane(flow.capabilityId);
  const messages: FlowMessage[] = [
    {
      index: 0, stepId: null, from: USER_LANE, to: flow.capabilityId, verb: 'triggers', description: flow.trigger, reply: false,
      relationship: null, broken: false, sentence: `User triggers ${nameOf(flow.capabilityId)}`,
    },
  ];
  flow.steps.forEach((step, i) => {
    const r = rels.get(step.relationshipId) ?? null;
    const reply = step.reply === true;
    const broken = !r || !entities.has(r.sourceId) || !entities.has(r.targetId);
    if (!r) {
      messages.push({ index: i + 1, stepId: step.id, from: flow.capabilityId, to: flow.capabilityId, verb: step.label ?? (reply ? 'replies' : ''), description: step.description, reply, relationship: null, broken: true, sentence: `Missing relationship '${step.relationshipId}'` });
      return;
    }
    const from = reply ? r.targetId : r.sourceId;
    const to = reply ? r.sourceId : r.targetId;
    lane(from);
    lane(to);
    messages.push({ index: i + 1, stepId: step.id, from, to, verb: step.label ?? (reply ? 'replies' : REL_INFO[r.type].verb), description: step.description, reply, relationship: r, broken, sentence: relSentence(r, nameOf) });
  });
  return { lanes, messages };
}

/** Flows grouped under their root capability (walking parentId), roots in contract order; flows keep contract order. */
export function groupFlows(contract: OrbitContract): { root: Entity | null; rootId: string; flows: Flow[] }[] {
  const entities = new Map<string, Entity>(contract.entities.map((e) => [e.id, e]));
  const rootOf = (id: string): string => {
    const seen = new Set<string>([id]);
    let cur = id;
    for (;;) {
      const parent = entities.get(cur)?.parentId;
      if (!parent || !entities.has(parent) || seen.has(parent)) return cur;
      seen.add(parent);
      cur = parent;
    }
  };
  const groups = new Map<string, Flow[]>();
  for (const f of contract.flows ?? []) {
    const root = rootOf(f.capabilityId);
    const list = groups.get(root);
    if (list) list.push(f);
    else groups.set(root, [f]);
  }
  const order = new Map(contract.entities.map((e, i) => [e.id, i]));
  return [...groups]
    .sort(([a], [b]) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity))
    .map(([rootId, flows]) => ({ root: entities.get(rootId) ?? null, rootId, flows }));
}

/** Index of the first step of `flow` that runs along the relationship (1-based step number), or 0. */
export function firstStepUsing(flow: Flow, relationshipId: string): number {
  const i = flow.steps.findIndex((s) => s.relationshipId === relationshipId);
  return i < 0 ? 0 : i + 1;
}

/** Index of the first step touching the entity (1-based), or 0 (the trigger) when it owns the flow or none match. */
export function firstStepThrough(contract: OrbitContract, flow: Flow, entityId: string): number {
  const rels = new Map(contract.relationships.map((r) => [r.id, r]));
  const i = flow.steps.findIndex((s) => {
    const r = rels.get(s.relationshipId);
    return !!r && (r.sourceId === entityId || r.targetId === entityId);
  });
  return i < 0 ? 0 : i + 1;
}

export { flowsThrough };
