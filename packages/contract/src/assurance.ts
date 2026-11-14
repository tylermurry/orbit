import { behaviorIndex, entityById, descendantIdsOf, sameKindChildren } from './graph.js';
import type {
  AssuranceBucket,
  AssuranceContext,
  AssuranceSummary,
  BehaviorAssurance,
  BehaviorStatus,
  Entity,
  OrbitContract,
  TestAssurance,
  TestDefinition,
  TestResult,
  TestStatus,
} from './types.js';

// ───────────────────────── Per-test ─────────────────────────

// Contracts are treated as immutable (the UI replaces rather than mutates them), so the index is cached per object.
const testIndexCache = new WeakMap<OrbitContract, Map<string, TestDefinition>>();

function testsOf(contract: OrbitContract): Map<string, TestDefinition> {
  let m = testIndexCache.get(contract);
  if (!m) {
    m = new Map();
    for (const t of contract.tests) if (!m.has(t.id)) m.set(t.id, t);
    testIndexCache.set(contract, m);
  }
  return m;
}

/** Status of one result against the proposal time: only passed/failed results at or after `since` count. */
export function resultStatus(result: TestResult | undefined, since: string | null): TestStatus {
  if (!result || result.status === 'skipped') return 'unconfirmed';
  if (since !== null) {
    const at = Date.parse(result.at);
    const from = Date.parse(since);
    if (!Number.isNaN(from) && (Number.isNaN(at) || at < from)) return 'unconfirmed';
  }
  return result.status === 'passed' ? 'passing' : 'failing';
}

function testAssuranceIn(tests: Map<string, TestDefinition>, testId: string, ctx: AssuranceContext): TestAssurance {
  const test = tests.get(testId);
  const result = ctx.results.get(testId);
  const status: TestStatus = !test ? 'undefined' : test.placeholder ? 'planned' : resultStatus(result, ctx.since);
  return { testId, defined: test !== undefined, ...(test ? { test } : {}), status, ...(result ? { result } : {}) };
}

export function testAssurance(contract: OrbitContract, testId: string, ctx: AssuranceContext): TestAssurance {
  return testAssuranceIn(testsOf(contract), testId, ctx);
}

// ───────────────────────── Per-behavior ─────────────────────────

function statusOf(tests: TestAssurance[]): BehaviorStatus {
  const real = tests.filter((t) => t.status !== 'undefined' && t.status !== 'planned');
  if (real.length === 0) return tests.some((t) => t.status === 'planned') ? 'planned' : 'untested';
  if (real.some((t) => t.status === 'failing')) return 'failing';
  if (real.every((t) => t.status === 'passing')) return 'passing';
  return 'unconfirmed';
}

export function behaviorAssurance(contract: OrbitContract, behaviorId: string, ctx: AssuranceContext): BehaviorAssurance | undefined {
  const hit = behaviorIndex(contract).get(behaviorId);
  if (!hit) return undefined;
  const tests = testsOf(contract);
  const ts = hit.behavior.testIds.map((t) => testAssuranceIn(tests, t, ctx));
  return { behaviorId, entityId: hit.entity.id, status: statusOf(ts), tests: ts };
}

// ───────────────────────── Summaries ─────────────────────────

const BUCKETS: AssuranceBucket[] = ['all', 'withTests', 'passing', 'failing', 'unconfirmed', 'planned', 'untested'];

/** Behaviors that map at least one planned (placeholder) test, whatever their status. */
const plannedCache = new WeakMap<OrbitContract, Set<string>>();
function plannedBehaviorIds(contract: OrbitContract): Set<string> {
  let s = plannedCache.get(contract);
  if (!s) {
    const tests = testsOf(contract);
    s = new Set();
    for (const e of contract.entities) for (const b of e.behaviors) if (b.testIds.some((id) => tests.get(id)?.placeholder)) s.add(b.id);
    plannedCache.set(contract, s);
  }
  return s;
}

function emptySummary(): AssuranceSummary {
  return {
    total: 0,
    withTests: 0,
    passing: 0,
    failing: 0,
    unconfirmed: 0,
    planned: 0,
    withPlanned: 0,
    withPlannedIds: [],
    untested: 0,
    behaviorIds: Object.fromEntries(BUCKETS.map((b) => [b, []])) as unknown as Record<AssuranceBucket, string[]>,
  };
}

function addBehavior(s: AssuranceSummary, id: string, status: BehaviorStatus, withPlanned: boolean): void {
  s.behaviorIds.all.push(id);
  if (withPlanned) {
    s.withPlanned++;
    s.withPlannedIds.push(id);
  }
  s.total++;
  if (status === 'passing' || status === 'failing' || status === 'unconfirmed') {
    s.behaviorIds.withTests.push(id);
    s.withTests++;
  }
  s.behaviorIds[status].push(id);
  s[status]++;
}

function mergeInto(target: AssuranceSummary, src: AssuranceSummary): void {
  target.total += src.total;
  target.withTests += src.withTests;
  target.passing += src.passing;
  target.failing += src.failing;
  target.unconfirmed += src.unconfirmed;
  target.planned += src.planned;
  target.withPlanned += src.withPlanned;
  target.withPlannedIds.push(...src.withPlannedIds);
  target.untested += src.untested;
  for (const k of BUCKETS) for (const id of src.behaviorIds[k]) target.behaviorIds[k].push(id);
}

function behaviorStatuses(contract: OrbitContract, ctx: AssuranceContext): Map<string, BehaviorStatus> {
  const tests = testsOf(contract);
  const m = new Map<string, BehaviorStatus>();
  for (const e of contract.entities) {
    for (const b of e.behaviors) {
      if (m.has(b.id)) continue;
      m.set(b.id, statusOf(b.testIds.map((t) => testAssuranceIn(tests, t, ctx))));
    }
  }
  return m;
}

function summarize(contract: OrbitContract, entityId: string, statuses: Map<string, BehaviorStatus>): AssuranceSummary {
  const byId = entityById(contract);
  const planned = plannedBehaviorIds(contract);
  const summary = emptySummary();
  const root = byId.get(entityId);
  if (!root) return summary;
  const seen = new Set<string>();
  for (const id of [entityId, ...descendantIdsOf(contract, entityId)]) {
    for (const b of byId.get(id)!.behaviors) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      addBehavior(summary, b.id, statuses.get(b.id)!, planned.has(b.id));
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
  const planned = plannedBehaviorIds(contract);
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
      for (const b of e.behaviors) addBehavior(s, b.id, statuses.get(b.id)!, planned.has(b.id));
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
