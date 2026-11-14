import { expect, test } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import { FILE, TASKY, fileText, launch } from './helpers';

test.describe('AC-01 no file: open / create', () => {
  test('shows open and create actions, creates a schema-valid empty contract and opens it', async ({ page }) => {
    const newPath = '/home/user/shop/shop-floor.orbit.json';
    await launch(page, { initial: false, savePicks: [newPath] });
    await expect(page.getByRole('heading', { name: 'Orbit' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open contract…' })).toBeVisible();
    await expect(page.getByText('examples/tasky.orbit.json')).toBeVisible();

    await page.getByRole('button', { name: 'Create new contract' }).click();
    const dlg = page.getByRole('dialog', { name: 'Create new contract' });
    await dlg.getByLabel('Product name').fill('Shop Floor');
    await expect(dlg.getByLabel('Product id')).toHaveValue('shop-floor'); // suggested slug
    await expect(dlg.getByRole('button', { name: /Choose location/ })).toBeDisabled(); // summary required
    await dlg.getByLabel('Product summary').fill('Plans the shop floor');
    await dlg.getByRole('button', { name: /Choose location/ }).click();

    await expect(page.getByTestId('file-name')).toContainText('shop-floor.orbit.json');
    await expect(page.getByText('No capabilities yet.')).toBeVisible();
    const parsed = parseContract((await fileText(page, newPath))!);
    expect(parsed.ok).toBe(true);
    expect(parsed.contract).toMatchObject({ schemaVersion: 1, product: { id: 'shop-floor', name: 'Shop Floor', summary: 'Plans the shop floor' }, entities: [], relationships: [], tests: [], evidence: [] });
    // recent files are remembered
    await page.reload();
    await expect(page.getByLabel('Open shop-floor.orbit.json')).toBeVisible();
  });

  test('Open contract opens a picked file; cancelled pick does nothing', async ({ page }) => {
    await launch(page, { initial: false, path: FILE, openPicks: [null, FILE] });
    await page.getByRole('button', { name: 'Open contract…' }).click();
    await expect(page.getByRole('button', { name: 'Open contract…' })).toBeVisible();
    await page.getByRole('button', { name: 'Open contract…' }).click();
    await expect(page.getByTestId('entity-detail')).toBeVisible();
    await expect(page.getByTestId('file-name')).toContainText('tasky.orbit.json');
  });

  test('a file with unsaved changes asks before another file replaces it', async ({ page }) => {
    await launch(page, { path: FILE, files: { '/work/other.orbit.json': TASKY.replace('"Tasky"', '"Other"') }, openPicks: ['/work/other.orbit.json'] });
    await page.getByLabel('Entity name').fill('Dirty Name');
    await page.getByLabel('Entity name').press('Enter');
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'true');
    await page.getByRole('button', { name: 'Open contract' }).click();
    const dlg = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByLabel('Entity name')).toHaveValue('Dirty Name');
    await page.getByRole('button', { name: 'Open contract' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard changes' }).click();
    await expect(page.getByRole('button', { name: /Product settings for Other/ })).toBeVisible();
  });
});

test.describe('shell polish', () => {
  test('window title, product settings, shortcut help, undo/redo', async ({ page }) => {
    await launch(page, { path: FILE });
    await expect(page).toHaveTitle('Tasky — tasky.orbit.json — Orbit');
    await page.getByLabel('Entity name').fill('Renamed Capability');
    await page.getByLabel('Entity name').press('Enter');
    await expect(page).toHaveTitle('● Tasky — tasky.orbit.json — Orbit');
    await expect(page.getByTestId('file-name').getByRole('img', { name: 'Unsaved changes' })).toBeVisible();

    // structured undo / redo via keyboard (focus outside text fields)
    await page.getByRole('tree').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByLabel('Entity name')).toHaveValue('Task Discovery');
    await expect(page).toHaveTitle('Tasky — tasky.orbit.json — Orbit');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByLabel('Entity name')).toHaveValue('Renamed Capability');
    await page.keyboard.press('Control+z');

    await page.getByRole('button', { name: /Product settings for Tasky/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Product settings' });
    await dlg.getByLabel('Product name').fill('Tasky Pro');
    await dlg.getByLabel('Product summary').fill('A summary');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveTitle('● Tasky Pro — tasky.orbit.json — Orbit');

    await page.getByRole('tree').focus();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Recent files' }).hover();
    await expect(page.getByRole('menuitem', { name: /tasky.orbit.json/ })).toBeVisible();
  });
});
