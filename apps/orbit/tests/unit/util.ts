import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryHost } from '../../src/host/memoryHost';
import type { MemoryHost, MemorySeed } from '../../src/host/memoryHost';
import { createController } from '../../src/state/controller';
import { createStore } from '../../src/state/store';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
export const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
export const TASKY = read('examples/tasky.orbit.json');
export const INVALID = read('examples/invalid.orbit.json');
export const DEMO_BASE = read('examples/demo/01-base.orbit.json');
export const DEMO_IMPL = read('examples/demo/04-implementation.orbit.json');

export const FILE = '/work/repo/tasky.orbit.json';
export const SHA1 = 'a1'.repeat(20);
export const SHA2 = 'b2'.repeat(20);

export function setup(seed: Partial<MemorySeed> = {}, text: string = TASKY) {
  const host: MemoryHost = createMemoryHost({ files: { [FILE]: text }, ...seed });
  const store = createStore();
  const ctrl = createController(store, host);
  return { host, store, ctrl };
}

export function gitSeed(headText: string = DEMO_BASE): NonNullable<MemorySeed['git']> {
  return {
    repoRoot: '/work/repo',
    commits: {
      [SHA1]: { subject: 'base', date: '2026-11-01T00:00:00Z', files: { 'tasky.orbit.json': headText } },
      [SHA2]: { subject: 'impl', date: '2026-11-02T00:00:00Z', files: { 'tasky.orbit.json': DEMO_IMPL } },
    },
    refs: [
      { name: 'main', kind: 'branch', commit: SHA1 },
      { name: 'impl', kind: 'branch', commit: SHA2 },
    ],
    head: { branch: 'main' },
  };
}
