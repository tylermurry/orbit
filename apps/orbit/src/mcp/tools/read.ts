import { ancestorsOf, behaviorAssurance, behaviorIndex, entityAssurance, focusedRelations, parseContract, serializeContract, testAssurance } from '@orbit/contract';
import type { AssuranceSummary, BehaviorAssurance, EntityKind, OrbitContract, TestAssurance } from '@orbit/contract';
import { buildTree, REL_INFO } from '../../lib/model';
import type { TreeNode } from '../../lib/model';
import { activePreset, baseBranchFor, revKey, revLabel } from '../../state/compare';
import { appliesTo } from '../../state/proposal';
import { currentText, isDirty, matchedResults, syncStatus } from '../../state/store';
import { resultsPathOf } from '../../state/controller';
import type { AppState } from '../../state/types';
import { actxOf, assuranceFor, clip, currentDiagnostics, diagCounts, entityCandidates, entityRef, historyState, notFound, requireContract, slimDiagnostic, st } from './helpers';
import { S } from './schema';
import { ToolError } from './types';
import type { ToolContext, ToolDef } from './types';

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const def = (name: string, title: string, description: string, inputSchema: Record<string, unknown>, run: ToolDef['run']): ToolDef => ({ kind: 'read', tool: { name, title, description, inputSchema, annotations: RO }, run });

export function slimAssurance(a: AssuranceSummary, withIds = false) {
  const { total, withTests, passing, failing, unconfirmed, planned, untested } = a;
  return { total, withTests, passing, failing, unconfirmed, planned, untested, ...(withIds ? { behaviorIds: a.behaviorIds } : {}) };
}

/** One test's status and latest result, for tool output. */
const slimTest = (t: TestAssurance) => ({
  id: t.testId,
  defined: t.defined,
  ...(t.test ? { name: t.test.name, location: t.test.location, ...(t.test.placeholder ? { placeholder: true } : {}) } : {}),
  status: t.status,
  ...(t.result ? { lastResult: { status: t.result.status, at: t.result.at, ...(t.result.message ? { message: t.result.message } : {}) } } : {}),
});

/** Where test results come from, how current they are, and how to refresh them. */
export function resultsInfo(s: AppState) {
  const f = s.resultsFile;
  const m = matchedResults(s);
  return {
    configured: !!s.contract?.validation,
    ...(s.contract?.validation ? { command: s.contract.validation.command, resultsFile: resultsPathOf(s) } : {}),
    state: f?.state ?? 'none',
    lastRunAt: f?.at ?? null,
    matchedTests: m.results.size,
    unmatchedCases: m.unmatchedCases,
    running: !!s.run,
    rule: 'The latest matching test result determines passing or failing. Missing or skipped results are unconfirmed.',
  };
}

function diffStates(s: AppState) {
  return s.compareResult?.status === 'ready' ? s.compareResult.diff.entityStates : null;
}

function describeBehavior(c: OrbitContract, ba: BehaviorAssurance, b: { id: string; name: string; expected: string }) {
  return {
    id: b.id,
    name: b.name,
    expected: b.expected,
    status: ba.status,
    tests: ba.tests.map((t) => ({
      id: t.testId,
      defined: t.defined,
      ...(t.test ? { name: t.test.name, location: t.test.location } : {}),
      status: t.status,
      ...(t.result ? { lastResult: { status: t.result.status, at: t.result.at, ...(t.result.message ? { message: t.result.message } : {}) } } : {}),
    })),
  };
}

export function readTools(): ToolDef[] {
  return [
    def(
      'get_status',
      'Get app status',
      "Snapshot of the whole app: open file, product, dirty/valid flags, diagnostics counts, read-only state, current view & selection, Raw JSON editor state, undo/redo availability, git context, active comparison, test results (where they come from and how current they are) and external-change state. Call this first to orient yourself.",
      S.obj({}),
      (_a, ctx) => {
        const s = st(ctx);
        const d = currentDiagnostics(s);
        const c = s.contract;
        const git = s.git;
        return {
          data: {
            file: s.filePath ? { path: s.filePath, name: s.filePath.split(/[\\/]/).pop() } : null,
            product: c ? { id: c.product.id, name: c.product.name, summary: c.product.summary } : null,
            dirty: isDirty(s),
            valid: !!s.filePath && !s.loadedInvalid && !!c && diagCounts(d.diagnostics).errors === 0,
            diagnostics: { source: d.source, ...diagCounts(d.diagnostics) },
            loadedInvalid: s.loadedInvalid,
            readOnly: s.loadedInvalid || (!!s.filePath && !c),
            view: s.rawMode || (!c && !!s.filePath) ? 'raw' : s.view,
            selection: { capability: s.selected.capability, system: s.selected.system, focusedBehaviorId: s.focusBehaviorId },
            viewFilter: s.viewFilter,
            raw: { mode: s.rawMode, hasUnappliedDraft: s.rawDraft !== null && s.rawDraft !== currentText(s) },
            history: historyState(s),
            git: git
              ? git.available
                ? { available: true, repoRoot: git.repoRoot, relPath: git.relPath, branch: git.headBranch ?? null, detached: !!git.detached, headCommit: git.headCommit ?? null, trackedAtHead: git.trackedAtHead, workingTreeDiffers: git.workingTreeDiffers, baseBranch: baseBranchFor(s.refs), proposal: appliesTo(s.proposalFile?.proposal, git) ? { baseline: s.proposalFile.proposal.baseline, revision: s.proposalFile.proposal.draft.revision, approvedRevision: s.proposalFile.proposal.approved?.revision ?? null } : null, sync: syncStatus(s) }
                : { available: false, reason: git.unavailableReason, message: git.message }
              : null,
            refsCount: s.refs.length,
            comparison: s.compare ? { base: revKey(s.compare.base), target: revKey(s.compare.target), label: `${revLabel(s.compare.base)} → ${revLabel(s.compare.target)}`, view: activePreset(s.compare, s.git, s.refs, s.proposalFile), status: s.compareResult?.status ?? 'loading' } : null,
            testResults: resultsInfo(s),
            externalChange: s.externalChange ? { kind: s.externalChange.kind, path: s.externalChange.stat.path } : null,
            counts: c
              ? {
                  capabilities: c.entities.filter((e) => e.kind === 'capability').length,
                  systems: c.entities.filter((e) => e.kind === 'system').length,
                  behaviors: c.entities.reduce((n, e) => n + e.behaviors.length, 0),
                  relationships: c.relationships.length,
                  tests: c.tests.length,
                  placeholderTests: c.tests.filter((t) => t.placeholder).length,
                }
              : null,
          },
        };
      },
    ),

    def(
      'get_contract',
      'Get the contract JSON',
      "Return the full contract as canonical JSON (product, entities with behaviors, relationships, tests, validation). source 'working' (default) is the in-memory version including unsaved edits; 'disk' is the last saved version on disk. Can be large - prefer list_entities/get_entity for exploration.",
      S.obj({ source: S.oneOf(['working', 'disk'], "'working' (default, includes unsaved edits) or 'disk'.") }),
      (a, ctx) => {
        const s = st(ctx);
        if (!s.filePath) throw new ToolError('No contract file is open.', { suggestions: ['Call open_file first.'] });
        if (a.source === 'disk') {
          const p = parseContract(s.diskText);
          if (!p.ok || !p.contract) throw new ToolError('The version on disk is not a valid contract.', { data: { diagnostics: p.diagnostics.slice(0, 20).map(slimDiagnostic) }, suggestions: ['Use get_raw_json for the exact text.'] });
          return { data: { source: 'disk', path: s.filePath, contract: JSON.parse(serializeContract(p.contract)) } };
        }
        const c = requireContract(ctx);
        return { data: { source: 'working', path: s.filePath, dirty: isDirty(s), readOnlyPartial: s.loadedInvalid, contract: JSON.parse(serializeContract(c)) } };
      },
    ),

    def(
      'list_entities',
      'List capabilities and systems',
      "List entities in tree order (capabilities first, then systems; siblings sorted by name) with depth, parentId, own behavior count and subtree assurance counts (passing/failing/unconfirmed/planned/untested from the latest test results). When a comparison is active each row carries diffStatus (added/modified/affected/unchanged). Filters: kind; parentId (only that entity's descendants); query (case-insensitive match on name, id or summary).",
      S.obj({ kind: S.oneOf(['capability', 'system'], 'Only this kind.'), parentId: S.nonEmpty('Only descendants of this entity.'), query: S.nonEmpty('Substring filter on name/id/summary.'), limit: S.int('Max rows (default 200).', { minimum: 1, maximum: 1000 }) }),
      (a, ctx) => {
        const c = requireContract(ctx);
        const s = st(ctx);
        const asr = assuranceFor(c, actxOf(s));
        const states = diffStates(s);
        let allowed: Set<string> | null = null;
        if (a.parentId) {
          const root = c.entities.find((e) => e.id === a.parentId);
          if (!root) throw notFound('Entity', a.parentId as string, entityCandidates(c));
          allowed = new Set<string>();
          const stack = [root.id];
          while (stack.length) {
            const id = stack.pop()!;
            for (const e of c.entities) {
              if (e.parentId === id && !allowed.has(e.id)) {
                allowed.add(e.id);
                stack.push(e.id);
              }
            }
          }
        }
        const q = typeof a.query === 'string' ? a.query.toLowerCase() : '';
        const rows: Record<string, unknown>[] = [];
        const kinds: EntityKind[] = a.kind ? [a.kind as EntityKind] : ['capability', 'system'];
        const walk = (n: TreeNode, depth: number) => {
          const e = n.entity;
          const match = (!allowed || allowed.has(e.id)) && (!q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || e.summary.toLowerCase().includes(q));
          if (match) {
            const as = asr.get(e.id);
            rows.push({
              id: e.id,
              kind: e.kind,
              name: e.name,
              summary: e.summary,
              depth,
              parentId: e.parentId,
              childCount: n.children.length,
              behaviorCount: e.behaviors.length,
              assurance: as ? slimAssurance(as) : undefined,
              ...(states?.[e.id] ? { diffStatus: states[e.id].status, diffReasons: states[e.id].reasons } : {}),
            });
          }
          n.children.forEach((k) => walk(k, depth + 1));
        };
        for (const kind of kinds) buildTree(c, kind).forEach((r) => walk(r, 0));
        const limit = (a.limit as number | undefined) ?? 200;
        return { data: { total: rows.length, truncated: rows.length > limit, entities: rows.slice(0, limit), comparing: !!states } };
      },
    ),

    def(
      'get_entity',
      'Get one entity in full',
      "Everything about a capability/system: fields, ancestors, children, its own behaviors with each test's status and latest result, subtree assurance (with behavior ids per bucket for drill-down), and incoming/outgoing relationships naming the other entity. Includes diff status when a comparison is active.",
      S.obj({ id: S.nonEmpty('Entity id (e.g. cap.task-organization.custom-lists).') }, ['id']),
      (a, ctx) => {
        const c = requireContract(ctx);
        const s = st(ctx);
        const e = c.entities.find((x) => x.id === a.id);
        if (!e) throw notFound('Entity', a.id as string, entityCandidates(c));
        const actx = actxOf(s);
        const rel = focusedRelations(c, e.id);
        const nm = (id: string) => entityRef(c, id);
        const mapRel = (r: (typeof rel.incoming)[number], dir: 'incoming' | 'outgoing') => ({
          id: r.id,
          type: r.type,
          description: r.description,
          sentence: dir === 'outgoing' ? `${e.name} ${REL_INFO[r.type].verb} ${nm(r.targetId).name}` : `${nm(r.sourceId).name} ${REL_INFO[r.type].verb} ${e.name}`,
          other: dir === 'outgoing' ? nm(r.targetId) : nm(r.sourceId),
        });
        const states = diffStates(s);
        return {
          data: {
            entity: { id: e.id, kind: e.kind, name: e.name, summary: e.summary, description: e.description, parentId: e.parentId },
            ancestors: ancestorsOf(c, e.id).reverse().map((x) => ({ id: x.id, name: x.name })),
            children: c.entities.filter((x) => x.parentId === e.id).map((x) => ({ id: x.id, name: x.name, kind: x.kind, behaviorCount: x.behaviors.length })),
            behaviors: e.behaviors.map((b) => describeBehavior(c, behaviorAssurance(c, b.id, actx)!, b)),
            subtreeAssurance: slimAssurance(entityAssurance(c, e.id, actx), true),
            relationships: { outgoing: rel.outgoing.map((r) => mapRel(r, 'outgoing')), incoming: rel.incoming.map((r) => mapRel(r, 'incoming')) },
            ...(states?.[e.id] ? { diff: { status: states[e.id].status, reasons: states[e.id].reasons, changedDescendants: states[e.id].changedDescendants } } : {}),
          },
        };
      },
    ),

    def(
      'search',
      'Search entities, behaviors and tests',
      "Case-insensitive substring search over entity name/id, behavior name/expected text and test name/location/id. Returns ids you can pass to get_entity/navigate.",
      S.obj({ query: S.nonEmpty('Text to find.'), limit: S.int('Max results per group (default 25).', { minimum: 1, maximum: 200 }) }, ['query']),
      (a, ctx) => {
        const c = requireContract(ctx);
        const q = (a.query as string).toLowerCase();
        const limit = (a.limit as number | undefined) ?? 25;
        const entities = c.entities.filter((e) => e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q));
        const behaviors = [...behaviorIndex(c).values()].filter(({ behavior: b }) => b.name.toLowerCase().includes(q) || b.expected.toLowerCase().includes(q));
        const tests = c.tests.filter((t) => t.name.toLowerCase().includes(q) || t.location.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
        return {
          data: {
            entities: entities.slice(0, limit).map((e) => ({ id: e.id, kind: e.kind, name: e.name, summary: e.summary })),
            behaviors: behaviors.slice(0, limit).map(({ behavior: b, entity }) => ({ id: b.id, name: b.name, expected: clip(b.expected, 160), entityId: entity.id, entityName: entity.name })),
            tests: tests.slice(0, limit).map((t) => ({ id: t.id, name: t.name, location: t.location })),
            totals: { entities: entities.length, behaviors: behaviors.length, tests: tests.length },
          },
        };
      },
    ),

    def(
      'get_assurance',
      'Get verification assurance',
      "Assurance (how well behaviors are verified) for one entity's subtree or the whole product. Test status comes from the latest test results (run_tests or the person's Validate capabilities): a behavior is 'passing' when all its real tests passed, 'failing' when any failed, 'unconfirmed' when some test has no current result, 'planned' when it only has placeholder tests, 'untested' with no tests. Returns counts plus the per-behavior status list.",
      S.obj({ entityId: S.nonEmpty('Entity id; omit for the whole product.') }),
      (a, ctx) => {
        const c = requireContract(ctx);
        const s = st(ctx);
        const actx = actxOf(s);
        const asr = assuranceFor(c, actx);
        let behaviorIds: string[];
        let summary: AssuranceSummary | null = null;
        if (a.entityId) {
          if (!c.entities.some((e) => e.id === a.entityId)) throw notFound('Entity', a.entityId as string, entityCandidates(c));
          summary = entityAssurance(c, a.entityId as string, actx);
          behaviorIds = summary.behaviorIds.all;
        } else {
          behaviorIds = c.entities.flatMap((e) => e.behaviors.map((b) => b.id));
        }
        const idx = behaviorIndex(c);
        const list = behaviorIds.map((id) => {
          const ba = behaviorAssurance(c, id, actx)!;
          const b = idx.get(id)!;
          return { id, name: b.behavior.name, entityId: b.entity.id, status: ba.status };
        });
        const count = (x: string) => list.filter((b) => b.status === x).length;
        const totals = summary
          ? slimAssurance(summary, true)
          : { total: list.length, withTests: count('passing') + count('failing') + count('unconfirmed'), passing: count('passing'), failing: count('failing'), unconfirmed: count('unconfirmed'), planned: count('planned'), untested: count('untested') };
        const roots = c.entities.filter((e) => !e.parentId).map((e) => ({ id: e.id, name: e.name, kind: e.kind, ...slimAssurance(asr.get(e.id)!) }));
        return { data: { scope: a.entityId ?? 'product', testResults: resultsInfo(s), ...totals, behaviors: list, ...(a.entityId ? {} : { topLevel: roots }) } };
      },
    ),

    def(
      'list_tests',
      'List test definitions',
      'List implemented test definitions with their behaviors and status from the latest test results. unmapped: true shows only tests no behavior references; status filters by status.',
      S.obj({ query: S.nonEmpty('Substring filter on id/name/location.'), unmapped: S.bool('Only tests mapped to no behavior.'), status: S.oneOf(['passing', 'failing', 'unconfirmed', 'planned'], 'Only tests with this status.'), limit: S.int('Max rows (default 200).', { minimum: 1, maximum: 1000 }) }),
      (a, ctx) => {
        const c = requireContract(ctx);
        const s = st(ctx);
        const actx = actxOf(s);
        const q = typeof a.query === 'string' ? a.query.toLowerCase() : '';
        const idx = [...behaviorIndex(c).values()];
        let rows = c.tests.map((t) => {
          const mapped = idx.filter(({ behavior }) => behavior.testIds.includes(t.id)).map(({ behavior, entity }) => ({ behaviorId: behavior.id, behaviorName: behavior.name, entityId: entity.id }));
          return { ...slimTest(testAssurance(c, t.id, actx)), placeholder: !!t.placeholder, mappedBehaviors: mapped };
        });
        if (q) rows = rows.filter((r) => `${r.id} ${r.name} ${r.location}`.toLowerCase().includes(q));
        if (a.unmapped) rows = rows.filter((r) => r.mappedBehaviors.length === 0);
        if (a.status) rows = rows.filter((r) => r.status === a.status);
        const limit = (a.limit as number | undefined) ?? 200;
        return { data: { total: rows.length, truncated: rows.length > limit, tests: rows.slice(0, limit), testResults: resultsInfo(s) } };
      },
    ),

    def(
      'get_diagnostics',
      'Get validation diagnostics',
      "Validation problems (errors and warnings, with codes, JSON paths, line/column) for the text the user sees: their unapplied Raw JSON draft if any, else the working contract, else the on-disk text of an invalid file.",
      S.obj({}),
      (_a, ctx: ToolContext) => {
        const d = currentDiagnostics(st(ctx));
        return { data: { source: d.source, ...diagCounts(d.diagnostics), diagnostics: d.diagnostics.map(slimDiagnostic) } };
      },
    ),
  ];
}
