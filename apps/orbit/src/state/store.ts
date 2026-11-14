import { serializeContract } from '@orbit/contract';
import type { Diagnostic, EntityKind, OrbitContract, ParseResult } from '@orbit/contract';
import type { GitContext, GitRef } from '../host/types';
import type { AppState, CompareResult, Comparison, EvidenceCtx, Prompt, ReviewState, ViewId } from './types';

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
    view: 'product',
    rawMode: false,
    selected: { capability: null, system: null },
    focusBehaviorId: null,
    expanded: {},
    search: '',
    compare: null,
    compareResult: null,
    impactSelection: null,
    evidenceCtx: { kind: 'none' },
    diagnosticsOpen: false,
    libraryOpen: false,
    libraryTab: 'tests',
    libraryFocusTest: null,
    productDialog: false,
    newDialog: false,
    shortcutsOpen: false,
    prompt: null,
    review: null,
    toasts: [],
    recent: [],
    bannerNote: null,
  };
}

// ───────────── derived values ─────────────

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

export function inspectedCommit(s: AppState): string | null {
  const e = s.evidenceCtx;
  if (e.kind === 'none') return null;
  if (e.kind === 'head') return s.git?.available ? (s.git.headCommit ?? null) : null;
  return e.commit;
}

export function canUndo(s: AppState): boolean {
  return s.undo.length > 0 && !s.loadedInvalid;
}

// ───────────── actions ─────────────

export type Action =
  | { type: 'loaded'; path: string; text: string; sha: string | null; parse: ParseResult; git: GitContext | null; refs: GitRef[]; keepContext: boolean; expanded?: Record<string, boolean>; evidenceCtx?: EvidenceCtx }
  | { type: 'edit'; fn: (c: OrbitContract) => OrbitContract }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'setView'; view: ViewId }
  | { type: 'selectEntity'; id: string; kind: EntityKind; behaviorId?: string | null }
  | { type: 'clearFocusBehavior' }
  | { type: 'setRawMode'; on: boolean }
  | { type: 'setRawDraft'; text: string | null }
  | { type: 'applyRaw'; parse: ParseResult }
  | { type: 'saved'; text: string; sha: string; parse: ParseResult; path?: string }
  | { type: 'externalChange'; change: AppState['externalChange'] }
  | { type: 'setGit'; git: GitContext | null; refs: GitRef[] }
  | { type: 'setCompare'; compare: Comparison | null }
  | { type: 'setCompareResult'; result: CompareResult | null }
  | { type: 'selectChange'; key: string | null }
  | { type: 'setEvidence'; ctx: EvidenceCtx }
  | { type: 'setExpanded'; expanded: Record<string, boolean> }
  | { type: 'setSearch'; search: string }
  | { type: 'ui'; patch: Partial<Pick<AppState, 'diagnosticsOpen' | 'libraryOpen' | 'libraryTab' | 'libraryFocusTest' | 'productDialog' | 'newDialog' | 'shortcutsOpen' | 'bannerNote'>> }
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
            view: s.view === 'impact' ? 'product' : s.view,
            expanded: a.expanded ?? {},
            evidenceCtx: a.evidenceCtx ?? { kind: 'none' },
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
      return { ...s, view: a.view };
    case 'selectEntity': {
      const view: ViewId = a.kind === 'capability' ? 'product' : 'engineering';
      return { ...s, view, selected: { ...s.selected, [a.kind]: a.id }, focusBehaviorId: a.behaviorId ?? null, rawMode: false };
    }
    case 'clearFocusBehavior':
      return s.focusBehaviorId ? { ...s, focusBehaviorId: null } : s;
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
      return { ...s, git: a.git, refs: a.refs };
    case 'setCompare':
      return { ...s, compare: a.compare, compareResult: a.compare ? (s.compareResult ?? { status: 'loading' }) : null, impactSelection: null };
    case 'setCompareResult':
      return { ...s, compareResult: a.result };
    case 'selectChange':
      return { ...s, impactSelection: a.key };
    case 'setEvidence':
      return { ...s, evidenceCtx: a.ctx };
    case 'setExpanded':
      return { ...s, expanded: a.expanded };
    case 'setSearch':
      return { ...s, search: a.search };
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
