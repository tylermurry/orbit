import { parseContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import type { GitContext, OrbitHost } from '../host/types';

export const PLAN_FILE = 'orbit.plan.json';

/** orbit.plan.json: the planned contract for a branch, built on a pinned baseline commit. */
export interface Plan {
  version: 1;
  branch: string;
  contractPath: string;
  baseline: string;
  contract: OrbitContract;
}

export interface PlanFile {
  sha: string;
  plan: Plan | null;
  error?: string;
}

/** orbit.plan.json lives next to the contract it plans (same folder as e.g. orbit.json). */
export function planPath(git: GitContext | null): string | null {
  if (!git?.repoRoot || !git.relPath) return null;
  const dir = git.relPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
  return [git.repoRoot.replace(/[\\/]+$/, ''), dir, PLAN_FILE].filter(Boolean).join('/');
}

function parsePlanContract(value: unknown): OrbitContract {
  if (!value || typeof value !== 'object') throw new Error('Missing plan contract.');
  const parsed = parseContract(JSON.stringify(value));
  if (!parsed.ok || !parsed.contract) {
    throw new Error(parsed.diagnostics.find((d) => d.severity === 'error')?.message ?? 'Invalid plan contract.');
  }
  return parsed.contract;
}

export function parsePlan(text: string): Plan {
  const value = JSON.parse(text) as Partial<Plan> | null;
  if (!value || value.version !== 1 || typeof value.branch !== 'string' || !value.branch ||
      typeof value.contractPath !== 'string' || !value.contractPath ||
      typeof value.baseline !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.baseline)) {
    throw new Error('Invalid plan metadata.');
  }
  const contract = parsePlanContract(value.contract);
  return { version: 1, branch: value.branch, contractPath: value.contractPath, baseline: value.baseline, contract };
}

export function appliesTo(plan: Plan | null | undefined, git: GitContext | null): plan is Plan {
  return !!plan && !!git?.available && plan.branch === git.headBranch && plan.contractPath === git.relPath;
}

export async function readPlan(host: OrbitHost, git: GitContext | null, previous?: PlanFile | null): Promise<PlanFile | null> {
  const path = planPath(git);
  if (!path) return null;
  const stat = await host.statFile(path);
  if (!stat.exists) return null;
  if (previous && stat.sha256 === previous.sha) return previous;
  const snapshot = await host.readFile(path);
  try {
    return { sha: snapshot.sha256, plan: parsePlan(snapshot.text) };
  } catch (error) {
    return { sha: snapshot.sha256, plan: null, error: `Invalid ${PLAN_FILE}: ${(error as Error).message}` };
  }
}
