import { diffContracts, parseContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import { appliesTo, PROPOSAL_FILE } from './proposal';
import type { ProposalFile } from './proposal';
import type { GitContext, GitRef, OrbitHost } from '../host/types';
import { shortSha } from '../lib/format';
import type { CompareResult, Comparison, LifecyclePreset, ProposalChangeLabel, RevSel, SnapMeta } from './types';

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
    case 'baseline':
      return `baseline:${sel.branch}`;
    case 'pinned':
      return `pinned:${sel.sha}`;
    case 'proposal':
      return `proposal:${sel.revision}`;
  }
}

export function revFromKey(key: string): RevSel {
  if (key === 'working') return { type: 'working' };
  if (key === 'unsaved') return { type: 'unsaved' };
  if (key === 'proposal:draft' || key === 'proposal:approved') return { type: 'proposal', revision: key === 'proposal:draft' ? 'draft' : 'approved' };
  if (key.startsWith('pinned:')) return { type: 'pinned', sha: key.slice(7) };
  if (key.startsWith('ref:')) return { type: 'ref', name: key.slice(4) };
  if (key.startsWith('baseline:')) return { type: 'baseline', branch: key.slice(9) };
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
    case 'baseline':
      return `Baseline (${sel.branch})`;
    case 'pinned':
      return `Baseline (${shortSha(sel.sha)})`;
    case 'proposal':
      return sel.revision === 'approved' ? 'Approved proposal' : 'Proposal';
  }
}

/** UI name for one side of a comparison, with no git vocabulary. */
export function sideLabel(sel: RevSel): string {
  if (sel.type === 'baseline' || sel.type === 'pinned') return 'Baseline';
  if (sel.type === 'proposal') return revLabel(sel);
  if (sel.type === 'working') return 'Latest';
  if (sel.type === 'unsaved') return 'Latest (unsaved edits)';
  return 'Another version';
}

/** UI title of the active comparison: the view name, or 'Custom comparison' for one the AI set up. */
export function comparisonTitle(cmp: Comparison, git: GitContext | null, refs: GitRef[], file?: ProposalFile | null): string {
  const p = activePreset(cmp, git, refs, file);
  return p ? PRESET_LABELS[p] : 'Custom comparison';
}

export const PRESET_LABELS: Record<LifecyclePreset, string> = {
  proposal: 'Proposal',
  'vs-proposal': 'Actual vs. Proposal',
  actual: 'Actual',
};

/** The branch features are cut from: `main`, else `master`, else null. */
export function baseBranchFor(refs: GitRef[]): string | null {
  for (const b of ['main', 'master']) if (refs.some((r) => r.kind === 'branch' && r.name === b)) return b;
  return null;
}

export type PresetResult = { ok: true; comparison: Comparison } | { ok: false; reason: string };

export function presetComparison(preset: LifecyclePreset, git: GitContext | null, refs: GitRef[], file?: ProposalFile | null): PresetResult {
  if (!git?.available) return { ok: false, reason: 'These views need the contract to be inside a Git repository.' };
  const proposal = appliesTo(file?.proposal, git) ? file.proposal : null;
  const branch = baseBranchFor(refs);
  const baseline: RevSel | null = proposal ? { type: 'pinned', sha: proposal.baseline } : branch ? { type: 'baseline', branch } : null;
  const actual: RevSel = { type: 'working' };
  if (preset === 'actual') {
    return baseline ? { ok: true, comparison: { base: baseline, target: actual } } : { ok: false, reason: "No 'main' or 'master' branch was found to use as the baseline." };
  }
  if (!proposal) {
    return { ok: false, reason: file?.error ?? (file?.proposal ? `${PROPOSAL_FILE} belongs to a different branch or contract.` : 'Run /orbit-plan to create orbit.proposal.json.') };
  }
  if (preset === 'proposal') return { ok: true, comparison: { base: { type: 'pinned', sha: proposal.baseline }, target: { type: 'proposal', revision: 'draft' } } };
  return proposal.approved
    ? { ok: true, comparison: { base: { type: 'proposal', revision: 'approved' }, target: actual } }
    : { ok: false, reason: 'Approve a proposal revision to compare it with Actual.' };
}

export function activePreset(cmp: Comparison | null, git: GitContext | null, refs: GitRef[], file?: ProposalFile | null): LifecyclePreset | null {
  if (!cmp) return null;
  for (const p of ['proposal', 'vs-proposal', 'actual'] as const) {
    const result = presetComparison(p, git, refs, file);
    if (result.ok && sameComparison(result.comparison, cmp)) return p;
  }
  return null;
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
  proposalFile?: ProposalFile | null;
}

async function loadSide(args: CompareArgs, sel: RevSel): Promise<{ meta: SnapMeta; contract: OrbitContract | null }> {
  const { host, git, filePath } = args;
  const label = revLabel(sel);
  const meta: SnapMeta = { sel, label, exists: true, invalid: false, diagnostics: [] };
  if (sel.type === 'proposal') {
    const file = args.proposalFile;
    const revision = appliesTo(file?.proposal, git) ? file.proposal[sel.revision] : undefined;
    if (!file || !revision) throw new Error(file?.error ?? 'The selected proposal revision is unavailable.');
    return { meta: { ...meta, proposal: { revision: revision.revision, fileHash: file.sha } }, contract: revision.contract };
  }
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
    let rev: string;
    if (sel.type === 'baseline') {
      const mb = await host.gitMergeBase(git.repoRoot!, 'HEAD', sel.branch);
      if (!mb) throw new Error(`HEAD and '${sel.branch}' share no history, so there is no baseline to compare against.`);
      rev = mb;
    } else rev = sel.type === 'ref' ? sel.name : sel.sha;
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
    const proposalLabels: Record<string, ProposalChangeLabel> = {};
    if (args.comparison.target.type === 'proposal' && args.comparison.target.revision === 'draft') {
      for (const change of diff.changes) if (change.kind === 'added') proposalLabels[change.key] = 'Planned';
    }
    const proposal = args.proposalFile?.proposal;
    if (args.comparison.base.type === 'proposal' && args.comparison.base.revision === 'approved' &&
        args.comparison.target.type === 'working' && appliesTo(proposal, args.git)) {
      const pinned = await loadSide(args, { type: 'pinned', sha: proposal.baseline });
      if (!pinned.contract) throw new Error('The pinned baseline contract is unavailable or invalid.');
      const intended = new Set(diffContracts(pinned.contract, b.contract).changes.map((c) => c.key));
      const implemented = new Set(diffContracts(pinned.contract, t.contract).changes.map((c) => c.key));
      for (const change of diff.changes) {
        proposalLabels[change.key] = !intended.has(change.key) ? 'Outside proposal' : implemented.has(change.key) ? 'Different' : 'Pending';
      }
    }
    return { status: 'ready', diff, base: b.meta, target: t.meta, proposalLabels };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
