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

    await expect(page).toHaveTitle('Shop Floor — shop-floor.orbit.json — Orbit');
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
    await expect(page.getByRole('button', { name: 'Switch project (Tasky)' })).toBeVisible();
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
    await expect(page.getByRole('button', { name: 'Switch project (Other)' })).toBeVisible();
  });

  test('switches between recent projects from the product-name menu', async ({ page }) => {
    const current = '/work/tasky/orbit.json';
    const other = '/work/other/orbit.json';
    await page.addInitScript((path) => localStorage.setItem('orbit.recent', JSON.stringify([path])), other);
    await launch(page, { path: current, files: { [other]: TASKY.replace('"Tasky"', '"Other Project"') } });
    const tasky = page.getByRole('button', { name: 'Switch project (Tasky)' });
    await expect(tasky).toHaveText('Tasky');
    await tasky.click();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem').first()).toHaveText('Product Settings');
    await expect.poll(async () => {
      const toolbar = await page.getByRole('banner', { includeHidden: true }).boundingBox();
      const popup = await menu.boundingBox();
      return !!toolbar && !!popup && Math.abs(popup.x - toolbar.x) < 1 && Math.abs(popup.y - toolbar.y - toolbar.height) < 1;
    }).toBe(true);
    await expect(menu.getByRole('menuitemradio', { name: /Tasky/ })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: /Other Project/ }).click();
    await expect(page).toHaveTitle('Other Project — orbit.json — Orbit');

    const entity = page.getByLabel('Entity name');
    await entity.fill('Unsaved name');
    await entity.press('Enter');
    const otherProject = page.getByRole('button', { name: 'Switch project (Other Project)' });
    await otherProject.click();
    await menu.getByRole('menuitemradio', { name: /Tasky/ }).click();
    const prompt = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await expect(entity).toHaveValue('Unsaved name');
    await otherProject.click();
    await menu.getByRole('menuitemradio', { name: /Tasky/ }).click();
    await prompt.getByRole('button', { name: 'Discard changes' }).click();
    await expect(tasky).toBeVisible();
  });
});

test.describe('shell polish', () => {
  test('window title, product settings, shortcut help, undo/redo', async ({ page }) => {
    await launch(page, { path: FILE });
    await expect(page).toHaveTitle('Tasky — tasky.orbit.json — Orbit');
    await page.getByLabel('Entity name').fill('Renamed Capability');
    await page.getByLabel('Entity name').press('Enter');
    await expect(page).toHaveTitle('● Tasky — tasky.orbit.json — Orbit');
    await expect(page.getByTestId('unsaved-label')).toBeVisible();

    // structured undo / redo via keyboard (focus outside text fields)
    await page.getByRole('tree').focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByLabel('Entity name')).toHaveValue('Task Management');
    await expect(page).toHaveTitle('Tasky — tasky.orbit.json — Orbit');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByLabel('Entity name')).toHaveValue('Renamed Capability');
    await page.keyboard.press('Control+z');

    await page.getByRole('button', { name: 'Switch project (Tasky)' }).click();
    await page.getByRole('menuitem', { name: 'Product Settings' }).click();
    const dlg = page.getByRole('dialog', { name: 'Product settings' });
    await dlg.getByLabel('Product name').fill('Tasky Pro');
    await dlg.getByLabel('Product summary').fill('A summary');
    await dlg.getByRole('button', { name: 'Apply' }).click();
    await expect(page).toHaveTitle('● Tasky Pro — tasky.orbit.json — Orbit');

    await page.getByRole('tree').focus();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0);
    await page.getByRole('button', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Recent Files' }).hover();
    await expect(page.getByRole('menuitem', { name: /tasky.orbit.json/ })).toBeVisible();
  });
});
