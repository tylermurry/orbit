import { behaviorIndex, entityById, descendantIdsOf, sameKindChildren } from './graph.js';
import type {
  AssuranceContext,
  AssuranceSummary,
  BehaviorAssurance,
  BehaviorStatus,
  Entity,
  Evidence,
  Freshness,
  OrbitContract,
  TestAssurance,
  TestDefinition,
} from './types.js';

// ───────────────────────── Per-test ─────────────────────────

const time = (e: Evidence): number => {
  const t = Date.parse(e.executedAt);
  return Number.isNaN(t) ? -Infinity : t;
};

/** Newest first; ties broken by evidence id (higher id is "later"). */
const newestFirst = (a: Evidence, b: Evidence): number => {
  const ta = time(a);
  const tb = time(b);
  if (ta !== tb) return ta < tb ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
};

interface Index {
  tests: Map<string, TestDefinition>;
  history: Map<string, Evidence[]>;
}

// Contracts are treated as immutable (the UI replaces rather than mutates them), so the index is cached per object.
const indexCache = new WeakMap<OrbitContract, Index>();

function indexOf(contract: OrbitContract): Index {
  let idx = indexCache.get(contract);
  if (idx) return idx;
  const tests = new Map<string, TestDefinition>();
  for (const t of contract.tests) if (!tests.has(t.id)) tests.set(t.id, t);
  const history = new Map<string, Evidence[]>();
  for (const e of contract.evidence) {
    const list = history.get(e.testId);
    if (list) list.push(e);
    else history.set(e.testId, [e]);
  }
  for (const list of history.values()) list.sort(newestFirst);
  idx = { tests, history };
  indexCache.set(contract, idx);
  return idx;
}

export function evidenceFreshness(evidence: Evidence, ctx: AssuranceContext): Freshness {
  if (ctx.inspectedCommit === null || evidence.commit === undefined) return 'unknown';
  return evidence.commit === ctx.inspectedCommit ? 'current' : 'stale';
}

function testAssuranceIn(idx: Index, testId: string, ctx: AssuranceContext): TestAssurance {
  const test = idx.tests.get(testId);
  const history = idx.history.get(testId) ?? [];
  const latestRecorded = history[0];
  const current = ctx.inspectedCommit === null ? undefined : history.find((e) => e.commit === ctx.inspectedCommit);
  return {
    testId,
    defined: test !== undefined,
    ...(test ? { test } : {}),
    ...(current ? { current } : {}),
    ...(latestRecorded ? { latestRecorded } : {}),
    freshness: latestRecorded ? evidenceFreshness(latestRecorded, ctx) : 'unknown',
    history: [...history],
  };
}

export function testAssurance(contract: OrbitContract, testId: string, ctx: AssuranceContext): TestAssurance {
  return testAssuranceIn(indexOf(contract), testId, ctx);
}

// ───────────────────────── Per-behavior ─────────────────────────

function statusOf(tests: TestAssurance[]): BehaviorStatus {
  const valid = tests.filter((t) => t.defined);
  if (valid.length === 0) return 'untested';
  if (valid.some((t) => t.current && (t.current.status === 'failed' || t.current.status === 'error'))) return 'failing';
  if (valid.some((t) => t.current?.status === 'passed')) return 'passing';
  return 'no-current-evidence';
}

function behaviorAssuranceIn(idx: Index, behaviorId: string, entity: Entity, testIds: string[], ctx: AssuranceContext): BehaviorAssurance {
  const tests = testIds.map((t) => testAssuranceIn(idx, t, ctx));
  return { behaviorId, entityId: entity.id, status: statusOf(tests), tests };
}

export function behaviorAssurance(contract: OrbitContract, behaviorId: string, ctx: AssuranceContext): BehaviorAssurance | undefined {
  const hit = behaviorIndex(contract).get(behaviorId);
  if (!hit) return undefined;
  return behaviorAssuranceIn(indexOf(contract), behaviorId, hit.entity, hit.behavior.testIds, ctx);
}

// ───────────────────────── Summaries ─────────────────────────

function emptySummary(): AssuranceSummary {
  return {
    total: 0,
    withTests: 0,
    passingCurrent: 0,
    failingCurrent: 0,
    untested: 0,
    noCurrentEvidence: 0,
    behaviorIds: { all: [], withTests: [], passingCurrent: [], failingCurrent: [], untested: [], noCurrentEvidence: [] },
  };
}

function addBehavior(s: AssuranceSummary, id: string, status: BehaviorStatus): void {
  s.behaviorIds.all.push(id);
  s.total++;
  if (status === 'untested') {
    s.behaviorIds.untested.push(id);
    s.untested++;
    return;
  }
  s.behaviorIds.withTests.push(id);
  s.withTests++;
  if (status === 'failing') {
    s.behaviorIds.failingCurrent.push(id);
    s.failingCurrent++;
  } else if (status === 'passing') {
    s.behaviorIds.passingCurrent.push(id);
    s.passingCurrent++;
  } else {
    s.behaviorIds.noCurrentEvidence.push(id);
    s.noCurrentEvidence++;
  }
}

function mergeInto(target: AssuranceSummary, src: AssuranceSummary): void {
  target.total += src.total;
  target.withTests += src.withTests;
  target.passingCurrent += src.passingCurrent;
  target.failingCurrent += src.failingCurrent;
  target.untested += src.untested;
  target.noCurrentEvidence += src.noCurrentEvidence;
  for (const k of Object.keys(target.behaviorIds) as (keyof AssuranceSummary['behaviorIds'])[]) {
    for (const id of src.behaviorIds[k]) target.behaviorIds[k].push(id);
  }
}

function behaviorStatuses(contract: OrbitContract, ctx: AssuranceContext): Map<string, BehaviorStatus> {
  const idx = indexOf(contract);
  const m = new Map<string, BehaviorStatus>();
  for (const e of contract.entities) {
    for (const b of e.behaviors) {
      if (m.has(b.id)) continue;
      m.set(b.id, statusOf(b.testIds.map((t) => testAssuranceIn(idx, t, ctx))));
    }
  }
  return m;
}

function summarize(contract: OrbitContract, entityId: string, statuses: Map<string, BehaviorStatus>): AssuranceSummary {
  const byId = entityById(contract);
  const summary = emptySummary();
  const root = byId.get(entityId);
  if (!root) return summary;
  const seen = new Set<string>();
  for (const id of [entityId, ...descendantIdsOf(contract, entityId)]) {
    for (const b of byId.get(id)!.behaviors) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      addBehavior(summary, b.id, statuses.get(b.id)!);
    }
  }
  return summary;
}

/** The entity's own behaviors plus those of all same-kind descendants, each behavior counted once. */
export function entityAssurance(contract: OrbitContract, entityId: string, ctx: AssuranceContext): AssuranceSummary {
  return summarize(contract, entityId, behaviorStatuses(contract, ctx));
}

/** Summary for every entity; one pass over the hierarchy with memoized subtree merges. */
export function computeAssurance(contract: OrbitContract, ctx: AssuranceContext): Map<string, AssuranceSummary> {
  const statuses = behaviorStatuses(contract, ctx);
  const result = new Map<string, AssuranceSummary>();
  const byId = entityById(contract);
  const behaviorCount = contract.entities.reduce((n, e) => n + e.behaviors.length, 0);
  const hasDuplicateBehaviors = statuses.size !== behaviorCount;
  const children = sameKindChildren(contract);

  // Iterative post-order from the roots of each same-kind tree.
  const hasSameKindParent = (e: Entity) => e.parentId !== null && byId.get(e.parentId)?.kind === e.kind;
  const roots = [...byId.values()].filter((e) => !hasSameKindParent(e));
  const order: Entity[] = [];
  const stack = [...roots];
  const visited = new Set<string>();
  while (stack.length) {
    const e = stack.pop()!;
    if (visited.has(e.id)) continue;
    visited.add(e.id);
    order.push(e);
    for (const c of children.get(e.id) ?? []) stack.push(c);
  }
  if (!hasDuplicateBehaviors) {
    // Children appear after parents in `order`, so walk it backwards. Pre-order of the result must be
    // own behaviors first, then each child's subtree in array order, matching entityAssurance.
    for (let i = order.length - 1; i >= 0; i--) {
      const e = order[i]!;
      const s = emptySummary();
      for (const b of e.behaviors) addBehavior(s, b.id, statuses.get(b.id)!);
      for (const c of children.get(e.id) ?? []) {
        const cs = result.get(c.id);
        if (cs) mergeInto(s, cs);
      }
      result.set(e.id, s);
    }
  }
  // Entities not reached (parent cycles) or contracts with duplicate behavior ids: slow, exact path.
  for (const e of byId.values()) {
    if (!result.has(e.id)) result.set(e.id, summarize(contract, e.id, statuses));
  }
  return result;
}
