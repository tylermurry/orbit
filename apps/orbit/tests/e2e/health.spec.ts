import { expect, test } from '@playwright/test';
import { DEMO, launch } from './helpers';

test('a full tour produces no console errors or React warnings', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e}`));
  page.on('console', (m) => {
    if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('[vite]')) problems.push(`${m.type()}: ${m.text()}`);
  });
  await launch(page, { git: true, text: DEMO.implementation });
  await page.getByRole('treeitem', { name: /^Today and Overdue/ }).click();
  await page.getByRole('button', { name: 'Add behavior' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Add relationship' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+2');
  await page.keyboard.press('Control+3');
  await expect(page.getByTestId('change-row').first()).toBeVisible();
  await page.getByTestId('change-row').nth(2).click();
  await page.getByTestId('tab-affected').click();
  await page.getByRole('button', { name: 'View actual details' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View proposal details' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Raw JSON' }).click();
  await page.getByRole('button', { name: 'Raw JSON' }).click();
  await page.getByRole('button', { name: 'Tests & evidence' }).click();
  await page.getByRole('tab', { name: /Evidence/ }).click();
  await page.getByRole('button', { name: 'Add evidence' }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /Diagnostics/ }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+1');
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.keyboard.press('Escape');
  expect(problems).toEqual([]);
});
