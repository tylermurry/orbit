import { expect, test } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import { FILE, INVALID, TASKY, fileText, launch, writes } from './helpers';

const raw = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Raw JSON' });

test.describe('AC-04 raw JSON', () => {
  test('edit a valid field, apply, structured view reflects it, save persists', async ({ page }) => {
    await launch(page, { path: FILE });
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    await expect(raw(page)).toBeVisible();
    await expect(page.getByTestId('raw-validity')).toContainText('Valid');
    await expect(page.getByRole('button', { name: 'Apply' })).toBeDisabled();

    await raw(page).fill(TASKY.replace('"name": "Task Discovery"', '"name": "Discovery (raw)"'));
    await expect(page.getByTestId('raw-unapplied')).toContainText('Raw edits not applied');
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'true');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('raw-unapplied')).toHaveCount(0);
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    await expect(page.getByRole('treeitem', { name: /^Discovery \(raw\)/ })).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
    const c = parseContract((await fileText(page, FILE))!).contract!;
    expect(c.entities.find((e) => e.id === 'cap.task-discovery')!.name).toBe('Discovery (raw)');
  });

  test('malformed JSON is never applied or saved; diagnostics point at the line; leaving prompts', async ({ page }) => {
    await launch(page, { path: FILE });
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    const broken = TASKY.replace('"schemaVersion": 1,', '"schemaVersion": 1,,');
    await raw(page).fill(broken);
    await expect(page.getByTestId('raw-validity')).toContainText(/error/);
    const diag = page.getByRole('region', { name: 'Raw JSON diagnostics' });
    await expect(diag).toContainText(/line 2/);

    // clicking a diagnostic moves the caret to the line
    await diag.getByRole('button').first().click();
    const caretLine = await raw(page).evaluate((el: HTMLTextAreaElement) => el.value.slice(0, el.selectionStart).split('\n').length);
    expect(caretLine).toBe(2);

    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('raw-unapplied')).toBeVisible(); // still not applied
    await expect(page.getByTestId('toast').filter({ hasText: 'Raw edits not applied' })).toBeVisible();

    // switching away prompts
    await page.getByRole('radio', { name: 'Product' }).click();
    const prompt = page.getByRole('alertdialog', { name: 'Unapplied raw edits' });
    await expect(prompt).toBeVisible();
    await prompt.getByRole('button', { name: 'Stay' }).click();
    await expect(raw(page)).toHaveValue(broken);

    // save asks; Fix first leaves the disk untouched
    await page.keyboard.press('Control+s');
    const dlg = page.getByRole('alertdialog', { name: 'This text has errors' });
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Fix first' }).click();
    expect(await fileText(page, FILE)).toBe(TASKY);
    expect(await writes(page)).toBe(0);

    // Discard returns to the last valid structured state
    await page.getByRole('radio', { name: 'Product' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Discard' }).click();
    await expect(page.getByTestId('entity-detail')).toBeVisible();
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
  });

  test('valid unapplied raw edit: save asks to apply first; Format and Revert work', async ({ page }) => {
    await launch(page, { path: FILE });
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    await raw(page).fill(TASKY.replace('"name": "Task Discovery"', '"name": "Applied On Save"'));
    await page.keyboard.press('Control+s');
    const dlg = page.getByRole('alertdialog', { name: 'Apply raw edits before saving?' });
    await dlg.getByRole('button', { name: 'Apply and save' }).click();
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
    expect(parseContract((await fileText(page, FILE))!).contract!.entities.find((e) => e.id === 'cap.task-discovery')!.name).toBe('Applied On Save');

    await raw(page).fill('{"schemaVersion":1}');
    await page.getByRole('button', { name: 'Revert raw' }).click();
    await expect(raw(page)).toHaveValue(/Applied On Save/);
    await raw(page).fill(JSON.stringify(JSON.parse((await fileText(page, FILE))!)));
    await page.getByRole('button', { name: 'Format' }).click();
    await expect(raw(page)).toHaveValue(/\n {2}"schemaVersion": 1,\n/);
  });

  test('save anyway writes the exact user text, never a reconstruction', async ({ page }) => {
    await launch(page, { path: FILE });
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    const text = TASKY.replace('"kind": "capability"', '"kind": "wizard"');
    await raw(page).fill(text);
    await page.keyboard.press('Control+s');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save anyway' }).click();
    await expect.poll(() => fileText(page, FILE)).toBe(text);
  });
});

test.describe('AC-05 structural safeguards', () => {
  test('invalid fixture: diagnostics with ids and lines, valid parts shown read-only, nothing is repaired', async ({ page }) => {
    await launch(page, { path: FILE, text: INVALID });
    const sheet = page.getByRole('dialog', { name: 'Diagnostics' });
    await expect(sheet).toBeVisible();
    const items = sheet.getByRole('listitem');
    expect(await items.count()).toBeGreaterThanOrEqual(8);
    const text = await sheet.innerText();
    for (const needle of ["Duplicate entity id 'cap.tasks'", "parentId 'cap.nowhere'", 'parent cycle', 'which is a system', 'unknown property', "Duplicate behavior id 'behavior.shared'", 'not defined in tests']) {
      expect(text).toContain(needle);
    }
    expect(text).toMatch(/Line \d+/);
    // codes cover bad enum / timestamps / refs too
    expect(text).toMatch(/schema\./);

    await page.keyboard.press('Escape');
    const banner = page.getByTestId('banner-invalid');
    await expect(banner).toContainText('Showing the valid parts read-only. Fix them in Raw JSON.');
    await expect(page.getByTestId('diag-count')).toBeVisible();
    // valid parts are visible but read-only
    await expect(page.getByRole('treeitem', { name: /^Task Management/ })).toBeVisible();
    await page.getByRole('treeitem', { name: /^Task Management/ }).click();
    await expect(page.getByLabel('Entity name')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Add capability' })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Delete Task Management/ })).toHaveCount(0);

    // saving is a no-op: the original text on disk is untouched
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('toast').filter({ hasText: 'Nothing to save' })).toBeVisible();
    expect(await fileText(page, FILE)).toBe(INVALID);
    expect(await writes(page)).toBe(0);

    // jump from a diagnostic to the raw line; the original text is shown unchanged
    await banner.getByRole('button', { name: 'Diagnostics' }).click();
    await sheet.getByRole('button', { name: /Show line \d+ in Raw JSON/ }).first().click();
    await expect(raw(page)).toHaveValue(INVALID);

    // repair in raw: apply a valid document, then save
    await raw(page).fill(TASKY);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('toast').filter({ hasText: 'Raw edits applied' })).toBeVisible();
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
    expect(parseContract((await fileText(page, FILE))!).ok).toBe(true);
  });

  test('syntax-broken file opens straight into Raw JSON with diagnostics and untouched text', async ({ page }) => {
    const broken = '{\n  "schemaVersion": 1,\n  "product": {\n';
    await launch(page, { path: FILE, text: broken });
    await expect(raw(page)).toBeVisible();
    await expect(raw(page)).toHaveValue(broken);
    await expect(page.getByRole('region', { name: 'Raw JSON diagnostics' })).toContainText(/line \d+/);
    await expect(page.getByText('not valid JSON, so there is nothing to show')).toBeVisible();
    await page.keyboard.press('Control+s');
    expect(await fileText(page, FILE)).toBe(broken);
    // views cannot be entered until it parses
    await page.getByRole('radio', { name: 'Impact' }).click();
    await expect(raw(page)).toBeVisible();
  });

  test('semantic problems from a raw edit are listed with ids; structured pickers prevent invalid references', async ({ page }) => {
    await launch(page, { path: FILE });
    await page.getByRole('button', { name: 'Raw JSON' }).click();
    const bad = TASKY.replace('"parentId": "cap.task-management",', '"parentId": "sys.local-data",');
    await raw(page).fill(bad);
    const diag = page.getByRole('region', { name: 'Raw JSON diagnostics' });
    await expect(diag).toContainText(/which is a system|must have capability parents/);
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(page.getByTestId('raw-unapplied')).toBeVisible();
  });
});
