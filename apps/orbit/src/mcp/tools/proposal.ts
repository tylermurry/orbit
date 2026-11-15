import { parseContract } from '@orbit/contract';
import { appliesTo, proposalPath, readProposal } from '../../state/proposal';
import type { Proposal } from '../../state/proposal';
import { editProposalContract, operationsSchema } from './edit';
import { st } from './helpers';
import { S } from './schema';
import { ToolError } from './types';
import type { ToolContext, ToolDef } from './types';

function project(ctx: ToolContext) {
  const { git, filePath } = st(ctx);
  const path = proposalPath(git);
  if (!path || !git?.headBranch || !git.repoRoot || !git.relPath || !git.headCommit) {
    throw new ToolError('Open a tracked contract on a named branch with at least one commit.');
  }
  return { git, path, actualPath: filePath };
}

function summary(proposal: Proposal) {
  return { branch: proposal.branch, baseline: proposal.baseline, revision: proposal.draft.revision, approvedRevision: proposal.approved?.revision ?? null };
}

async function save(ctx: ToolContext, path: string, proposal: Proposal, expected: string | null) {
  const current = project(ctx);
  const git = await ctx.host.gitContext(current.actualPath!);
  if (current.path !== path || git.repoRoot !== current.git.repoRoot || !appliesTo(proposal, git) || st(ctx).filePath !== current.actualPath) {
    throw new ToolError('The open project or branch changed. Reopen the intended project and retry.');
  }
  const result = await ctx.host.writeFileAtomic(path, JSON.stringify(proposal, null, 2) + '\n', expected);
  if (!result.ok) throw new ToolError(result.reason === 'conflict' ? 'The proposal changed on disk. Read it and retry.' : result.message);
  await ctx.ctrl.refreshProposal();
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const write = { ...readOnly, readOnlyHint: false, idempotentHint: false };
const revision = S.int('Expected current draft revision.', { minimum: 1 });

export function proposalTools(): ToolDef[] {
  return [
    {
      kind: 'read',
      tool: { name: 'get_proposal', title: 'Read the project proposal', description: 'Read orbit.proposal.json, including its draft and approved snapshots.', inputSchema: S.obj({}), annotations: readOnly },
      async run(_args, ctx) {
        await ctx.ctrl.refreshGit();
        const { git } = project(ctx);
        const file = await readProposal(ctx.host, git);
        return { data: { proposal: file?.proposal ?? null, applies: appliesTo(file?.proposal, git), error: file?.error ?? null, fileHash: file?.sha ?? null } };
      },
    },
    {
      kind: 'file',
      tool: {
        name: 'create_proposal', title: 'Create the project proposal',
        description: 'Write orbit.proposal.json by applying proposed edits to the contract at HEAD or an explicit baseline. Actual is untouched. Replace an existing proposal only on explicit user request.',
        inputSchema: S.obj({ baseline: S.nonEmpty('Git revision for the baseline. Defaults to HEAD.'), operations: operationsSchema, replace: S.bool('Replace the existing proposal with a new baseline.'), revision }, ['operations']),
        annotations: { ...write, destructiveHint: true },
      },
      async run(args, ctx) {
        await ctx.ctrl.refreshGit();
        const { git, path } = project(ctx);
        const file = await readProposal(ctx.host, git);
        if (file?.error) throw new ToolError(file.error);
        if (file?.proposal) {
          if (args.replace !== true) throw new ToolError(appliesTo(file.proposal, git)
            ? 'A proposal already exists. Use revise_proposal to update it.'
            : 'The existing proposal belongs to another branch or contract. Confirm with the owner before replacing it.');
          if (file.proposal.draft.revision !== args.revision) throw new ToolError('Read the existing draft revision before replacing the proposal.');
        }
        const base = await ctx.host.gitReadFileAt(git.repoRoot!, (args.baseline as string | undefined) ?? git.headCommit!, git.relPath!);
        if (!base.exists) throw new ToolError('The baseline commit does not contain the open contract.');
        const parsed = parseContract(base.text ?? '');
        if (!parsed.ok || !parsed.contract) throw new ToolError('The baseline commit must contain a valid contract.');
        const contract = editProposalContract(ctx, parsed.contract, args.operations);
        const proposal: Proposal = { version: 1, branch: git.headBranch!, contractPath: git.relPath!, baseline: base.commit, draft: { revision: (file?.proposal?.draft.revision ?? 0) + 1, contract } };
        await save(ctx, path, proposal, file?.sha ?? null);
        return { data: summary(proposal), toast: `Created proposal revision ${proposal.draft.revision}` };
      },
    },
    ...(['revise', 'approve'] as const).map((action): ToolDef => ({
      kind: 'file',
      tool: {
        name: `${action}_proposal`,
        title: action === 'revise' ? 'Revise the project proposal' : 'Approve the displayed proposal revision',
        description: action === 'revise' ? 'Apply edits to the current draft. Keep the pinned baseline and approved snapshot.' : 'Pin the exact draft revision after the product owner explicitly approves it.',
        inputSchema: action === 'revise' ? S.obj({ revision, operations: operationsSchema }, ['revision', 'operations']) : S.obj({ revision, fileHash: S.nonEmpty('File hash from the reviewed Proposal view.') }, ['revision', 'fileHash']),
        annotations: write,
      },
      async run(args, ctx) {
        await ctx.ctrl.refreshGit();
        const { git, path } = project(ctx);
        const file = await readProposal(ctx.host, git);
        if (!file || !appliesTo(file.proposal, git)) throw new ToolError(file?.error ?? 'No proposal applies to the open branch and contract.');
        const proposal = file.proposal;
        if (proposal.draft.revision !== args.revision || (action === 'approve' && file.sha !== args.fileHash)) {
          throw new ToolError('The draft changed. Review the Proposal view again before proceeding.');
        }
        const updated: Proposal = action === 'revise'
          ? { ...proposal, draft: { revision: proposal.draft.revision + 1, contract: editProposalContract(ctx, proposal.draft.contract, args.operations) } }
          : { ...proposal, approved: proposal.draft };
        await save(ctx, path, updated, file.sha);
        return { data: summary(updated), toast: action === 'revise' ? `Saved proposal revision ${updated.draft.revision}` : `Approved proposal revision ${updated.draft.revision}` };
      },
    })),
  ];
}
