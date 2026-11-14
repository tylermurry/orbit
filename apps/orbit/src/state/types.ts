import type { Diagnostic, EntityKind, OrbitContract, SemanticDiff } from '@orbit/contract';
import type { FileStat, GitContext, GitRef, RunOutcome } from '../host/types';
import type { JUnitCase } from '../lib/junit';

export type ViewId = 'product' | 'engineering' | 'impact';

/** `baseline` = merge-base of HEAD and the base branch (resolved on every comparison). */
export type RevSel = { type: 'working' } | { type: 'unsaved' } | { type: 'ref'; name: string } | { type: 'sha'; sha: string } | { type: 'baseline'; branch: string };

/**
 * The three product-owner views of a feature branch:
 * - proposal:    baseline -> proposal tag   (what was proposed)
 * - vs-proposal: proposal tag -> latest     (how the actual work differs from the proposal)
 * - actual:      baseline -> latest         (everything that changed on this branch)
 * "latest" is the working tree, or unsaved edits when there are any.
 */
export type LifecyclePreset = 'proposal' | 'vs-proposal' | 'actual';
export interface Comparison {
  base: RevSel;
  target: RevSel;
}

/** The results file named by the contract's validation config, as last read from disk. */
export interface ResultsFile {
  /** Absolute path. */
  path: string;
  state: 'ok' | 'missing' | 'invalid';
  /** When the run that wrote it happened (the file's modification time), RFC3339. */
  at: string | null;
  sha?: string;
  cases: JUnitCase[];
  message?: string;
}

/** A validation run in progress. */
export interface RunState {
  runId: string;
  command: string;
  startedAt: number;
  output: string;
}

export interface SnapMeta {
  sel: RevSel;
  label: string;
  commit?: string;
  exists: boolean;
  invalid: boolean;
  diagnostics: Diagnostic[];
}

export type CompareResult =
  | { status: 'loading' }
  | { status: 'ready'; diff: SemanticDiff; base: SnapMeta; target: SnapMeta }
  | { status: 'blocked'; base: SnapMeta; target: SnapMeta }
  | { status: 'error'; message: string };

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export type Prompt =
  | { type: 'discard'; title: string; description: string; confirmLabel: string; run: () => void }
  | { type: 'leaveRaw'; run: () => void }
  | { type: 'applyRawBeforeSave' }
  | { type: 'saveErrors'; diagnostics: Diagnostic[] }
  | { type: 'conflict'; current: FileStat }
  | { type: 'reload' };

export interface ReviewState {
  title: string;
  diff: SemanticDiff;
}

export interface AppState {
  // document
  filePath: string | null;
  diskText: string;
  /** null when the file does not exist on disk (new / deleted). */
  diskSha: string | null;
  savedContract: OrbitContract | null;
  contract: OrbitContract | null;
  /** The loaded text is invalid; `contract` (if any) is a read-only partial display copy. */
  loadedInvalid: boolean;
  rawDraft: string | null;
  undo: OrbitContract[];
  redo: OrbitContract[];
  externalChange: null | { kind: 'modified' | 'deleted'; stat: FileStat };
  git: GitContext | null;
  refs: GitRef[];

  // navigation
  view: ViewId;
  rawMode: boolean;
  selected: Record<EntityKind, string | null>;
  focusBehaviorId: string | null;
  expanded: Record<string, boolean>;
  search: string;

  // comparison
  compare: Comparison | null;
  compareResult: CompareResult | null;
  impactSelection: string | null;

  // validation
  resultsFile: ResultsFile | null;
  run: RunState | null;
  lastRun: (RunOutcome & { command: string; finishedAt: string }) | null;
  runDialog: boolean;

  // ui
  diagnosticsOpen: boolean;
  libraryOpen: boolean;
  libraryFocusTest: string | null;
  productDialog: boolean;
  newDialog: boolean;
  shortcutsOpen: boolean;
  prompt: Prompt | null;
  review: ReviewState | null;
  toasts: Toast[];
  recent: string[];
  bannerNote: string | null;
}
