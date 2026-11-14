import { computeAssurance, diffContracts, parseContract } from '@orbit/contract';
import type { AssuranceSummary, Diagnostic, OrbitContract } from '@orbit/contract';
import { canon, currentText, inspectedCommit, isDirty } from '../../state/store';
import type { AppState } from '../../state/types';
import { ToolError } from './types';
import type { ToolContext } from './types';

export const st = (ctx: ToolContext): AppState => ctx.store.getState();

/** The open, parseable contract (possibly the read-only partial copy of an invalid file). */
export function requireContract(ctx: ToolContext): OrbitContract {
  const s = st(ctx);
  if (!s.filePath) throw new ToolError('No contract file is open.', { suggestions: ['Call open_file with an absolute path, or create_contract to start a new one. list_recent_files shows recently used files.'] });
  if (!s.contract) throw new ToolError('The open file is not valid JSON, so there is no contract to read.', { suggestions: ['Use get_raw_json to see the text and get_diagnostics for the errors, then repair it with set_raw_json (apply: true).'] });
  return s.contract;
}

/** Like requireContract but refuses when the document must not be edited structurally. */
export function requireEditable(ctx: ToolContext): OrbitContract {
  const c = requireContract(ctx);
  const s = st(ctx);
  if (s.loadedInvalid) {
    throw new ToolError('The open file has validation errors and is read-only, exactly like in the UI. Nothing was changed.', {
      suggestions: ['Call get_diagnostics to see the errors.', 'Repair the file with set_raw_json (apply: true) using corrected full text, or call reload_from_disk after fixing it elsewhere.'],
    });
  }
  if (s.rawDraft !== null && s.rawDraft !== currentText(s)) {
    throw new ToolError('The Raw JSON editor has unapplied edits typed by the user, so structured edits are blocked to avoid clobbering them.', {
      suggestions: ['Call get_raw_json to see the draft, then set_raw_json with apply: true to apply it, or ask the user to apply or discard it.'],
    });
  }
  return c;
}

export function inspected(s: AppState): string | null {
  return inspectedCommit(s);
}

// ── assurance memo (one entry per contract object + inspected commit) ──
let assuranceMemo: { c: OrbitContract; commit: string | null; map: Map<string, AssuranceSummary> } | null = null;
export function assuranceFor(c: OrbitContract, commit: string | null): Map<string, AssuranceSummary> {
  if (assuranceMemo && assuranceMemo.c === c && assuranceMemo.commit === commit) return assuranceMemo.map;
  const map = computeAssurance(c, { inspectedCommit: commit });
  assuranceMemo = { c, commit, map };
  return map;
}

export function dedupeDiagnostics(ds: Diagnostic[]): Diagnostic[] {
  const seen = new Set<string>();
  return ds.filter((x) => {
    const k = `${x.code}|${x.message}|${x.line}|${x.column}|${x.path}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Diagnostics for the text the user would see in the Raw editor (draft first, else working/disk text). */
export function currentDiagnostics(s: AppState): { source: 'raw-draft' | 'working' | 'disk'; diagnostics: Diagnostic[]; text: string } {
  const hasDraft = s.rawDraft !== null && s.rawDraft !== currentText(s);
  const text = hasDraft ? (s.rawDraft as string) : currentText(s);
  const source = hasDraft ? 'raw-draft' : s.loadedInvalid || !s.contract ? 'disk' : 'working';
  if (!text) return { source, diagnostics: [], text };
  return { source, diagnostics: dedupeDiagnostics(parseContract(text).diagnostics), text };
}

export function diagCounts(ds: Diagnostic[]): { errors: number; warnings: number } {
  const errors = ds.filter((d) => d.severity === 'error').length;
  return { errors, warnings: ds.length - errors };
}

export function slimDiagnostic(d: Diagnostic) {
  return { severity: d.severity, code: d.code, message: d.message, path: d.path, ...(d.line ? { line: d.line, column: d.column } : {}), ...(d.relatedIds?.length ? { relatedIds: d.relatedIds } : {}) };
}

// ── fuzzy "did you mean" ──
function lev(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface Candidate {
  id: string;
  name: string;
}

/** Up to `n` closest candidates by id/name (substring, shared words, edit distance). */
export function closest(query: string, candidates: Candidate[], n = 5): Candidate[] {
  const q = norm(query);
  if (!q) return candidates.slice(0, n);
  const qWords = new Set(q.split(' '));
  const scored = candidates.map((c) => {
    const id = norm(c.id);
    const name = norm(c.name);
    let score = Math.min(lev(q, id) / Math.max(q.length, id.length, 1), lev(q, name) / Math.max(q.length, name.length, 1));
    if (id.includes(q) || name.includes(q) || (q.length > 3 && (q.includes(id) || q.includes(name)))) score = Math.min(score, 0.15);
    const words = new Set([...id.split(' '), ...name.split(' ')]);
    const shared = [...qWords].filter((w) => w.length > 2 && words.has(w)).length;
    if (shared) score = Math.min(score, 0.6 - 0.1 * Math.min(shared, 3));
    return { c, score };
  });
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .filter((x) => x.score < 0.85)
    .map((x) => x.c);
}

export function notFound(label: string, id: string, candidates: Candidate[]): ToolError {
  const near = closest(id, candidates);
  return new ToolError(`${label} '${id}' was not found.${near.length ? ` Did you mean: ${near.map((c) => `'${c.id}' (${c.name})`).join(', ')}?` : ''}`, {
    suggestions: near.length ? near.map((c) => c.id) : [`Use list_entities / search to find valid ids.`],
    data: { closestMatches: near },
  });
}

export const entityCandidates = (c: OrbitContract): Candidate[] => c.entities.map((e) => ({ id: e.id, name: e.name }));
export const testCandidates = (c: OrbitContract): Candidate[] => c.tests.map((t) => ({ id: t.id, name: t.name }));
export const behaviorCandidates = (c: OrbitContract): Candidate[] => c.entities.flatMap((e) => e.behaviors.map((b) => ({ id: b.id, name: b.name })));
export const relationshipCandidates = (c: OrbitContract): Candidate[] => c.relationships.map((r) => ({ id: r.id, name: `${r.type} ${r.sourceId} ${r.targetId}` }));
export const evidenceCandidates = (c: OrbitContract): Candidate[] => c.evidence.map((e) => ({ id: e.id, name: `${e.testId} ${e.status}` }));

export function entityRef(c: OrbitContract, id: string): { id: string; name: string; kind: string } {
  const e = c.entities.find((x) => x.id === id);
  return e ? { id: e.id, name: e.name, kind: e.kind } : { id, name: id, kind: 'unknown' };
}

export function historyState(s: AppState) {
  return { dirty: isDirty(s), canUndo: s.undo.length > 0 && !s.loadedInvalid, canRedo: s.redo.length > 0 && !s.loadedInvalid, undoDepth: s.undo.length, redoDepth: s.redo.length };
}

/** Short description of what differs between two contracts (for undo/redo/raw-apply summaries). */
export function describeDiff(a: OrbitContract | null, b: OrbitContract | null): { changes: number; labels: string[] } {
  const d = diffContracts(a, b);
  return { changes: d.changes.length, labels: d.changes.slice(0, 8).map((c) => `${c.kind} ${c.category} '${c.label}'`) };
}

export function same(a: OrbitContract | null, b: OrbitContract | null): boolean {
  return canon(a) === canon(b);
}

export function clip(text: string, n = 60): string {
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}
