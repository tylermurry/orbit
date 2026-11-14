import path from 'node:path';
import { test, expect } from '@playwright/test';
import { DEMO, ROOT, launch } from './helpers';

const out = (n: string) => path.join(ROOT, 'docs/screenshots', `orbit-${n}.png`);

test.describe('screenshots (1280x800, light)', () => {
  test('empty state', async ({ page }) => {
    await launch(page, { initial: false });
    await expect(page.getByRole('button', { name: 'Open contract…' })).toBeVisible();
    await page.screenshot({ path: out('empty-state') });
  });

  test('product, engineering, raw, library', async ({ page }) => {
    await launch(page, { git: true });
    await page.getByRole('treeitem', { name: /Today and Overdue/ }).click();
    await expect(page.getByTestId('entity-detail')).toContainText('Today and Overdue');
    await page.screenshot({ path: out('product') });

    await page.keyboard.press('Control+2');
    await expect(page.getByRole('tree', { name: 'Systems' })).toBeVisible();
    await page.getByRole('treeitem', { name: /Local Date Evaluation/ }).click();
    await page.screenshot({ path: out('engineering') });

    await page.keyboard.press('Control+1');
    await page.getByRole('treeitem', { name: /Today and Overdue/ }).click();
    await page.getByTestId('graph').scrollIntoViewIfNeeded();
    await page.getByRole('heading', { name: /Relationships/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: out('relationships') });
    await page.keyboard.press('Control+2');

    await page.getByRole('button', { name: 'Raw JSON' }).click();
    await expect(page.getByRole('textbox', { name: 'Raw JSON' })).toBeVisible();
    await page.screenshot({ path: out('raw-json') });

    await page.getByRole('button', { name: 'Raw JSON' }).click();
    await page.getByRole('button', { name: 'Tests & evidence' }).click();
    await expect(page.getByRole('dialog')).toContainText('never runs tests');
    await page.screenshot({ path: out('tests-evidence') });
    await page.getByRole('tab', { name: /Evidence/ }).click();
    await page.screenshot({ path: out('tests-evidence-records') });
  });

  test('impact', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.implementation });
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('impact-view')).toBeVisible();
    await expect(page.getByTestId('change-row').first()).toBeVisible();
    await page.screenshot({ path: out('impact') });
    await page.getByTestId('tab-affected').click();
    await page.screenshot({ path: out('impact-affected') });
    await page.getByRole('tab', { name: /Changes/ }).click();
    await page.keyboard.press('Control+1');
    await page.screenshot({ path: out('product-compare') });
  });

  test('invalid file', async ({ page }) => {
    const { INVALID } = await import('./helpers');
    await launch(page, { text: INVALID });
    await expect(page.getByRole('dialog', { name: 'Diagnostics' })).toBeVisible();
    await page.screenshot({ path: out('invalid-diagnostics') });
  });
});
