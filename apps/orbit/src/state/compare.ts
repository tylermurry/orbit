import { diffContracts, parseContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import type { GitContext, OrbitHost } from '../host/types';
import { shortSha } from '../lib/format';
import type { CompareResult, Comparison, RevSel, SnapMeta } from './types';

export function revKey(sel: RevSel): string {
  switch (sel.type) {
    case 'working':
      return 'working';
    case 'unsaved':
      return 'unsaved';
    case 'ref':
      return `ref:${sel.name}`;
    case 'sha':
      return `sha:${sel.sha}`;
  }
}

export function revFromKey(key: string): RevSel {
  if (key === 'working') return { type: 'working' };
  if (key === 'unsaved') return { type: 'unsaved' };
  if (key.startsWith('ref:')) return { type: 'ref', name: key.slice(4) };
  return { type: 'sha', sha: key.slice(4) };
}

export function revLabel(sel: RevSel): string {
  switch (sel.type) {
    case 'working':
      return 'Working tree';
    case 'unsaved':
      return 'Unsaved edits';
    case 'ref':
      return sel.name;
    case 'sha':
      return `Commit ${shortSha(sel.sha)}`;
  }
}

export function sameComparison(a: Comparison | null, b: Comparison | null): boolean {
  if (!a || !b) return a === b;
  return revKey(a.base) === revKey(b.base) && revKey(a.target) === revKey(b.target);
}

/**
 * Default comparison: HEAD -> Working tree (or -> Unsaved edits when there are unsaved edits).
 * Returns null when git is unavailable.
 */
export function defaultComparison(git: GitContext | null, dirty: boolean): Comparison | null {
  if (!git?.available) return null;
  return { base: { type: 'ref', name: 'HEAD' }, target: dirty ? { type: 'unsaved' } : { type: 'working' } };
}

export interface CompareArgs {
  host: OrbitHost;
  git: GitContext;
  filePath: string;
  comparison: Comparison;
  /** In-memory working contract; null if it cannot be compared (invalid). */
  unsavedContract: OrbitContract | null;
}

async function loadSide(args: CompareArgs, sel: RevSel): Promise<{ meta: SnapMeta; contract: OrbitContract | null }> {
  const { host, git, filePath } = args;
  const label = revLabel(sel);
  const meta: SnapMeta = { sel, label, exists: true, invalid: false, diagnostics: [] };
  let text: string | undefined;
  if (sel.type === 'unsaved') {
    if (!args.unsavedContract) {
      return { meta: { ...meta, invalid: true, diagnostics: [{ severity: 'error', code: 'unsaved.invalid', path: '', message: 'Your unsaved edits are not a valid contract yet; fix them in Raw JSON first.' }] }, contract: null };
    }
    return { meta, contract: args.unsavedContract };
  }
  if (sel.type === 'working') {
    const st = await host.statFile(filePath);
    if (!st.exists) return { meta: { ...meta, exists: false }, contract: null };
    text = (await host.readFile(filePath)).text;
  } else {
    const rev = sel.type === 'ref' ? sel.name : sel.sha;
    const f = await host.gitReadFileAt(git.repoRoot!, rev, git.relPath!);
    meta.commit = f.commit;
    if (!f.exists) return { meta: { ...meta, exists: false }, contract: null };
    text = f.text ?? '';
  }
  const parsed = parseContract(text);
  if (!parsed.ok || !parsed.contract) {
    return { meta: { ...meta, invalid: true, diagnostics: parsed.diagnostics }, contract: null };
  }
  return { meta: { ...meta, diagnostics: parsed.diagnostics }, contract: parsed.contract };
}

/** Compute a semantic comparison from valid snapshots only. Never falls back to a text diff. */
export async function computeComparison(args: CompareArgs): Promise<CompareResult> {
  try {
    const [b, t] = await Promise.all([loadSide(args, args.comparison.base), loadSide(args, args.comparison.target)]);
    if (b.meta.invalid || t.meta.invalid) return { status: 'blocked', base: b.meta, target: t.meta };
    if (!b.meta.exists && !t.meta.exists) {
      return { status: 'error', message: 'The contract file does not exist at either revision, so there is nothing to compare.' };
    }
    const diff = diffContracts(b.contract, t.contract);
    return { status: 'ready', diff, base: b.meta, target: t.meta };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
