import { expect, test } from '@playwright/test';
import { STORAGE_KEY, go, makeData, nav, open, rowTitles, seedRaw } from './helpers';

test.describe('persistence and demo data', () => {
  test('lists and tasks survive a reload [test.tasky.persistence.reload]', async ({ page }) => {
    await open(page, 'fresh');
    await page.getByRole('button', { name: 'New list' }).click();
    await page.getByLabel('List name').fill('Reading');
    await page.getByRole('button', { name: 'Create list' }).click();
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByLabel('Title').fill('Finish novel');
    await page.getByLabel('Due date').fill('2026-06-30');
    await page.getByRole('button', { name: 'Add task' }).click();
    await page.getByRole('checkbox', { name: "Mark 'Finish novel' complete" }).click();
    await page.reload();
    await go(page, 'Reading');
    await page.getByLabel('Show completed').check();
    await expect(rowTitles(page)).toHaveText(['Finish novel']);
    await expect(page.getByRole('checkbox', { name: "Mark 'Finish novel' incomplete" })).toBeVisible();
  });

  test('corrupt stored data shows a banner and is never overwritten [test.tasky.persistence.corrupt-data]', async ({ page }) => {
    const raw = '{"version":1,"lists":[';
    await page.clock.setFixedTime('2026-06-15T12:00:00-04:00');
    await seedRaw(page, raw);
    await page.goto('/');
    const banner = page.getByRole('alert').filter({ hasText: 'could not read your saved data' });
    await expect(banner).toBeVisible();
    await expect(page.getByRole('button', { name: 'New task' })).toBeDisabled();
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(raw);
    await page.reload();
    await expect(banner).toBeVisible();
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(raw);

    const downloadPromise = page.waitForEvent('download');
    await banner.getByRole('button', { name: 'Download raw data' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('tasky-raw-data.json');
    const fs = await import('node:fs/promises');
    expect(await fs.readFile(await download.path(), 'utf8')).toBe(raw);
    expect(await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)).toBe(raw);
  });

  test('start fresh keeps a backup copy under another key [test.tasky.persistence.start-fresh]', async ({ page }) => {
    const raw = 'definitely not json';
    await page.clock.setFixedTime('2026-06-15T12:00:00-04:00');
    await seedRaw(page, raw);
    await page.goto('/');
    await page.getByRole('button', { name: /^Start fresh/ }).click();
    await expect(page.getByText('could not read your saved data')).toBeHidden();
    const state = await page.evaluate(() => ({
      main: localStorage.getItem('tasky:v1'),
      backups: Object.keys(localStorage)
        .filter((k) => k.startsWith('tasky:v1:backup:'))
        .map((k) => localStorage.getItem(k)),
    }));
    expect(state.main).toBeNull();
    expect(state.backups).toEqual([raw]);
    await expect(page.getByTestId('welcome')).toBeVisible();
  });

  test('first run offers to load demo data with lists and dated tasks [test.tasky.demo.load]', async ({ page }) => {
    await open(page, 'fresh');
    await expect(page.getByTestId('welcome')).toBeVisible();
    await page.getByRole('button', { name: 'Load demo data' }).click();
    for (const name of ['Personal', 'Work', 'Errands']) {
      await expect(nav(page).getByRole('button', { name: new RegExp(`^${name}`) })).toBeVisible();
    }
    await go(page, 'Today');
    await expect(page.getByText('Overdue', { exact: true }).first()).toBeVisible();
    await expect(rowTitles(page).first()).toBeVisible();
    await go(page, 'All Tasks');
    expect(await rowTitles(page).count()).toBeGreaterThanOrEqual(10);
  });

  test('reset demo data asks for confirmation before replacing data [test.tasky.demo.reset]', async ({ page }) => {
    await open(page, { tasks: [{ id: 'mine', title: 'My own task' }] });
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    const dialog = page.getByRole('dialog', { name: 'Reset demo data?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(rowTitles(page)).toHaveText(['My own task']);
    await page.getByRole('button', { name: 'Reset demo data' }).click();
    await page.getByRole('dialog', { name: 'Reset demo data?' }).getByRole('button', { name: 'Replace with demo data' }).click();
    await expect(nav(page).getByRole('button', { name: /^Personal/ })).toBeVisible();
    await go(page, 'All Tasks');
    await expect(page.getByText('My own task')).toHaveCount(0);
  });

  test('existing data is never silently reseeded, even when empty [test.tasky.demo.no-auto-reseed]', async ({ page }) => {
    await open(page, {});
    await expect(page.getByTestId('welcome')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Inbox is empty' })).toBeVisible();
    await expect(nav(page).getByRole('button', { name: /^Personal/ })).toHaveCount(0);
    expect(JSON.parse((await page.evaluate((k) => localStorage.getItem(k), STORAGE_KEY)) as string)).toEqual(makeData({}));
  });
});
