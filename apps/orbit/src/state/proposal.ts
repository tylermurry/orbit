import { parseContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import type { GitContext, OrbitHost } from '../host/types';

export const PROPOSAL_FILE = 'orbit.proposal.json';

export interface ProposalRevision {
  revision: number;
  contract: OrbitContract;
}

export interface Proposal {
  version: 1;
  branch: string;
  contractPath: string;
  baseline: string;
  draft: ProposalRevision;
  approved?: ProposalRevision;
}

export interface ProposalFile {
  sha: string;
  proposal: Proposal | null;
  error?: string;
}

export function proposalPath(git: GitContext | null): string | null {
  return git?.repoRoot ? `${git.repoRoot.replace(/[\\/]+$/, '')}/${PROPOSAL_FILE}` : null;
}

function parseRevision(value: unknown): ProposalRevision {
  if (!value || typeof value !== 'object') throw new Error('Missing proposal revision.');
  const { revision, contract } = value as Partial<ProposalRevision>;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid proposal revision.');
  const parsed = parseContract(JSON.stringify(contract ?? null));
  if (!parsed.ok || !parsed.contract) {
    throw new Error(parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'Invalid proposal contract.');
  }
  return { revision, contract: parsed.contract };
}

export function parseProposal(text: string): Proposal {
  const value = JSON.parse(text) as Partial<Proposal> | null;
  if (!value || value.version !== 1 || typeof value.branch !== 'string' || !value.branch ||
      typeof value.contractPath !== 'string' || !value.contractPath ||
      typeof value.baseline !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baseline)) {
    throw new Error('Invalid proposal metadata.');
  }
  const draft = parseRevision(value.draft);
  const approved = value.approved === undefined ? undefined : parseRevision(value.approved);
  if (approved && approved.revision > draft.revision) throw new Error('Approved revision is newer than the draft.');
  return { version: 1, branch: value.branch, contractPath: value.contractPath, baseline: value.baseline, draft, approved };
}

export function appliesTo(proposal: Proposal | null | undefined, git: GitContext | null): proposal is Proposal {
  return !!proposal && !!git?.available && proposal.branch === git.headBranch && proposal.contractPath === git.relPath;
}

export async function readProposal(host: OrbitHost, git: GitContext | null, previous?: ProposalFile | null): Promise<ProposalFile | null> {
  const path = proposalPath(git);
  if (!path) return null;
  const stat = await host.statFile(path);
  if (!stat.exists) return null;
  if (previous && stat.sha256 === previous.sha) return previous;
  const snapshot = await host.readFile(path);
  try {
    return { sha: snapshot.sha256, proposal: parseProposal(snapshot.text) };
  } catch (error) {
    return { sha: snapshot.sha256, proposal: null, error: `Invalid ${PROPOSAL_FILE}: ${(error as Error).message}` };
  }
}
