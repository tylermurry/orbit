import { serializeContract } from '@orbit/contract';
import type { AssuranceContext, Diagnostic, EntityKind, OrbitContract, ParseResult, TestDefinition } from '@orbit/contract';
import type { GitContext, GitRef } from '../host/types';
import { matchResults } from '../lib/junit';
import { applyViewFilter, buildTree } from '../lib/model';
import { loadPref } from '../lib/prefs';
import type { JUnitCase, MatchedResults } from '../lib/junit';
import type { PlanFile } from './plan';
import type { AppState, CompareResult, Comparison, EngineeringTab, Prompt, ResultsFile, ReviewState, RunState, ViewFilter, ViewId } from './types';

const canonCache = new WeakMap<OrbitContract, string>();
export function canon(c: OrbitContract | null): string {
  if (!c) return '';
  let s = canonCache.get(c);
  if (s === undefined) {
    s = serializeContract(c);
    canonCache.set(c, s);
  }
  return s;
}

export const TERMINAL_OPEN_KEY = 'orbit.layout.terminalOpen';

export function initialState(): AppState {
  return {
    filePath: null,
    diskText: '',
    diskSha: null,
    savedContract: null,
    contract: null,
    loadedInvalid: false,
    rawDraft: null,
    undo: [],
    redo: [],
    externalChange: null,
    git: null,
    refs: [],
    planFile: null,
    view: 'product',
    explorerView: 'product',
    engineeringTab: 'systems',
    architectureFocusId: null,
    rawMode: false,
    selected: { capability: null, system: null },
    focusBehaviorId: null,
    focusBehaviorIds: [],
    expanded: {},
    search: '',
    viewFilter: null,
    compare: null,
    compareResult: null,
    impactSelection: null,
    resultsFile: null,
    walkthroughs: null,
    run: null,
    lastRun: null,
    terminalTab: 'claude',
    validateRun: 0,
    diagnosticsOpen: false,
    libraryOpen: false,
    libraryFocusTest: null,
    productDialog: false,
    newDialog: false,
    shortcutsOpen: false,
    terminalOpen: loadPref<boolean>(TERMINAL_OPEN_KEY, false),
    prompt: null,
    review: null,
    toasts: [],
    recent: [],
    bannerNote: null,
  };
}

// ───────────── derived values ─────────────

export function syncStatus(s: AppState) {
  const branch = s.git?.headBranch;
  const tag = branch ? `orbit/sync/${branch}` : null;
  const commit = s.refs.find((ref) => ref.kind === 'tag' && ref.name === tag)?.commit ?? null;
  const current = !!commit && commit === s.git?.headCommit && s.git?.implementationDirty === false && !isDirty(s);
  return { tag, commit, current };
}

export function structuredDirty(s: AppState): boolean {
  if (s.loadedInvalid || !s.contract) return false;
  if (!s.savedContract) return true;
  return canon(s.contract) !== canon(s.savedContract);
}

export function isDirty(s: AppState): boolean {
  if (s.rawDraft !== null && s.rawDraft !== currentText(s)) return true;
  return structuredDirty(s);
}

/** The text the raw editor starts from when there is no unapplied draft. */
export function currentText(s: AppState): string {
  if (!s.contract || s.loadedInvalid) return s.diskText;
  return structuredDirty(s) ? canon(s.contract) : s.diskText || canon(s.contract);
}

// Matching is redone only when the contract's tests or the results file change.
let matchMemo: { tests: TestDefinition[]; cases: JUnitCase[]; at: string; out: MatchedResults } | null = null;
const NO_MATCH: MatchedResults = { results: new Map(), unmatchedCases: 0, unmatched: [] };

/** The latest result per contract test, matched from the results file. */
export function matchedResults(s: AppState): MatchedResults {
  const f = s.resultsFile;
  if (!s.contract || !f || f.state !== 'ok' || !f.at) return NO_MATCH;
  const m = matchMemo;
  if (m && m.tests === s.contract.tests && m.cases === f.cases && m.at === f.at) return m.out;
  const out = matchResults(s.contract.tests, f.cases, f.at);
  matchMemo = { tests: s.contract.tests, cases: f.cases, at: f.at, out };
  return out;
}

let ctxMemo: AssuranceContext | null = null;
/** Stable assurance context for the actual product. */
export function assuranceContext(s: AppState): AssuranceContext {
  const results = matchedResults(s).results;
  if (ctxMemo?.results === results) return ctxMemo;
  ctxMemo = { results, since: null, actual: true };
  return ctxMemo;
}

/** The view filter, kept only while the given entity stays visible under it (selecting a hidden entity drops it). */
function filterKeeping(s: AppState, id: string, kind: EntityKind): AppState['viewFilter'] {
  if (!s.viewFilter || !s.contract) return s.viewFilter;
  return applyViewFilter(buildTree(s.contract, kind), s.viewFilter)?.visible.has(id) ? s.viewFilter : null;
}

export function canUndo(s: AppState): boolean {
  return s.undo.length > 0 && !s.loadedInvalid;
}

// ───────────── actions ─────────────

export type Action =
  | { type: 'loaded'; path: string; text: string; sha: string | null; parse: ParseResult; git: GitContext | null; refs: GitRef[]; planFile?: PlanFile | null; keepContext: boolean; expanded?: Record<string, boolean> }
  | { type: 'edit'; fn: (c: OrbitContract) => OrbitContract }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setView'; view: ViewId }
  | { type: 'setEngineeringTab'; tab: EngineeringTab }
  | { type: 'setArchitectureFocus'; id: string | null }
  | { type: 'showArchitecture'; id: string }
  | { type: 'selectEntity'; id: string; kind: EntityKind; behaviorId?: string | null }
  | { type: 'focusBehaviors'; id: string; kind: EntityKind; behaviorIds: string[] }
  | { type: 'clearFocusBehavior' }
  | { type: 'setRawMode'; on: boolean }
  | { type: 'setRawDraft'; text: string | null }
  | { type: 'applyRaw'; parse: ParseResult }
  | { type: 'saved'; text: string; sha: string; parse: ParseResult; path?: string }
  | { type: 'externalChange'; change: AppState['externalChange'] }
  | { type: 'setGit'; git: GitContext | null; refs: GitRef[]; planFile?: PlanFile | null }
  | { type: 'setPlanFile'; planFile: PlanFile | null }
  | { type: 'setCompare'; compare: Comparison | null }
  | { type: 'setCompareResult'; result: CompareResult | null }
  | { type: 'selectChange'; key: string | null }
  | { type: 'setResultsFile'; file: ResultsFile | null }
  | { type: 'setWalkthroughs'; report: AppState['walkthroughs'] }
  | { type: 'runStarted'; run: RunState }
  | { type: 'runOutput'; runId: string; text: string }
  | { type: 'runFinished'; runId: string; outcome: NonNullable<AppState['lastRun']> }
  | { type: 'setExpanded'; expanded: Record<string, boolean> }
  | { type: 'setSearch'; search: string }
  | { type: 'setViewFilter'; filter: ViewFilter | null }
  | { type: 'ui'; patch: Partial<Pick<AppState, 'diagnosticsOpen' | 'libraryOpen' | 'libraryFocusTest' | 'terminalTab' | 'validateRun' | 'productDialog' | 'newDialog' | 'shortcutsOpen' | 'bannerNote' | 'terminalOpen'>> }
  | { type: 'prompt'; prompt: Prompt | null }
  | { type: 'review'; review: ReviewState | null }
  | { type: 'toast'; id: number; message: string; tone: 'info' | 'success' | 'error' }
  | { type: 'dismissToast'; id: number }
  | { type: 'setRecent'; recent: string[] };

const MAX_UNDO = 100;

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'loaded': {
      const ok = a.parse.ok && !!a.parse.contract;
      const contract = a.parse.contract ?? null;
      const base: AppState = a.keepContext
        ? s
        : {
            ...initialState(),
            recent: s.recent,
            toasts: s.toasts,
            view: s.view === 'impact' ? s.explorerView : s.view,
            explorerView: s.explorerView,
            expanded: a.expanded ?? {},
          };
      return {
        ...base,
        filePath: a.path,
        diskText: a.text,
        diskSha: a.sha,
        savedContract: ok ? contract : null,
        contract,
        loadedInvalid: !ok,
        rawDraft: null,
        undo: [],
        redo: [],
        externalChange: null,
        git: a.git,
        refs: a.refs,
        planFile: a.planFile ?? null,
        rawMode: !contract ? true : a.keepContext ? s.rawMode && !ok : false,
        diagnosticsOpen: ok || !contract ? (a.keepContext ? s.diagnosticsOpen && ok : false) : true,
        bannerNote: null,
      };
    }
    case 'edit': {
      if (!s.contract || s.loadedInvalid) return s;
      const next = a.fn(s.contract);
      if (next === s.contract) return s;
      return { ...s, contract: next, undo: [...s.undo, s.contract].slice(-MAX_UNDO), redo: [] };
    }
    case 'undo': {
      if (!s.contract || !s.undo.length || s.loadedInvalid) return s;
      const prev = s.undo[s.undo.length - 1];
      return { ...s, contract: prev, undo: s.undo.slice(0, -1), redo: [...s.redo, s.contract] };
    }
    case 'redo': {
      if (!s.contract || !s.redo.length || s.loadedInvalid) return s;
      const next = s.redo[s.redo.length - 1];
      return { ...s, contract: next, redo: s.redo.slice(0, -1), undo: [...s.undo, s.contract] };
    }
    case 'setView':
      return { ...s, view: a.view, explorerView: a.view === 'impact' ? s.explorerView : a.view };
    case 'setEngineeringTab':
      return { ...s, engineeringTab: a.tab };
    case 'setArchitectureFocus':
      return { ...s, architectureFocusId: a.id };
    case 'showArchitecture':
      return { ...s, view: 'engineering', explorerView: 'engineering', engineeringTab: 'architecture', architectureFocusId: a.id };
    case 'selectEntity': {
      const view: ViewId = a.kind === 'capability' ? 'product' : 'engineering';
      return { ...s, view, explorerView: view, engineeringTab: view === 'engineering' ? 'systems' : s.engineeringTab, selected: { ...s.selected, [a.kind]: a.id }, focusBehaviorId: a.behaviorId ?? null, focusBehaviorIds: [], rawMode: false, viewFilter: filterKeeping(s, a.id, a.kind) };
    }
    case 'focusBehaviors': {
      const view: ViewId = a.kind === 'capability' ? 'product' : 'engineering';
      return { ...s, view, explorerView: view, engineeringTab: view === 'engineering' ? 'systems' : s.engineeringTab, selected: { ...s.selected, [a.kind]: a.id }, focusBehaviorId: null, focusBehaviorIds: a.behaviorIds, rawMode: false, viewFilter: filterKeeping(s, a.id, a.kind) };
    }
    case 'clearFocusBehavior':
      return s.focusBehaviorId || s.focusBehaviorIds.length ? { ...s, focusBehaviorId: null, focusBehaviorIds: [] } : s;
    case 'setRawMode':
      return { ...s, rawMode: a.on };
    case 'setRawDraft':
      return { ...s, rawDraft: a.text };
    case 'applyRaw': {
      if (!a.parse.ok || !a.parse.contract) return s;
      const wasInvalid = s.loadedInvalid;
      const contract = a.parse.contract;
      return {
        ...s,
        contract,
        loadedInvalid: false,
        rawDraft: null,
        // keep original saved baseline so dirty-tracking reflects the difference from disk
        savedContract: wasInvalid ? null : s.savedContract,
        undo: wasInvalid || !s.contract ? [] : [...s.undo, s.contract].slice(-MAX_UNDO),
        redo: [],
      };
    }
    case 'saved': {
      const ok = a.parse.ok && !!a.parse.contract;
      return {
        ...s,
        filePath: a.path ?? s.filePath,
        diskText: a.text,
        diskSha: a.sha,
        savedContract: ok ? a.parse.contract! : null,
        contract: ok ? (s.rawDraft === null && s.contract && !s.loadedInvalid ? s.contract : a.parse.contract!) : (a.parse.contract ?? s.contract),
        loadedInvalid: !ok,
        rawDraft: null,
        externalChange: null,
        undo: ok ? s.undo : [],
        redo: ok ? s.redo : [],
        prompt: null,
      };
    }
    case 'externalChange':
      return { ...s, externalChange: a.change };
    case 'setGit':
      return { ...s, git: a.git, refs: a.refs, planFile: a.planFile === undefined ? s.planFile : a.planFile };
    case 'setPlanFile':
      return s.planFile === a.planFile ? s : { ...s, planFile: a.planFile };
    case 'setCompare':
      return { ...s, compare: a.compare, compareResult: a.compare ? (s.compareResult ?? { status: 'loading' }) : null, impactSelection: null };
    case 'setCompareResult':
      return { ...s, compareResult: a.result };
    case 'selectChange':
      return { ...s, impactSelection: a.key };
    case 'setResultsFile':
      return { ...s, resultsFile: a.file };
    case 'setWalkthroughs':
      return s.walkthroughs === a.report ? s : { ...s, walkthroughs: a.report };
    case 'runStarted':
      return { ...s, run: a.run };
    case 'runOutput': {
      if (s.run?.runId !== a.runId) return s;
      const output = s.run.output + a.text;
      // Keep the visible log bounded; the full output streams past.
      return { ...s, run: { ...s.run, output: output.length > 200_000 ? output.slice(-150_000) : output } };
    }
    case 'runFinished':
      return s.run?.runId === a.runId ? { ...s, run: null, lastRun: a.outcome } : s;
    case 'setExpanded':
      return { ...s, expanded: a.expanded };
    case 'setSearch':
      return { ...s, search: a.search };
    case 'setViewFilter':
      return { ...s, viewFilter: a.filter };
    case 'ui':
      return { ...s, ...a.patch };
    case 'prompt':
      return { ...s, prompt: a.prompt };
    case 'review':
      return { ...s, review: a.review };
    case 'toast':
      return { ...s, toasts: [...s.toasts, { id: a.id, message: a.message, tone: a.tone }].slice(-4) };
    case 'dismissToast':
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case 'setRecent':
      return { ...s, recent: a.recent };
    default:
      return s;
  }
}

// ───────────── store ─────────────

export interface Store {
  getState(): AppState;
  dispatch(a: Action): void;
  subscribe(fn: () => void): () => void;
}

export function createStore(initial: AppState = initialState()): Store {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(a) {
      const next = reducer(state, a);
      if (next !== state) {
        state = next;
        listeners.forEach((l) => l());
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function errorCount(ds: Diagnostic[]): number {
  return ds.filter((d) => d.severity === 'error').length;
}
export function warningCount(ds: Diagnostic[]): number {
  return ds.filter((d) => d.severity === 'warning').length;
}
