import type { Diagnostic, EntityKind, OrbitContract, SemanticDiff } from '@orbit/contract';
import type { FileStat, GitContext, GitRef } from '../host/types';

export type ViewId = 'product' | 'engineering' | 'impact';

export type RevSel = { type: 'working' } | { type: 'unsaved' } | { type: 'ref'; name: string } | { type: 'sha'; sha: string };
export interface Comparison {
  base: RevSel;
  target: RevSel;
}

export type EvidenceCtx = { kind: 'none' } | { kind: 'head' } | { kind: 'rev'; label: string; commit: string };

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
  evidenceCtx: EvidenceCtx;

  // ui
  diagnosticsOpen: boolean;
  libraryOpen: boolean;
  libraryTab: 'tests' | 'evidence';
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
