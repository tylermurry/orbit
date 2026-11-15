import { parseContract } from '@orbit/contract';
import { appliesTo, planPath, readPlan } from '../../state/plan';
import type { Plan } from '../../state/plan';
import { editPlanContract, operationsSchema } from './edit';
import { st } from './helpers';
import { S } from './schema';
import { ToolError } from './types';
import type { ToolContext, ToolDef } from './types';

function project(ctx: ToolContext) {
  const { git, filePath } = st(ctx);
  const path = planPath(git);
  if (!path || !git?.headBranch || !git.repoRoot || !git.relPath || !git.headCommit) {
    throw new ToolError('Open a tracked contract on a named branch with at least one commit.');
  }
  return { git, path, actualPath: filePath };
}

function summary(plan: Plan, fileHash: string) {
  return { branch: plan.branch, baseline: plan.baseline, fileHash };
}

async function save(ctx: ToolContext, path: string, plan: Plan, expected: string | null): Promise<string> {
  const current = project(ctx);
  const git = await ctx.host.gitContext(current.actualPath!);
  if (current.path !== path || git.repoRoot !== current.git.repoRoot || !appliesTo(plan, git) || st(ctx).filePath !== current.actualPath) {
    throw new ToolError('The open project or branch changed. Reopen the intended project and retry.');
  }
  const result = await ctx.host.writeFileAtomic(path, JSON.stringify(plan, null, 2) + '\n', expected);
  if (!result.ok) throw new ToolError(result.reason === 'conflict' ? 'The plan changed on disk. Read it and retry.' : result.message);
  await ctx.ctrl.refreshPlan();
  return result.sha256;
}

const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false as const };
const write = { ...readOnly, readOnlyHint: false, idempotentHint: false };
const fileHash = S.nonEmpty('fileHash of the plan as last read (get_plan) or written (create_plan / revise_plan), so edits never overwrite a newer plan.');

export function planTools(): ToolDef[] {
  return [
    {
      kind: 'read',
      tool: { name: 'get_plan', title: 'Read the project plan', description: 'Read orbit.plan.json: the pinned baseline commit and the proposed contract, plus the fileHash needed to revise or replace it.', inputSchema: S.obj({}), annotations: readOnly },
      async run(_args, ctx) {
        await ctx.ctrl.refreshGit();
        const { git } = project(ctx);
        const file = await readPlan(ctx.host, git);
        return { data: { plan: file?.plan ?? null, applies: appliesTo(file?.plan, git), error: file?.error ?? null, fileHash: file?.sha ?? null } };
      },
    },
    {
      kind: 'file',
      tool: {
        name: 'create_plan', title: 'Create the project plan',
        description: 'Write orbit.plan.json by applying proposed edits to the contract at HEAD or an explicit baseline. Actual is untouched. Replace an existing plan only on explicit user request (replace: true with its fileHash).',
        inputSchema: S.obj({ baseline: S.nonEmpty('Git revision for the baseline. Defaults to HEAD.'), operations: operationsSchema, replace: S.bool('Replace the existing plan with a new baseline.'), fileHash }, ['operations']),
        annotations: { ...write, destructiveHint: true },
      },
      async run(args, ctx) {
        await ctx.ctrl.refreshGit();
        const { git, path } = project(ctx);
        const file = await readPlan(ctx.host, git);
        if (file?.error) throw new ToolError(file.error);
        if (file?.plan) {
          if (args.replace !== true) throw new ToolError(appliesTo(file.plan, git)
            ? 'A plan already exists. Use revise_plan to update it.'
            : 'The existing plan belongs to another branch or contract. Confirm with the owner before replacing it.');
          if (file.sha !== args.fileHash) throw new ToolError('Read the existing plan (get_plan) and pass its fileHash before replacing it.');
        }
        const base = await ctx.host.gitReadFileAt(git.repoRoot!, (args.baseline as string | undefined) ?? git.headCommit!, git.relPath!);
        if (!base.exists) throw new ToolError('The baseline commit does not contain the open contract.');
        const parsed = parseContract(base.text ?? '');
        if (!parsed.ok || !parsed.contract) throw new ToolError('The baseline commit must contain a valid contract.');
        const contract = editPlanContract(ctx, parsed.contract, args.operations);
        const plan: Plan = { version: 1, branch: git.headBranch!, contractPath: git.relPath!, baseline: base.commit, contract };
        const sha = await save(ctx, path, plan, file?.sha ?? null);
        return { data: summary(plan, sha), toast: 'Created the plan' };
      },
    },
    {
      kind: 'file',
      tool: {
        name: 'revise_plan',
        title: 'Revise the project plan',
        description: 'Apply edits to the proposed contract. Keeps the pinned baseline.',
        inputSchema: S.obj({ fileHash, operations: operationsSchema }, ['fileHash', 'operations']),
        annotations: write,
      },
      async run(args, ctx) {
        await ctx.ctrl.refreshGit();
        const { git, path } = project(ctx);
        const file = await readPlan(ctx.host, git);
        if (!file || !appliesTo(file.plan, git)) throw new ToolError(file?.error ?? 'No plan applies to the open branch and contract.');
        if (file.sha !== args.fileHash) throw new ToolError('The plan changed since you read it. Read it again (get_plan) before revising.');
        const updated: Plan = { ...file.plan, contract: editPlanContract(ctx, file.plan.contract, args.operations) };
        const sha = await save(ctx, path, updated, file.sha);
        return { data: summary(updated, sha), toast: 'Saved the plan' };
      },
    },
  ];
}
