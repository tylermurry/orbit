import { createEmptyContract, diffContracts, parseContract, serializeContract } from '@orbit/contract';
import type { Diagnostic, OrbitContract } from '@orbit/contract';
import type { FileStat, GitContext, GitRef, OrbitHost } from '../host/types';
import { fileName } from '../lib/format';
import { filePrefKey, loadPref, loadRecent, pushRecent, savePref } from '../lib/prefs';
import { computeComparison, defaultComparison } from './compare';
import { currentText, isDirty, structuredDirty } from './store';
import type { Store } from './store';
import type { Comparison, EvidenceCtx } from './types';

let toastSeq = 1;

/** Outcome of a non-interactive save (used by the AI tool runtime): never opens a prompt, never overwrites external changes. */
export type HeadlessSave =
  | { ok: true; changed: boolean; path: string; bytes: number }
  | { ok: false; reason: 'no-file' | 'nothing-to-save' | 'raw-draft' | 'validation' | 'conflict' | 'exists' | 'error'; message: string; diagnostics?: Diagnostic[]; current?: FileStat };

export interface Controller {
  toast(message: string, tone?: 'info' | 'success' | 'error'): void;
  openPath(path: string, opts?: { keepContext?: boolean; quiet?: boolean }): Promise<boolean>;
  openDialog(): Promise<void>;
  guard(label: string, run: () => void): void;
  save(opts?: { applyRaw?: boolean; anyway?: boolean }): Promise<void>;
  saveAs(opts?: { anyway?: boolean }): Promise<void>;
  saveHeadless(opts?: { anyway?: boolean }): Promise<HeadlessSave>;
  saveAsHeadless(path: string, opts?: { anyway?: boolean; overwrite?: boolean }): Promise<HeadlessSave>;
  reloadFromDisk(): Promise<void>;
  createNew(input: { id: string; name: string; summary: string }): Promise<boolean>;
  applyRaw(): boolean;
  refreshGit(): Promise<void>;
  poll(): Promise<void>;
  startBackground(pollMs: number): () => void;
  setCompare(c: Comparison | null): void;
  ensureDefaultCompare(): void;
  recomputeCompare(): Promise<void>;
  setEvidence(ctx: EvidenceCtx): void;
  resolveEvidenceRev(rev: string): Promise<EvidenceCtx | null>;
  setExpanded(map: Record<string, boolean>): void;
  reviewDifferences(): Promise<void>;
  initialize(): Promise<void>;
}

export function createController(store: Store, host: OrbitHost): Controller {
  const { dispatch, getState } = store;

  const toast: Controller['toast'] = (message, tone = 'info') => {
    const id = toastSeq++;
    dispatch({ type: 'toast', id, message, tone });
    setTimeout(() => dispatch({ type: 'dismissToast', id }), tone === 'error' ? 7000 : 3500);
  };

  async function loadGit(path: string): Promise<{ git: GitContext | null; refs: GitRef[] }> {
    try {
      const git = await host.gitContext(path);
      const refs = git.available && git.repoRoot ? await host.gitListRefs(git.repoRoot).catch(() => []) : [];
      return { git, refs };
    } catch {
      return { git: null, refs: [] };
    }
  }

  async function refreshGit() {
    const s = getState();
    if (!s.filePath) return;
    const { git, refs } = await loadGit(s.filePath);
    if (getState().filePath === s.filePath) dispatch({ type: 'setGit', git, refs });
  }

  async function openPath(path: string, opts: { keepContext?: boolean; quiet?: boolean } = {}) {
    try {
      const snap = await host.readFile(path);
      const parse = parseContract(snap.text);
      const { git, refs } = await loadGit(path);
      const keepContext = !!opts.keepContext && getState().filePath === path;
      dispatch({
        type: 'loaded',
        path,
        text: snap.text,
        sha: snap.sha256,
        parse,
        git,
        refs,
        keepContext,
        expanded: loadPref(filePrefKey(path, 'expanded'), {}),
        evidenceCtx: loadPref<EvidenceCtx>(filePrefKey(path, 'evidence'), { kind: 'none' }),
      });
      dispatch({ type: 'setRecent', recent: pushRecent(path) });
      if (!keepContext && !parse.ok && !opts.quiet) {
        const n = new Set(parse.diagnostics.filter((d) => d.severity === 'error').map((d) => `${d.code}|${d.message}|${d.line}`)).size;
        toast(parse.contract ? `Opened with ${n} error${n === 1 ? '' : 's'}; the file is shown read-only.` : 'This file is not valid JSON. It is open in Raw JSON; your original text is untouched.', 'error');
      }
      return true;
    } catch (e) {
      toast(`Could not open ${fileName(path)}: ${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }

  function guard(label: string, run: () => void) {
    if (isDirty(getState())) {
      dispatch({
        type: 'prompt',
        prompt: { type: 'discard', title: 'Discard unsaved changes?', description: `You have unsaved changes. ${label} will discard them.`, confirmLabel: 'Discard changes', run },
      });
    } else run();
  }

  async function openDialog() {
    guard('Opening another file', () => {
      void (async () => {
        const p = await host.pickOpenFile();
        if (p) await openPath(p);
      })();
    });
  }

  type SaveText = { text: string } | { prompted: true } | { nothing: true };

  function resolveSaveText(opts: { applyRaw?: boolean; anyway?: boolean }): SaveText {
    const s = getState();
    if (s.rawDraft !== null && s.rawDraft !== currentText(s)) {
      const parsed = parseContract(s.rawDraft);
      if (parsed.ok && parsed.contract) {
        if (!opts.applyRaw) {
          dispatch({ type: 'prompt', prompt: { type: 'applyRawBeforeSave' } });
          return { prompted: true };
        }
        dispatch({ type: 'applyRaw', parse: parsed });
        return { text: serializeContract(parsed.contract) };
      }
      if (!opts.anyway) {
        dispatch({ type: 'prompt', prompt: { type: 'saveErrors', diagnostics: parsed.diagnostics } });
        return { prompted: true };
      }
      return { text: s.rawDraft };
    }
    if (s.loadedInvalid || !s.contract) return { nothing: true };
    return { text: serializeContract(s.contract) };
  }

  async function finishWrite(path: string, text: string, expected: string | null | undefined, asNewPath: boolean) {
    const res = await host.writeFileAtomic(path, text, expected);
    if (res.ok) {
      const parse = parseContract(text);
      dispatch({ type: 'saved', text, sha: res.sha256, parse, path: asNewPath ? path : undefined });
      if (asNewPath) dispatch({ type: 'setRecent', recent: pushRecent(path) });
      toast(asNewPath ? `Saved as ${fileName(path)}` : 'Saved', 'success');
      void refreshGit();
      return;
    }
    if (res.reason === 'conflict') {
      dispatch({ type: 'prompt', prompt: { type: 'conflict', current: res.current } });
      return;
    }
    toast(`Could not save: ${res.message}`, 'error');
  }

  async function save(opts: { applyRaw?: boolean; anyway?: boolean } = {}) {
    const s = getState();
    if (!s.filePath) return saveAs(opts);
    const rawEdit = s.rawDraft !== null && s.rawDraft !== currentText(s);
    const r = resolveSaveText(opts);
    if ('prompted' in r) return;
    if ('nothing' in r) {
      toast('Nothing to save: the file on disk is unchanged. Fix the errors in Raw JSON first.', 'info');
      return;
    }
    const cur = getState();
    const expected = cur.externalChange?.kind === 'deleted' ? null : cur.diskSha;
    // Skip the write when the result would be semantically identical to what is on disk.
    if (!rawEdit && expected !== null && cur.rawDraft === null && cur.contract && !cur.loadedInvalid && !structuredDirty(cur)) {
      toast('No changes to save', 'info');
      return;
    }
    if (!rawEdit && expected !== null && cur.contract && !cur.loadedInvalid) {
      const disk = parseContract(cur.diskText);
      if (disk.ok && disk.contract && diffContracts(disk.contract, cur.contract).changes.length === 0 && !cur.externalChange) {
        dispatch({ type: 'saved', text: cur.diskText, sha: cur.diskSha!, parse: disk });
        toast('No changes to save: the file already contains these edits', 'info');
        return;
      }
    }
    await finishWrite(s.filePath, r.text, expected, false);
  }

  async function saveAs(opts: { anyway?: boolean } = {}) {
    const s = getState();
    const r = resolveSaveText({ applyRaw: true, anyway: opts.anyway });
    if ('prompted' in r) return;
    if ('nothing' in r) {
      // Save As of an unmodified invalid file: copy the exact text.
      const p = await host.pickSaveFile(fileName(s.filePath) || 'product.orbit.json');
      if (!p) return;
      await finishWrite(p, s.diskText, undefined, true);
      return;
    }
    const suggested = s.filePath ? fileName(s.filePath) : `${s.contract?.product.id ?? 'product'}.orbit.json`;
    const p = await host.pickSaveFile(suggested);
    if (!p) return;
    await finishWrite(p, r.text, undefined, true);
  }

  /** Text a headless save would write, or the reason it must not. */
  function headlessText(anyway: boolean): { text: string; rawEdit: boolean } | Extract<HeadlessSave, { ok: false }> {
    const s = getState();
    if (s.rawDraft !== null && s.rawDraft !== currentText(s)) {
      const parsed = parseContract(s.rawDraft);
      if (parsed.ok && parsed.contract) {
        return { ok: false, reason: 'raw-draft', message: 'The Raw JSON editor has unapplied edits. Apply them first (set_raw_json with apply: true, or Apply in the editor), or discard them.' };
      }
      if (!anyway) return { ok: false, reason: 'validation', message: `The unapplied Raw JSON text has ${parsed.diagnostics.filter((d) => d.severity === 'error').length} error(s). Fix them, or pass saveDespiteErrors: true to write the text exactly as it is.`, diagnostics: parsed.diagnostics };
      return { text: s.rawDraft, rawEdit: true };
    }
    if (s.loadedInvalid || !s.contract) return { ok: false, reason: 'nothing-to-save', message: 'The open file is invalid and read-only; there is nothing to save. Repair it with set_raw_json (apply: true) first.' };
    const text = serializeContract(s.contract);
    const parsed = parseContract(text);
    if (!parsed.ok && !anyway) {
      return { ok: false, reason: 'validation', message: `The contract has ${parsed.diagnostics.filter((d) => d.severity === 'error').length} validation error(s). Fix them, or pass saveDespiteErrors: true to save anyway.`, diagnostics: parsed.diagnostics };
    }
    return { text, rawEdit: false };
  }

  async function saveHeadless(opts: { anyway?: boolean } = {}): Promise<HeadlessSave> {
    if (!getState().filePath) return { ok: false, reason: 'no-file', message: 'No file is open. Use open_file or create_contract first.' };
    await poll();
    const s = getState();
    const path = s.filePath!;
    if (s.externalChange) {
      return {
        ok: false,
        reason: 'conflict',
        message: s.externalChange.kind === 'deleted' ? 'The file was deleted on disk after it was opened.' : 'The file was changed on disk after it was opened.',
        current: s.externalChange.stat,
      };
    }
    const r = headlessText(!!opts.anyway);
    if (!('text' in r)) return r;
    if (!r.rawEdit && s.rawDraft === null && !isDirty(s)) return { ok: true, changed: false, path, bytes: 0 };
    if (!r.rawEdit && s.contract && !s.loadedInvalid) {
      const disk = parseContract(s.diskText);
      if (disk.ok && disk.contract && diffContracts(disk.contract, s.contract).changes.length === 0) {
        dispatch({ type: 'saved', text: s.diskText, sha: s.diskSha!, parse: disk });
        return { ok: true, changed: false, path, bytes: 0 };
      }
    }
    const res = await host.writeFileAtomic(path, r.text, s.diskSha);
    if (res.ok) {
      dispatch({ type: 'saved', text: r.text, sha: res.sha256, parse: parseContract(r.text) });
      void refreshGit();
      return { ok: true, changed: true, path, bytes: new TextEncoder().encode(r.text).length };
    }
    if (res.reason === 'conflict') {
      dispatch({ type: 'externalChange', change: { kind: res.current.exists ? 'modified' : 'deleted', stat: res.current } });
      return { ok: false, reason: 'conflict', message: 'The file changed on disk since it was opened; nothing was written.', current: res.current };
    }
    return { ok: false, reason: 'error', message: `Could not save: ${res.message}` };
  }

  async function saveAsHeadless(path: string, opts: { anyway?: boolean; overwrite?: boolean } = {}): Promise<HeadlessSave> {
    const s = getState();
    if (!s.filePath) return { ok: false, reason: 'no-file', message: 'No file is open. Use open_file or create_contract first.' };
    let text: string;
    const r = headlessText(!!opts.anyway);
    if ('text' in r) text = r.text;
    else if (r.reason === 'nothing-to-save') text = s.diskText; // Save As of an unmodified invalid file copies the exact text
    else return r;
    const res = await host.writeFileAtomic(path, text, opts.overwrite ? undefined : null);
    if (res.ok) {
      dispatch({ type: 'saved', text, sha: res.sha256, parse: parseContract(text), path });
      dispatch({ type: 'setRecent', recent: pushRecent(path) });
      void refreshGit();
      return { ok: true, changed: true, path, bytes: new TextEncoder().encode(text).length };
    }
    if (res.reason === 'conflict') return { ok: false, reason: 'exists', message: `A file already exists at ${path}. Pass overwrite: true to replace it, or choose another path.`, current: res.current };
    return { ok: false, reason: 'error', message: `Could not save: ${res.message}` };
  }

  async function reloadFromDisk() {
    const s = getState();
    if (!s.filePath) return;
    await openPath(s.filePath, { keepContext: true, quiet: true });
    toast('Reloaded from disk', 'info');
  }

  async function createNew(input: { id: string; name: string; summary: string }) {
    const p = await host.pickSaveFile(`${input.id}.orbit.json`);
    if (!p) return false;
    const text = serializeContract(createEmptyContract({ id: input.id, name: input.name, summary: input.summary }));
    const res = await host.writeFileAtomic(p, text, null);
    if (!res.ok) {
      toast(res.reason === 'conflict' ? `A file already exists at ${p}. Choose a different name.` : `Could not create the file: ${res.message}`, 'error');
      return false;
    }
    return openPath(p);
  }

  function applyRaw() {
    const s = getState();
    if (s.rawDraft === null) return true;
    const parse = parseContract(s.rawDraft);
    if (!parse.ok || !parse.contract) {
      toast('Raw edits not applied: fix the errors listed below first.', 'error');
      return false;
    }
    dispatch({ type: 'applyRaw', parse });
    toast('Raw edits applied', 'success');
    return true;
  }

  // ── external change detection ──
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    try {
      const s = getState();
      if (!s.filePath) return;
      let st;
      try {
        st = await host.statFile(s.filePath);
      } catch {
        return;
      }
      const cur = getState();
      if (cur.filePath !== s.filePath) return;
      if (!st.exists) {
        if (cur.diskSha !== null && cur.externalChange?.kind !== 'deleted') dispatch({ type: 'externalChange', change: { kind: 'deleted', stat: st } });
        return;
      }
      if (st.sha256 === cur.diskSha) {
        if (cur.externalChange) dispatch({ type: 'externalChange', change: null });
        return;
      }
      if (cur.externalChange?.kind === 'modified' && cur.externalChange.stat.sha256 === st.sha256) return;
      if (!isDirty(cur)) {
        const ok = await openPath(cur.filePath!, { keepContext: true, quiet: true });
        if (ok) toast('Reloaded — file changed on disk', 'info');
      } else {
        dispatch({ type: 'externalChange', change: { kind: 'modified', stat: st } });
      }
    } finally {
      polling = false;
    }
  }

  // ── comparison ──
  let compareSeq = 0;
  async function recomputeCompare() {
    const s = getState();
    if (!s.compare || !s.git?.available || !s.filePath) return;
    const my = ++compareSeq;
    const result = await computeComparison({
      host,
      git: s.git,
      filePath: s.filePath,
      comparison: s.compare,
      unsavedContract: s.contract && !s.loadedInvalid ? s.contract : null,
    });
    if (my === compareSeq) dispatch({ type: 'setCompareResult', result });
  }

  const contractIds = new WeakMap<object, number>();
  let contractSeq = 0;
  const cid = (c: object | null) => {
    if (!c) return 0;
    let n = contractIds.get(c);
    if (!n) contractIds.set(c, (n = ++contractSeq));
    return n;
  };
  function compareKey() {
    const s = getState();
    if (!s.compare) return '';
    const usesUnsaved = s.compare.base.type === 'unsaved' || s.compare.target.type === 'unsaved';
    return JSON.stringify([s.compare, s.diskSha, s.git?.headCommit, s.git?.available, s.filePath, usesUnsaved ? cid(s.contract) : 0]);
  }

  function setCompare(c: Comparison | null) {
    dispatch({ type: 'setCompare', compare: c });
  }

  function ensureDefaultCompare() {
    const s = getState();
    if (s.compare || !s.git?.available) return;
    const d = defaultComparison(s.git, isDirty(s));
    if (d) setCompare(d);
  }

  function setEvidence(ctx: EvidenceCtx) {
    dispatch({ type: 'setEvidence', ctx });
    const p = getState().filePath;
    if (p) savePref(filePrefKey(p, 'evidence'), ctx);
  }

  async function resolveEvidenceRev(rev: string): Promise<EvidenceCtx | null> {
    const s = getState();
    if (!s.git?.available || !s.git.repoRoot || !s.git.relPath) return null;
    try {
      const f = await host.gitReadFileAt(s.git.repoRoot, rev, s.git.relPath);
      return { kind: 'rev', label: rev, commit: f.commit };
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
      return null;
    }
  }

  function setExpanded(map: Record<string, boolean>) {
    dispatch({ type: 'setExpanded', expanded: map });
    const p = getState().filePath;
    if (p) savePref(filePrefKey(p, 'expanded'), map);
  }

  async function reviewDifferences() {
    const s = getState();
    if (!s.filePath) return;
    try {
      const disk = await host.readFile(s.filePath);
      const diskParse = parseContract(disk.text);
      let mine: OrbitContract | null = s.contract && !s.loadedInvalid ? s.contract : null;
      if (s.rawDraft !== null) {
        const p = parseContract(s.rawDraft);
        if (p.ok && p.contract) mine = p.contract;
      }
      if (!diskParse.ok || !diskParse.contract) {
        toast('The version on disk is not a valid contract, so a semantic comparison is not possible. Use Save As to keep your edits.', 'error');
        return;
      }
      if (!mine) {
        toast('Your version is not a valid contract yet, so a semantic comparison is not possible.', 'error');
        return;
      }
      dispatch({ type: 'review', review: { title: 'Disk version → your version', diff: diffContracts(diskParse.contract, mine) } });
    } catch (e) {
      toast(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  function startBackground(pollMs: number) {
    const timer = setInterval(() => void poll(), pollMs);
    const onFocus = () => {
      void poll();
      void refreshGit();
    };
    window.addEventListener('focus', onFocus);
    let lastKey = '';
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const unsub = store.subscribe(() => {
      const k = compareKey();
      if (k === lastKey) return;
      lastKey = k;
      if (!k) return;
      clearTimeout(debounce);
      debounce = setTimeout(() => void recomputeCompare(), 120);
    });
    return () => {
      clearInterval(timer);
      clearTimeout(debounce);
      window.removeEventListener('focus', onFocus);
      unsub();
    };
  }

  let initialized = false;
  async function initialize() {
    if (initialized) return;
    initialized = true;
    dispatch({ type: 'setRecent', recent: loadRecent() });
    try {
      const p = await host.initialFile();
      if (p) await openPath(p);
    } catch {
      /* no initial file */
    }
  }

  return {
    toast,
    openPath,
    openDialog,
    guard,
    save,
    saveAs,
    saveHeadless,
    saveAsHeadless,
    reloadFromDisk,
    createNew,
    applyRaw,
    refreshGit,
    poll,
    startBackground,
    setCompare,
    ensureDefaultCompare,
    recomputeCompare,
    setEvidence,
    resolveEvidenceRev,
    setExpanded,
    reviewDifferences,
    initialize,
  };
}
