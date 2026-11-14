import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { MemorySeed } from '../../src/host/memoryHost';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../../..');
export const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

export const TASKY = read('examples/tasky.orbit.json');
export const INVALID = read('examples/invalid.orbit.json');
export const DEMO = {
  base: read('examples/demo/01-base.orbit.json'),
  reformatted: read('examples/demo/02-reformatted.orbit.json'),
  proposal: read('examples/demo/03-proposal.orbit.json'),
  implementation: read('examples/demo/04-implementation.orbit.json'),
};

export const REPO = '/work/tasky';
export const FILE = `${REPO}/tasky.orbit.json`;
export const REL = 'tasky.orbit.json';
export const SHA = {
  base: 'a1'.repeat(20),
  reformat: 'b2'.repeat(20),
  proposal: 'c3'.repeat(20),
  impl: 'd4'.repeat(20),
};

/** A fake git repository: main -> base, branch proposal, branch implementation, tag v1 -> base, reformat commit. */
export function gitSeed(opts: { head?: 'main' | 'proposal' | 'detached' } = {}): NonNullable<MemorySeed['git']> {
  return {
    repoRoot: REPO,
    commits: {
      [SHA.base]: { subject: 'Base contract', date: '2026-11-01T10:00:00Z', files: { [REL]: DEMO.base } },
      [SHA.reformat]: { subject: 'Reformat contract', date: '2026-11-02T10:00:00Z', files: { [REL]: DEMO.reformatted } },
      [SHA.proposal]: { subject: 'Propose overdue behavior', date: '2026-11-03T10:00:00Z', files: { [REL]: DEMO.proposal } },
      [SHA.impl]: { subject: 'Implement notes editing', date: '2026-11-04T10:00:00Z', files: { [REL]: DEMO.implementation } },
    },
    refs: [
      { name: 'main', kind: 'branch', commit: SHA.base },
      { name: 'proposal', kind: 'branch', commit: SHA.proposal },
      { name: 'implementation', kind: 'branch', commit: SHA.impl },
      { name: 'reformat', kind: 'branch', commit: SHA.reformat },
      { name: 'v1', kind: 'tag', commit: SHA.base },
    ],
    head: opts.head === 'detached' ? { commit: SHA.base } : { branch: opts.head === 'proposal' ? 'proposal' : 'main' },
  };
}

export interface Opts {
  text?: string;
  git?: boolean | NonNullable<MemorySeed['git']>;
  noGitReason?: 'git-missing' | 'not-a-repo';
  files?: Record<string, string>;
  initial?: boolean;
  path?: string;
  openPicks?: (string | null)[];
  savePicks?: (string | null)[];
  pollMs?: number;
}

export async function launch(page: Page, o: Opts = {}) {
  const p = o.path ?? (o.git ? FILE : '/home/user/tasky.orbit.json');
  const seed: MemorySeed = {
    files: { [p]: o.text ?? TASKY, ...(o.files ?? {}) },
    initialFile: o.initial === false ? null : p,
    git: o.git ? (o.git === true ? gitSeed() : o.git) : null,
    gitUnavailable: o.noGitReason,
    openPicks: o.openPicks,
    savePicks: o.savePicks,
    pollMs: o.pollMs ?? 300,
  };
  await page.addInitScript((s) => {
    (window as unknown as { __ORBIT_TEST_HOST__: unknown }).__ORBIT_TEST_HOST__ = s;
  }, seed);
  await page.goto('/');
  return p;
}

export const fileText = (page: Page, p: string) => page.evaluate((x) => window.__orbitMemoryHost!.getFile(x), p);
export const externalWrite = (page: Page, p: string, t: string) => page.evaluate(([x, y]) => window.__orbitMemoryHost!.externalWrite(x, y), [p, t]);
export const writes = (page: Page) => page.evaluate(() => window.__orbitMemoryHost!.writes.length);
