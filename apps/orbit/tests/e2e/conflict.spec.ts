import { expect, test } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import { FILE, TASKY, externalWrite, fileText, launch, writes } from './helpers';

const ext = TASKY.replace('"summary": "A small personal task manager that keeps everything in your browser"', '"summary": "Edited by another program"');

test.describe('AC-06 concurrent change safeguard', () => {
  test('external edit with unsaved Orbit edits: banner, conflict dialog, never a silent overwrite', async ({ page }) => {
    await launch(page, { path: FILE });
    const name = page.getByLabel('Entity name');
    await name.fill('My unsaved rename');
    await name.press('Enter');
    await externalWrite(page, FILE, ext);
    const banner = page.getByTestId('banner-external');
    await expect(banner).toContainText('changed on disk while you have unsaved edits');
    await expect(name).toHaveValue('My unsaved rename'); // not replaced

    await page.keyboard.press('Control+s');
    const dlg = page.getByRole('alertdialog', { name: /changed on disk since you opened it/ });
    await expect(dlg).toBeVisible();
    expect(await writes(page)).toBe(0);
    expect(await fileText(page, FILE)).toBe(ext); // their version intact

    await dlg.getByRole('button', { name: 'Review differences' }).click();
    const sheet = page.getByRole('dialog', { name: 'Review differences' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('change-row').first()).toBeVisible();
    await expect(sheet).toContainText('Disk version → your version');
    await sheet.getByTestId('change-row').first().click();
    await expect(sheet.getByTestId('change-detail')).toBeVisible();
    await page.keyboard.press('Escape');

    // still dirty, still not overwritten
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'true');
    expect(await fileText(page, FILE)).toBe(ext);

    // Reload from disk (confirm) discards mine and takes theirs
    await banner.getByRole('button', { name: 'Reload from disk' }).click();
    await page.getByRole('alertdialog', { name: 'Reload from disk?' }).getByRole('button', { name: /Discard my changes and reload/ }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByLabel('Entity name')).toHaveValue('Task Management');
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
    await page.getByRole('button', { name: /Product settings/ }).click();
    await expect(page.getByLabel('Product summary')).toHaveValue('Edited by another program');
  });

  test('Save As from the conflict dialog keeps both versions', async ({ page }) => {
    await launch(page, { path: FILE, savePicks: ['/work/tasky/mine.orbit.json'] });
    const name = page.getByLabel('Entity name');
    await name.fill('Mine');
    await name.press('Enter');
    await externalWrite(page, FILE, ext);
    await page.keyboard.press('Control+s');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save As…' }).click();
    await expect(page.getByTestId('file-name')).toContainText('mine.orbit.json');
    expect(await fileText(page, FILE)).toBe(ext);
    const mine = parseContract((await fileText(page, '/work/tasky/mine.orbit.json'))!).contract!;
    expect(mine.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('Mine');
  });

  test('clean document reloads automatically with a toast', async ({ page }) => {
    await launch(page, { path: FILE });
    await externalWrite(page, FILE, ext);
    await expect(page.getByTestId('toast').filter({ hasText: 'Reloaded — file changed on disk' })).toBeVisible();
    await page.getByRole('button', { name: /Product settings/ }).click();
    await expect(page.getByLabel('Product summary')).toHaveValue('Edited by another program');
  });

  test('deleted file: banner offers to recreate; Save writes it back', async ({ page }) => {
    await launch(page, { path: FILE });
    await page.evaluate((p) => window.__orbitMemoryHost!.externalDelete(p), FILE);
    const banner = page.getByTestId('banner-deleted');
    await expect(banner).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Save As…' })).toBeVisible();
    await banner.getByRole('button', { name: 'Save to recreate' }).click();
    await expect(banner).toHaveCount(0);
    expect(parseContract((await fileText(page, FILE))!).ok).toBe(true);
  });
});
