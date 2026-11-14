import { ancestorsOf, behaviorIndex, potentialImpact, testAssurance } from '@orbit/contract';
import type { Change, ImpactPath, OrbitContract, SemanticDiff, TestAssurance } from '@orbit/contract';
import { shortSha } from '../../lib/format';
import { REL_INFO } from '../../lib/model';
import { proposalTag } from '../../host/types';
import { PRESET_LABELS, baseBranchFor, proposalRef, revKey, revLabel } from '../../state/compare';
import { currentText, isDirty } from '../../state/store';
import type { CompareResult, LifecyclePreset, RevSel } from '../../state/types';
import { actxOf, closest, entityCandidates, historyState, notFound, requireContract, slimDiagnostic, st } from './helpers';
import { resultsInfo } from './read';
import { S } from './schema';
import { ToolError } from './types';
import type { ToolContext, ToolDef } from './types';

const ann = (readOnly: boolean, idempotent = true) => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: idempotent, openWorldHint: false as const });
/** Status and latest result of one test, for tool output. */
const pick = (t: TestAssurance) => ({ status: t.status, ...(t.result ? { lastResult: { status: t.result.status, at: t.result.at, ...(t.result.message ? { message: t.result.message } : {}) } } : {}) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function needGit(ctx: ToolContext) {
  const g = st(ctx).git;
  if (!g?.available || !g.repoRoot || !g.relPath) {
    throw new ToolError(`Git is not available for the open file${g?.message ? ` (${g.message})` : ''}. Comparisons need the contract to be inside a git repository.`, {
      suggestions: ['Open a contract that lives in a git repository.'],
    });
  }
  return g;
}

function parseRev(ctx: ToolContext, raw: string): RevSel {
  const s = st(ctx);
  const v = raw.trim();
  if (v === 'working') return { type: 'working' };
  if (v === 'unsaved') return { type: 'unsaved' };
  if (v === 'baseline') {
    const branch = baseBranchFor(s.refs);
    if (!branch) throw new ToolError("There is no 'main' or 'master' branch to use as the baseline.", { suggestions: ['Pass a branch name as base instead, e.g. compare({ base: "develop", ... }).'] });
    return { type: 'baseline', branch };
  }
  if (v === 'proposal') {
    const p = proposalRef(s.git, s.refs);
    if (p) return { type: 'ref', name: p.name };
    // fall through: a branch literally called 'proposal' still works
    if (!s.refs.some((r) => r.name === 'proposal')) {
      throw new ToolError(`No proposal is recorded for ${s.git?.headBranch ? `branch '${s.git.headBranch}'` : 'a detached HEAD'}.`, { suggestions: ['Commit the proposed contract, then call mark_proposal.'] });
    }
  }
  const ref = s.refs.find((r) => r.name === v) ?? (v.toUpperCase() === 'HEAD' ? s.refs.find((r) => r.kind === 'head') : undefined);
  if (ref) return { type: 'ref', name: ref.kind === 'head' ? 'HEAD' : ref.name };
  if (/^[0-9a-f]{4,40}$/i.test(v)) return { type: 'sha', sha: v.toLowerCase() };
  // Git revision expressions (main~1, HEAD^, v1.0^{commit}, release/2.0@{1}) are resolved read-only by the
  // backend with `git rev-parse --verify`; an unresolvable one comes back as an actionable comparison error.
  if (/^[A-Za-z0-9._/@{}^~-]+$/.test(v) && !v.startsWith('-') && /[~^@]/.test(v)) return { type: 'ref', name: v };
  const near = closest(v, s.refs.map((r) => ({ id: r.name, name: r.subject })));
  throw new ToolError(`Cannot resolve revision '${v}'. Use 'working', 'unsaved', 'HEAD', a branch or tag name, or a commit sha.${near.length ? ` Closest refs: ${near.map((n) => n.id).join(', ')}.` : ''}`, {
    suggestions: ['list_git_refs shows the available branches and tags.'],
  });
}

async function awaitCompare(ctx: ToolContext, timeoutMs = 10_000): Promise<Exclude<CompareResult, { status: 'loading' }>> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = st(ctx).compareResult;
    if (r && r.status !== 'loading') return r;
    await sleep(15);
  }
  throw new ToolError('The comparison did not finish in time.', { suggestions: ['Call get_status to check the comparison state, then retry.'] });
}

function namer(diff: SemanticDiff) {
  const all = [...(diff.target?.entities ?? []), ...(diff.base?.entities ?? [])];
  return (id: string) => all.find((e) => e.id === id)?.name ?? id;
}

function impactRows(paths: ImpactPath[], nm: (id: string) => string, kind: (id: string) => string) {
  return paths.map((p) => ({
    id: p.entityId,
    name: nm(p.entityId),
    kind: kind(p.entityId),
    hops: p.path.length,
    via: p.path.map((step) => `${nm(step.sourceId)} ${REL_INFO[step.type].verb} ${nm(step.targetId)}`).join(' → '),
    changedEntityId: p.changedEntityId,
    changedEntityName: nm(p.changedEntityId),
  }));
}

const changeRow = (c: Change) => ({ key: c.key, category: c.category, kind: c.kind, label: c.label, group: c.group, entityIds: c.entityIds });

function describeCompare(ctx: ToolContext, r: Extract<CompareResult, { status: 'ready' }>) {
  const s = st(ctx);
  const d = r.diff;
  const nm = namer(d);
  const kindOf = (id: string) => [...(d.target?.entities ?? []), ...(d.base?.entities ?? [])].find((e) => e.id === id)?.kind ?? 'unknown';
  return {
    comparison: { base: s.compare ? revKey(s.compare.base) : null, target: s.compare ? revKey(s.compare.target) : null, label: s.compare ? `${revLabel(s.compare.base)} → ${revLabel(s.compare.target)}` : null, baseCommit: r.base.commit ? shortSha(r.base.commit) : undefined, targetCommit: r.target.commit ? shortSha(r.target.commit) : undefined },
    contractStatus: d.contractStatus,
    totalChanges: d.changes.length,
    guaranteeChanges: d.changes.filter((c) => c.group === 'guarantee').length,
    verificationChanges: d.changes.filter((c) => c.group === 'verification').length,
    totals: d.totals,
    directlyChanged: d.directlyChangedEntityIds.map((id) => ({ id, name: nm(id), kind: kindOf(id), status: d.entityStates[id]?.status, reasons: d.entityStates[id]?.reasons ?? [] })),
    potentiallyAffected: impactRows(d.potentiallyAffected, nm, kindOf),
    potentialNote: 'Potential impact is INFERRED from relationships (dependsOn/uses/implementedBy flow from changed targets to their sources); it is not observed breakage.',
    changes: d.changes.map(changeRow),
  };
}

export function navTools(): ToolDef[] {
  const tools: ToolDef[] = [];

  tools.push({
    kind: 'nav',
    tool: {
      name: 'navigate',
      title: 'Navigate the UI',
      description:
        "Move the human's view so they can follow along. view: 'product' (capabilities), 'engineering' (systems) or 'impact' (comparison). entityId selects that entity (the view follows its kind; its ancestors are expanded) and behaviorId additionally focuses a behavior. openRaw: true opens the Raw JSON editor. Does not change the document.",
      inputSchema: S.obj({
        view: S.oneOf(['product', 'engineering', 'impact'], 'Which view to show.'),
        entityId: S.nonEmpty('Entity to select.'),
        behaviorId: S.nonEmpty('Behavior to focus (its owner entity is selected automatically).'),
        openRaw: S.bool('Open the Raw JSON editor.'),
      }),
      annotations: ann(false),
    },
    run(a, ctx) {
      const s0 = st(ctx);
      if (!s0.filePath) throw new ToolError('No contract file is open.', { suggestions: ['Call open_file first.'] });
      const d = ctx.store.dispatch;
      if (a.openRaw === true) {
        d({ type: 'setRawMode', on: true });
        return { data: { view: 'raw' } };
      }
      const c: OrbitContract | null = s0.contract;
      const leavingRaw = s0.rawMode && s0.rawDraft !== null && s0.rawDraft !== currentText(s0);
      if (leavingRaw) throw new ToolError("The user has unapplied edits in the Raw JSON editor; navigating away would hide them. Nothing was changed.", { suggestions: ['set_raw_json with apply: true to apply a draft, or navigate with openRaw: true to stay in the editor.'] });
      if (!c) throw new ToolError('The open file is not valid JSON; only the Raw JSON editor is available.', { suggestions: ['navigate with openRaw: true, then repair with set_raw_json.'] });

      let entityId = a.entityId as string | undefined;
      const behaviorId = a.behaviorId as string | undefined;
      if (behaviorId) {
        const hit = behaviorIndex(c).get(behaviorId);
        if (!hit) throw notFound('Behavior', behaviorId, [...behaviorIndex(c).values()].map((x) => ({ id: x.behavior.id, name: x.behavior.name })));
        if (entityId && entityId !== hit.entity.id) throw new ToolError(`Behavior '${behaviorId}' belongs to '${hit.entity.id}', not '${entityId}'.`, { suggestions: [`Use entityId: '${hit.entity.id}' or omit entityId.`] });
        entityId = hit.entity.id;
      }
      if (entityId) {
        const e = c.entities.find((x) => x.id === entityId);
        if (!e) throw notFound('Entity', entityId, entityCandidates(c));
        const want = e.kind === 'capability' ? 'product' : 'engineering';
        if (a.view && a.view !== 'impact' && a.view !== want) throw new ToolError(`'${e.id}' is a ${e.kind}, which is shown in the ${want} view, not '${a.view}'.`, { suggestions: [`Use view: '${want}' or omit view.`] });
        d({ type: 'selectEntity', id: e.id, kind: e.kind, behaviorId: behaviorId ?? null });
        const expanded = { ...st(ctx).expanded };
        for (const x of ancestorsOf(c, e.id)) expanded[x.id] = true;
        ctx.ctrl.setExpanded(expanded);
      }
      if (a.view === 'impact') {
        d({ type: 'setRawMode', on: false });
        d({ type: 'setView', view: 'impact' });
        ctx.ctrl.ensureDefaultCompare();
      } else if (a.view) {
        d({ type: 'setRawMode', on: false });
        d({ type: 'setView', view: a.view as 'product' | 'engineering' });
      } else if (!entityId && s0.rawMode) {
        d({ type: 'setRawMode', on: false });
      }
      const s = st(ctx);
      return { data: { view: s.rawMode ? 'raw' : s.view, selection: { capability: s.selected.capability, system: s.selected.system, focusedBehaviorId: s.focusBehaviorId } } };
    },
  });

  tools.push({
    kind: 'nav',
    tool: {
      name: 'filter_view',
      title: "Filter the person's view",
      description:
        "Narrow what the person sees in the product / engineering trees to a set of entities and/or behaviors, with a yellow banner explaining the filter in plain English (the person can close it with its X). Use it when the person asks to be shown things, e.g. \"show me everything to do with overdue tasks\". YOU decide what is relevant: first use search / list_entities / get_entity to find the matching ids (think about meaning, not just substrings), then call this once with all of them. entityIds shows those entities with all their behaviors; behaviorIds shows only those behaviors under their owners. Ancestors stay visible for context. description is what the banner says: a short sentence describing what is shown, e.g. 'Showing capabilities and behaviors related to tasks becoming overdue.' view picks product (capabilities) or engineering (systems); by default the current view is kept when it has matches, otherwise the one that does. Replaces any previous filter. Does not change the document.",
      inputSchema: S.obj(
        {
          description: S.nonEmpty('Plain-English sentence for the banner describing what is shown.', { maxLength: 300 }),
          entityIds: S.strList('Entities (capabilities or systems) to show in full.'),
          behaviorIds: S.strList('Individual behaviors to show (their owners are shown too).'),
          view: S.oneOf(['product', 'engineering'], 'Which view to show (default: the current view if it has matches).'),
        },
        ['description'],
      ),
      annotations: ann(false),
    },
    run(a, ctx) {
      const c = requireContract(ctx);
      const entityIds = [...new Set((a.entityIds as string[] | undefined) ?? [])];
      const behaviorIds = [...new Set((a.behaviorIds as string[] | undefined) ?? [])];
      if (!entityIds.length && !behaviorIds.length) throw new ToolError('Pass at least one entityId or behaviorId to filter to.', { suggestions: ['Use search or list_entities to find relevant ids first. To remove a filter, call clear_filter.'] });
      const byId = new Map(c.entities.map((e) => [e.id, e]));
      const bIndex = behaviorIndex(c);
      for (const id of entityIds) if (!byId.has(id)) throw notFound('Entity', id, entityCandidates(c));
      for (const id of behaviorIds) if (!bIndex.has(id)) throw notFound('Behavior', id, [...bIndex.values()].map((x) => ({ id: x.behavior.id, name: x.behavior.name })));

      const kinds = { capability: 0, system: 0 };
      for (const id of entityIds) kinds[byId.get(id)!.kind]++;
      for (const id of behaviorIds) kinds[bIndex.get(id)!.entity.kind]++;
      const s0 = st(ctx);
      const current = s0.view === 'engineering' ? 'system' : 'capability';
      const kind = a.view ? (a.view === 'engineering' ? 'system' : 'capability') : s0.view !== 'impact' && kinds[current] > 0 ? current : kinds.capability >= kinds.system ? 'capability' : 'system';

      const d = ctx.store.dispatch;
      d({ type: 'setViewFilter', filter: { description: (a.description as string).trim(), entityIds, behaviorIds } });
      d({ type: 'setSearch', search: '' });
      if (!(s0.rawMode && s0.rawDraft !== null && s0.rawDraft !== currentText(s0))) d({ type: 'setRawMode', on: false });
      d({ type: 'setView', view: kind === 'capability' ? 'product' : 'engineering' });
      return {
        data: {
          view: kind === 'capability' ? 'product' : 'engineering',
          description: (a.description as string).trim(),
          shown: {
            entities: entityIds.map((id) => ({ id, name: byId.get(id)!.name, kind: byId.get(id)!.kind })),
            behaviors: behaviorIds.map((id) => ({ id, name: bIndex.get(id)!.behavior.name, ownerId: bIndex.get(id)!.entity.id })),
          },
          matchesPerView: { product: kinds.capability, engineering: kinds.system },
        },
        toast: 'Filtered the view',
      };
    },
  });

  tools.push({
    kind: 'nav',
    tool: {
      name: 'clear_filter',
      title: 'Clear the view filter',
      description: "Remove the filter set by filter_view (same as the person clicking the banner's X). No-op when there is none.",
      inputSchema: S.obj({}),
      annotations: ann(false),
    },
    run(_a, ctx) {
      const had = !!st(ctx).viewFilter;
      if (had) ctx.store.dispatch({ type: 'setViewFilter', filter: null });
      return { data: { cleared: had }, ...(had ? { toast: 'Cleared the view filter' } : {}) };
    },
  });

  tools.push({
    kind: 'file',
    tool: {
      name: 'run_tests',
      title: 'Run the test suite',
      description:
        "Run the contract's validation command (the whole test suite, see set_validation) and wait for it, then return each test's status from the results file. Only runs a command the person has approved in Orbit (Validate capabilities asks once per command); otherwise fails and asks them to. Alternatively run the same command yourself in a terminal: Orbit picks up the results file automatically whenever it changes. Statuses: passing / failing (a result at or after the proposal time), unconfirmed (no current result), planned (placeholder).",
      inputSchema: S.obj({ timeoutSeconds: S.int('Give up waiting after this many seconds (default 600). The run keeps going in Orbit.', { minimum: 5, maximum: 3600 }) }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const },
    },
    async run(a, ctx) {
      requireContract(ctx);
      const started = await ctx.ctrl.runValidation();
      if (started === 'not-configured') throw new ToolError('No test command is set up for this contract.', { suggestions: ["set_validation({ command: 'npm test', results: 'test-results/junit.xml' }) and save, then ask the person to approve it with Validate capabilities."] });
      if (started === 'needs-approval') {
        ctx.store.dispatch({ type: 'ui', patch: { runDialog: true } });
        throw new ToolError(`The person has not approved running '${st(ctx).contract!.validation!.command}' yet. Orbit opened Validate capabilities so they can approve it.`, { suggestions: ['Ask the person to click Run tests in Orbit, or run the command yourself in a terminal.'] });
      }
      if (started === 'busy') throw new ToolError('A test run is already in progress.', { suggestions: ['Wait for it, then call get_assurance or list_tests.'] });
      const deadline = Date.now() + ((a.timeoutSeconds as number | undefined) ?? 600) * 1000;
      while (st(ctx).run && Date.now() < deadline) await sleep(100);
      const s = st(ctx);
      if (s.run) throw new ToolError('The test run is still going.', { suggestions: ['Call list_tests later; the results update when the run finishes.'] });
      const last = s.lastRun;
      const c = s.contract!;
      const actx = actxOf(s);
      const tests = c.tests.map((t) => ({ id: t.id, name: t.name, ...pick(testAssurance(c, t.id, actx)) }));
      const count = (x: string) => tests.filter((t) => t.status === x).length;
      return {
        data: {
          exitCode: last?.exitCode ?? null,
          cancelled: !!last?.cancelled,
          durationMs: last?.durationMs ?? 0,
          output: last ? last.output.slice(-4000) : '',
          testResults: resultsInfo(s),
          totals: { passing: count('passing'), failing: count('failing'), unconfirmed: count('unconfirmed'), planned: count('planned') },
          failing: tests.filter((t) => t.status === 'failing'),
          unconfirmed: tests.filter((t) => t.status === 'unconfirmed').map((t) => ({ id: t.id, name: t.name })),
        },
        toast: last?.cancelled ? 'Test run cancelled' : `Ran the tests: ${count('passing')} passing, ${count('failing')} failing`,
      };
    },
  });

  tools.push({
    kind: 'read',
    tool: {
      name: 'list_git_refs',
      title: 'List git refs',
      description: 'Branches, tags and HEAD of the repository containing the open contract (read-only), for use with compare. Returns available: false with the reason when the file is not in a git repository.',
      inputSchema: S.obj({}),
      annotations: ann(true),
    },
    run(_a, ctx) {
      const s = st(ctx);
      if (!s.filePath) throw new ToolError('No contract file is open.');
      if (!s.git?.available) return { data: { available: false, reason: s.git?.unavailableReason ?? null, message: s.git?.message ?? 'Git context has not been loaded.', refs: [] } };
      return {
        data: {
          available: true,
          branch: s.git.headBranch ?? null,
          detached: !!s.git.detached,
          headCommit: s.git.headCommit ?? null,
          trackedAtHead: s.git.trackedAtHead,
          workingTreeDiffers: s.git.workingTreeDiffers,
          refs: s.refs.map((r) => ({ name: r.name, kind: r.kind, commit: r.commit, subject: r.subject, date: r.date })),
        },
      };
    },
  });

  tools.push({
    kind: 'nav',
    tool: {
      name: 'compare',
      title: 'Compare two revisions semantically',
      description:
        "Set the app's comparison (trees highlight added/modified/removed/potentially-affected entities) and return the semantic diff. base/target each: 'working' (saved file on disk), 'unsaved' (in-app edits), 'baseline' (where this branch left main/master), 'proposal' (this branch's proposal tag), 'HEAD', a branch or tag name, a commit sha, or a git revision expression such as 'main~1' or 'HEAD^'. Needs the file to be in a git repository. Returns totals per category, directly changed entities, potentially affected entities (with the relationship path), and the change list (use get_change for field-level before/after). Direct changes and inferred potential impact are always reported separately. show: true also switches the UI to the Impact view.",
      inputSchema: S.obj({ base: S.nonEmpty("Older side, e.g. 'HEAD' or 'main'."), target: S.nonEmpty("Newer side, e.g. 'unsaved' or 'working'."), show: S.bool('Also open the Impact view.') }, ['base', 'target']),
      annotations: ann(false),
    },
    async run(a, ctx) {
      requireContract(ctx);
      needGit(ctx);
      const cmp = { base: parseRev(ctx, a.base as string), target: parseRev(ctx, a.target as string) };
      ctx.ctrl.setCompare(cmp);
      ctx.store.dispatch({ type: 'setCompareResult', result: { status: 'loading' } });
      await ctx.ctrl.recomputeCompare();
      const r = await awaitCompare(ctx);
      if (a.show === true) {
        ctx.store.dispatch({ type: 'setRawMode', on: false });
        ctx.store.dispatch({ type: 'setView', view: 'impact' });
      }
      if (r.status === 'error') throw new ToolError(r.message, { suggestions: ['list_git_refs shows valid refs; the comparison stays selected in the UI - use clear_comparison to remove it.'] });
      if (r.status === 'blocked') {
        const bad = [r.base, r.target].filter((m) => m.invalid || !m.exists);
        throw new ToolError(`A semantic comparison is not possible because ${bad.map((m) => `${m.label} is not a valid contract`).join(' and ')}. Orbit never falls back to a text diff.`, {
          suggestions: ['Fix the invalid side first (get_diagnostics / set_raw_json), or choose another revision.'],
          data: { sides: bad.map((m) => ({ side: m.label, diagnostics: m.diagnostics.slice(0, 10).map(slimDiagnostic) })) },
        });
      }
      return { data: describeCompare(ctx, r) };
    },
  });

  tools.push({
    kind: 'file',
    tool: {
      name: 'mark_proposal',
      title: 'Mark the committed contract as the proposal',
      description:
        "Record the current commit as this feature branch's PROPOSAL by pointing the git tag orbit/proposal/<branch> at HEAD. This is the only git write Orbit makes; it never commits, stages or checks out. Workflow: propose the change by editing the contract, save_file, commit the contract yourself (git commit), then call mark_proposal. Refuses when the contract has unsaved or uncommitted changes, on a detached HEAD, on the base branch itself, or when a proposal tag already exists (pass replace: true to move it). show: true opens the 'View proposal' comparison afterwards.",
      inputSchema: S.obj({ replace: S.bool('Move an existing proposal tag to HEAD.'), show: S.bool("Open the 'View proposal' comparison.") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false as const },
    },
    async run(a, ctx) {
      requireContract(ctx);
      needGit(ctx);
      await ctx.ctrl.refreshGit(); // the AI usually just committed
      const s = st(ctx);
      const g = needGit(ctx);
      if (isDirty(s)) throw new ToolError('The contract has unsaved changes in Orbit. The proposal must be committed first.', { suggestions: ['save_file, commit the contract with git, then call mark_proposal again.'] });
      if (!g.headCommit) throw new ToolError('The repository has no commits yet.', { suggestions: ['Commit the proposed contract first.'] });
      if (!g.headBranch) throw new ToolError('HEAD is detached, so there is no feature branch to record a proposal for.', { suggestions: ['Check out (or create) the feature branch first.'] });
      const base = baseBranchFor(s.refs);
      if (base && g.headBranch === base) throw new ToolError(`You are on the base branch '${base}'. Proposals belong to a feature branch.`, { suggestions: ['Create a feature branch (git switch -c <name>), commit the proposal there, then call mark_proposal.'] });
      if (!g.trackedAtHead || g.workingTreeDiffers) throw new ToolError(`The contract file differs from what is committed at HEAD (${shortSha(g.headCommit)}), so HEAD is not the proposal.`, { suggestions: [`Commit ${g.relPath} first, then call mark_proposal again.`] });
      let res: { tag: string; commit: string; replaced: boolean };
      try {
        res = await ctx.host.gitTagProposal(g.repoRoot!, g.headBranch, a.replace === true);
      } catch (e) {
        throw new ToolError((e as Error).message, { suggestions: [`If the proposal was revised on purpose, call mark_proposal({ replace: true }).`] });
      }
      await ctx.ctrl.refreshGit();
      if (a.show === true) {
        ctx.ctrl.applyPreset('proposal', { quiet: true });
        ctx.store.dispatch({ type: 'setRawMode', on: false });
        ctx.store.dispatch({ type: 'setView', view: 'impact' });
      }
      return { data: { tag: res.tag, commit: res.commit, replaced: res.replaced, branch: g.headBranch, baseBranch: base }, toast: `${res.replaced ? 'Moved' : 'Marked'} proposal ${proposalTag(g.headBranch)} at ${shortSha(res.commit)}` };
    },
  });

  tools.push({
    kind: 'nav',
    tool: {
      name: 'view_changes',
      title: 'Show a product-owner change view',
      description:
        "One of the three views of a feature branch, as the person sees them: 'proposal' = baseline -> proposal (what was proposed), 'vs-proposal' = proposal -> latest (how the actual work differs from the proposal), 'actual' = baseline -> latest (everything that changed on the branch). Baseline is where the branch left main/master (git merge-base); latest is the working tree, or unsaved edits; the proposal is the tag set by mark_proposal. Returns the same result as compare. show: true opens the Impact view.",
      inputSchema: S.obj({ view: S.oneOf(['proposal', 'vs-proposal', 'actual'], 'Which view.'), show: S.bool('Also open the Impact view.') }, ['view']),
      annotations: ann(false),
    },
    async run(a, ctx) {
      requireContract(ctx);
      needGit(ctx);
      const preset = a.view as LifecyclePreset;
      const why = ctx.ctrl.applyPreset(preset, { quiet: true });
      if (why) throw new ToolError(why, { suggestions: preset === 'actual' ? ["compare({ base: '<branch>', target: 'working' })"] : ['Commit the proposed contract, then call mark_proposal.'] });
      ctx.store.dispatch({ type: 'setCompareResult', result: { status: 'loading' } });
      await ctx.ctrl.recomputeCompare();
      const r = await awaitCompare(ctx);
      if (a.show === true) {
        ctx.store.dispatch({ type: 'setRawMode', on: false });
        ctx.store.dispatch({ type: 'setView', view: 'impact' });
      }
      if (r.status === 'error') throw new ToolError(r.message);
      if (r.status === 'blocked') throw new ToolError('One side of this view is not a valid contract, so a semantic comparison is not possible.', { suggestions: ['get_diagnostics, or compare the sides individually.'] });
      return { data: { view: preset, label: PRESET_LABELS[preset], ...describeCompare(ctx, r) } };
    },
  });

  tools.push({
    kind: 'read',
    tool: {
      name: 'get_change',
      title: 'Get field-level change detail',
      description: "Field-level before/after for one change of the active comparison, by its key (from compare, e.g. 'behavior:behavior.x' or 'entity:cap.y'). Behavior moves report ownerBefore/ownerAfter.",
      inputSchema: S.obj({ key: S.nonEmpty("Change key '<category>:<id>' from the compare result.") }, ['key']),
      annotations: ann(true),
    },
    run(a, ctx) {
      const r = st(ctx).compareResult;
      if (!r || r.status !== 'ready') throw new ToolError('There is no ready comparison. Run compare first.', { suggestions: ["compare({ base: 'HEAD', target: 'unsaved' })"] });
      const ch = r.diff.changes.find((x) => x.key === a.key);
      if (!ch) {
        const near = closest(a.key as string, r.diff.changes.map((x) => ({ id: x.key, name: x.label })));
        throw new ToolError(`Change '${a.key}' is not part of the current comparison.${near.length ? ` Closest: ${near.map((n) => n.id).join(', ')}.` : ''}`, { suggestions: near.map((n) => n.id) });
      }
      return {
        data: {
          ...changeRow(ch),
          fields: ch.fields.map((f) => ({ field: f.field, before: f.before, after: f.after, ...(f.addedItems ? { addedItems: f.addedItems } : {}), ...(f.removedItems ? { removedItems: f.removedItems } : {}) })),
          ...(ch.kind === 'added' ? { after: ch.after } : {}),
          ...(ch.kind === 'removed' ? { before: ch.before } : {}),
          ...(ch.ownerBefore !== undefined ? { ownerBefore: ch.ownerBefore, ownerAfter: ch.ownerAfter } : {}),
        },
      };
    },
  });

  tools.push({
    kind: 'read',
    tool: {
      name: 'get_impact',
      title: 'Get potential impact',
      description:
        "Potential downstream impact. With entityIds: which entities would be potentially affected if THOSE entities changed, using the working contract's relationships (reverse traversal: sources that depend on/use/are implemented by a changed target, transitively) - ideal for 'what would this affect?' before editing. Without entityIds: the impact of the active comparison (directly changed vs potentially affected). Potential impact is inferred, never observed breakage.",
      inputSchema: S.obj({ entityIds: { type: 'array', items: { type: 'string', minLength: 1 }, minItems: 1, description: 'Entities that would change. Omit to use the active comparison.' } }),
      annotations: ann(true),
    },
    run(a, ctx) {
      const ids = a.entityIds as string[] | undefined;
      if (ids) {
        const c = requireContract(ctx);
        for (const id of ids) if (!c.entities.some((e) => e.id === id)) throw notFound('Entity', id, entityCandidates(c));
        const nm = (id: string) => c.entities.find((e) => e.id === id)?.name ?? id;
        const kind = (id: string) => c.entities.find((e) => e.id === id)?.kind ?? 'unknown';
        const paths = potentialImpact(c.relationships, ids);
        return { data: { changedEntities: ids.map((id) => ({ id, name: nm(id), kind: kind(id) })), potentiallyAffected: impactRows(paths, nm, kind), count: paths.length, note: 'Inferred from relationships; not observed breakage.' } };
      }
      const r = st(ctx).compareResult;
      if (!r || r.status !== 'ready') throw new ToolError('No comparison is active. Pass entityIds, or run compare first.', { suggestions: ["get_impact({ entityIds: ['cap.x'] })", "compare({ base: 'HEAD', target: 'unsaved' })"] });
      const nm = namer(r.diff);
      const kindOf = (id: string) => [...(r.diff.target?.entities ?? []), ...(r.diff.base?.entities ?? [])].find((e) => e.id === id)?.kind ?? 'unknown';
      return { data: { directlyChanged: r.diff.directlyChangedEntityIds.map((id) => ({ id, name: nm(id), kind: kindOf(id), reasons: r.diff.entityStates[id]?.reasons ?? [] })), potentiallyAffected: impactRows(r.diff.potentiallyAffected, nm, kindOf), count: r.diff.potentiallyAffected.length, note: 'Potentially affected is inferred from relationships; not observed breakage.' } };
    },
  });

  tools.push({
    kind: 'nav',
    tool: {
      name: 'clear_comparison',
      title: 'Clear the comparison',
      description: 'Remove the active comparison so trees stop highlighting changes.',
      inputSchema: S.obj({}),
      annotations: ann(false),
    },
    run(_a, ctx) {
      const had = !!st(ctx).compare;
      ctx.ctrl.setCompare(null);
      return { data: { cleared: had, history: historyState(st(ctx)) } };
    },
  });

  return tools;
}
