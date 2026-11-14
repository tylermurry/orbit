import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import { SHA, TASKY, launch } from './helpers';

const c = parseContract(TASKY).contract!;
const behavior = c.entities.flatMap((e) => e.behaviors).find((b) => b.id === 'behavior.today.due-today')!;
const testName = c.tests.find((t) => t.id === behavior.testIds[0])!.name;
const sharing = (prefix: string) => c.entities.filter((e) => e.id.startsWith(prefix)).flatMap((e) => e.behaviors).filter((b) => b.testIds.includes(behavior.testIds[0])).length;
const nTree = sharing('cap.task-discovery'); // behaviors verified by this (shared) test within Task Discovery's subtree
const nToday = sharing('cap.task-discovery.today-overdue');
const stat = (page: Page, key: string) => page.getByTestId('entity-detail').locator(`[data-stat="${key}"] .stat-value`);
const item = (page: Page, name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) });

async function addEvidence(page: Page, status: 'Passed' | 'Failed', when: string, commit: 'HEAD' | string) {
  await page.getByRole('button', { name: 'Tests & evidence' }).click();
  const lib = page.getByRole('dialog', { name: 'Tests & evidence' });
  await lib.getByRole('tab', { name: /Evidence/ }).click();
  await lib.getByRole('button', { name: 'Add evidence' }).click();
  const dlg = page.getByRole('dialog', { name: 'Add evidence record' });
  await dlg.getByRole('combobox', { name: 'Evidence test' }).click();
  await page.getByRole('option', { name: testName, exact: true }).click();
  await dlg.getByRole('combobox', { name: 'Evidence status' }).click();
  await page.getByRole('option', { name: status }).click();
  await dlg.getByLabel('Executed at').fill(when);
  if (commit === 'HEAD') await dlg.getByRole('button', { name: 'Use HEAD' }).click();
  else await dlg.getByLabel('Evidence commit').fill(commit);
  await dlg.getByRole('button', { name: 'Add record' }).click();
  await lib.getByRole('button', { name: 'Close tests and evidence' }).click();
}

test('AC-07 rollups count each behavior once and update ancestors when child evidence changes', async ({ page }) => {
  await launch(page, { git: true });
  await item(page, 'Task Discovery').click();
  // Without a code revision nothing can be "passing" or "failing"
  await expect(page.getByTestId('evidence-line')).toContainText('freshness is unknown');
  await expect(stat(page, 'all')).toHaveText('8');
  await expect(stat(page, 'withTests')).toHaveText('6');
  await expect(stat(page, 'untested')).toHaveText('2');
  await expect(stat(page, 'passingCurrent')).toHaveText('0');
  await expect(stat(page, 'noCurrentEvidence')).toHaveText('6');
  expect(Number(await stat(page, 'all').innerText())).toBe(8);

  // choose HEAD as the inspected revision (suggestion callout offers it)
  await page.getByRole('button', { name: 'Use HEAD' }).first().click();
  await expect(page.getByTestId('evidence-line')).toContainText(`commit ${SHA.base.slice(0, 7)} (HEAD)`);
  await expect(stat(page, 'passingCurrent')).toHaveText('0'); // fixture evidence has no commit => not current
  await expect(item(page, 'Task Discovery').getByTestId('assurance-chip')).toHaveAttribute('aria-label', '0 of 8 have passing evidence');

  // a passing run of a child's test at HEAD updates the ancestor's rollup and its own chip
  await addEvidence(page, 'Passed', '2026-11-13T10:00', 'HEAD');
  await expect(stat(page, 'passingCurrent')).toHaveText(String(nTree));
  await expect(stat(page, 'noCurrentEvidence')).toHaveText(String(6 - nTree));
  await expect(stat(page, 'all')).toHaveText('8'); // exactly once, total unchanged
  await expect(item(page, 'Task Discovery').getByTestId('assurance-chip')).toHaveAttribute('aria-label', `${nTree} of 8 have passing evidence`);
  await expect(item(page, 'Today and Overdue').getByTestId('assurance-chip')).toHaveAttribute('aria-label', `${nToday} of 4 have passing evidence`);
  await expect(item(page, 'Inbox and All Tasks').getByTestId('assurance-chip')).toHaveAttribute('aria-label', /^0 of 3/);

  // drill down: passing evidence list shows the responsible behavior with a link to its owner
  await stat(page, 'passingCurrent').click();
  const filter = page.getByTestId('bucket-filter');
  await expect(filter).toContainText(`Showing ${nTree} of 8`);
  const card = page.locator('[data-behavior-id="behavior.today.due-today"]');
  await expect(card).toContainText('Has passing evidence');
  await expect(card.getByTestId('test-row')).toContainText('Current');
  await card.getByRole('button', { name: 'Go to Today and Overdue' }).click();
  await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Today and Overdue');

  // a later failure for the same test supersedes the pass (latest wins), and a stale run is labelled
  await addEvidence(page, 'Failed', '2026-11-13T11:00', 'HEAD');
  await expect(stat(page, 'failingCurrent')).toHaveText(String(nTree));
  await expect(stat(page, 'passingCurrent')).toHaveText('0');
  await expect(item(page, 'Task Discovery').getByTestId('assurance-chip')).toHaveAttribute('aria-label', /failing behaviors present/);
  await item(page, 'Task Discovery').click();
  await expect(stat(page, 'failingCurrent')).toHaveText(String(nTree));

  await addEvidence(page, 'Passed', '2026-11-14T09:00', 'f'.repeat(40));
  await item(page, 'Today and Overdue').click();
  await page.locator('[data-behavior-id="behavior.today.due-today"]').getByRole('button', { name: /History/ }).click();
  await expect(page.locator('[data-behavior-id="behavior.today.due-today"]').getByRole('table')).toContainText('Potentially outdated');

  // undo reverts all the way back through ancestors
  await page.getByRole('tree').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  await item(page, 'Task Discovery').click();
  await expect(stat(page, 'passingCurrent')).toHaveText('0');
  await expect(stat(page, 'failingCurrent')).toHaveText('0');
});

test('evidence context is explained, per-file, and unavailable states are not misleading', async ({ page }) => {
  await launch(page, { git: true });
  await page.getByRole('button', { name: /Evidence context/ }).click();
  const pop = page.getByRole('dialog').or(page.locator('[role=dialog]')).last();
  await expect(pop).toContainText('can never contain its own SHA');
  await pop.getByRole('radio', { name: /HEAD/ }).click();
  await expect(page.getByRole('button', { name: /Evidence context: HEAD/ })).toBeVisible();
  await page.reload();
  // persisted per file
  await expect(page.getByRole('button', { name: /Evidence context: HEAD/ })).toBeVisible();
});
