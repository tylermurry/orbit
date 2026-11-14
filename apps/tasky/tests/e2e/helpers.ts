import type { Page } from '@playwright/test';

/** Fixed "now" for every test: noon on 2026-06-15 in America/New_York (EDT, UTC-4). */
export const NOW = '2026-06-15T12:00:00-04:00';
export const TODAY = '2026-06-15';
export const STORAGE_KEY = 'tasky:v1';

interface SeedTask {
  id: string;
  title: string;
  notes?: string;
  dueDate?: string | null;
  completed?: boolean;
  listId?: string;
  /** Seconds after a fixed epoch; controls createdAt ordering. */
  created?: number;
}

export interface Seed {
  lists?: { id: string; name: string }[];
  tasks?: SeedTask[];
}

/** Builds a valid stored document so tests start from known, isolated data. */
export function makeData(seed: Seed = {}) {
  const stamp = (s: number) => new Date(Date.UTC(2026, 5, 1, 0, 0, s)).toISOString();
  return {
    version: 1,
    lists: (seed.lists ?? []).map((l, i) => ({ ...l, createdAt: stamp(i) })),
    tasks: (seed.tasks ?? []).map((t, i) => ({
      id: t.id,
      title: t.title,
      notes: t.notes ?? '',
      dueDate: t.dueDate ?? null,
      completed: t.completed ?? false,
      listId: t.listId ?? 'inbox',
      createdAt: stamp(100 + (t.created ?? i)),
      updatedAt: stamp(100 + (t.created ?? i)),
    })),
  };
}

/** Writes raw text to localStorage once per tab (a reload must not overwrite what the app saved). */
export async function seedRaw(page: Page, raw: string) {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('e2e-seeded')) {
        localStorage.setItem(key, value);
        sessionStorage.setItem('e2e-seeded', '1');
      }
    },
    [STORAGE_KEY, raw],
  );
}

export async function open(page: Page, seed?: Seed | 'fresh', now: string = NOW) {
  await page.clock.setFixedTime(now);
  if (seed !== 'fresh') await seedRaw(page, JSON.stringify(makeData(seed ?? {})));
  await page.goto('/');
}

export const nav = (page: Page) => page.getByRole('navigation', { name: 'Lists' });

export async function go(page: Page, name: string) {
  await nav(page).getByRole('button', { name: new RegExp(`^${name}\\b`) }).click();
}

export const rowTitles = (page: Page) => page.getByRole('list', { name: /tasks$/ }).getByRole('listitem').locator('.task-title');
