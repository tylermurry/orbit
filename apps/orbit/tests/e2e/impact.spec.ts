import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseContract, serializeContract } from '@orbit/contract';
import { DEMO, REL, SHA, TASKY, gitSeed, launch } from './helpers';

const item = (page: Page, name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const row = (page: Page, key: string) => page.locator(`[data-change-key="${key}"]`);

test.describe('AC-09 semantic diff', () => {
  test('HEAD → Working tree: totals, field-level before/after, owner moves, and the direct vs potential split', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.implementation });
    await page.keyboard.press('Control+3');
    const view = page.getByTestId('impact-view');
    await expect(view).toContainText('HEAD → Working tree');
    await expect(page.getByTestId('change-row')).toHaveCount(17);
    await expect(page.getByTestId('direct-count')).toContainText('3');
    await expect(page.getByTestId('potential-count')).toContainText('3');
    await expect(page.getByTestId('potential-count')).toContainText('Inferred from relationships');
    await expect(view.getByRole('button', { name: /Behaviors: 1 added, 4 modified, 0 removed/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /Evidence: 8 added/ })).toBeVisible();
    await expect(view.getByRole('button', { name: /Capabilities: 0 added, 0 modified, 1 removed/ })).toBeVisible();

    // filter chips
    await view.getByRole('button', { name: 'Product guarantees' }).click();
    await expect(page.getByTestId('change-row')).toHaveCount(8);
    await view.getByRole('button', { name: 'Verification metadata' }).click();
    await expect(page.getByTestId('change-row')).toHaveCount(9);
    await view.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Filter changes').fill('overdue');
    await expect(row(page, 'behavior:behavior.localdate.overdue-classification')).toBeVisible();
    await page.getByLabel('Filter changes').fill('');

    // field-level before/after with inline word diff
    await row(page, 'behavior:behavior.localdate.overdue-classification').click();
    const detail = page.getByTestId('change-detail');
    const f = detail.locator('[data-field="expected"]');
    await expect(f).toBeVisible();
    await expect(f.locator('del').first()).toBeVisible();
    await expect(f.locator('ins').first()).toBeVisible();
    await expect(detail).toContainText('Product guarantee');

    // ownership change is reported as a move, not add + remove
    await row(page, 'behavior:behavior.tasks.complete-toggle').click();
    await expect(page.getByTestId('moved-note')).toContainText('Moved from Complete and Delete Tasks to Create and Edit Tasks');

    // relationship change as before/after sentences
    await row(page, 'relationship:rel.create-edit.implemented-by.task-repository').click();
    await expect(page.getByTestId('rel-before')).toContainText('Create and Edit Tasks is implemented by Task Repository');
    await expect(page.getByTestId('rel-after')).toContainText('Create and Edit Tasks is implemented by Task Repository');
    await expect(page.getByTestId('change-detail').locator('[data-field="description"]')).toBeVisible();

    // verification metadata is labelled and never marks entities as changed
    await row(page, 'test:test.tasky.tasks.edit-notes').click();
    await expect(page.getByTestId('change-detail')).toContainText('Verification metadata');
    await expect(page.getByTestId('consumers')).toHaveCount(0);
  });

  test('reformat/reorder-only revisions yield no semantic changes', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.base });
    await page.keyboard.press('Control+3');
    await page.getByRole('combobox', { name: 'Target revision' }).click();
    await page.getByRole('option', { name: /^reformat/ }).click();
    await expect(page.getByTestId('no-changes')).toContainText('No semantic changes between HEAD and reformat');
    await expect(page.getByTestId('no-changes')).toContainText('Choose branches');
  });

  test('test mapping changes show added/removed test chips', async ({ page }) => {
    const base = parseContract(DEMO.base).contract!;
    const mod = structuredClone(base);
    const e = mod.entities.find((x) => x.behaviors.length > 0 && x.behaviors.some((b) => b.testIds.length > 0))!;
    const b = e.behaviors.find((x) => x.testIds.length > 0)!;
    const removed = b.testIds[0];
    const extra = mod.tests.find((t) => !b.testIds.includes(t.id))!;
    b.testIds = [...b.testIds.slice(1), extra.id];
    await launch(page, { git: true, text: serializeContract(mod) });
    await page.keyboard.press('Control+3');
    await page.locator(`[data-change-key="behavior:${b.id}"]`).click();
    const f = page.getByTestId('change-detail').locator('[data-field="testIds"]');
    await expect(f).toContainText(`+ ${extra.id}`);
    await expect(f).toContainText(`− ${removed}`);
    await expect(page.getByTestId('change-detail')).toContainText('Verification metadata'); // testIds-only change is verification
  });

  test('unsaved edits become the default target and the saved file is described honestly', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.base });
    await page.getByLabel('Entity name').fill('Renamed in Orbit');
    await page.getByLabel('Entity name').press('Enter');
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('impact-view')).toContainText('HEAD → Unsaved edits');
    await expect(page.getByTestId('change-row')).toHaveCount(1);
    await row(page, 'entity:cap.task-discovery').click();
    await expect(page.getByTestId('change-detail').locator('[data-field="name"]')).toContainText('Renamed in Orbit');
    await page.getByRole('combobox', { name: 'Target revision' }).click();
    await page.getByRole('option', { name: 'Working tree (saved file)' }).click();
    await expect(page.getByTestId('no-changes')).toBeVisible();
    await expect(page.getByTestId('impact-view')).toContainText('You have unsaved changes; “Working tree” compares the saved file');
  });
});

test.describe('AC-10 embedded change context + AC-11 impact', () => {
  test.beforeEach(async ({ page }) => {
    await launch(page, { git: true, text: DEMO.implementation });
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('change-row').first()).toBeVisible();
    await page.keyboard.press('Control+1');
  });

  test('Product tree highlights added/modified/removed(ghost)/potentially-affected; removed entities stay inspectable', async ({ page }) => {
    const tree = page.getByRole('tree', { name: 'Capabilities' });
    await expect(page.getByLabel('Legend').first()).toContainText('Potentially affected');
    await expect(item(page, 'Complete and Delete Tasks')).toHaveAttribute('data-status', 'removed');
    await expect(item(page, 'Complete and Delete Tasks')).toHaveClass(/ghost/);
    await expect(item(page, 'Complete and Delete Tasks')).toContainText('Removed');
    await expect(item(page, 'Create and Edit Tasks')).toHaveAttribute('data-status', 'modified');
    await expect(item(page, 'Create and Edit Tasks').getByRole('img', { name: 'Modified' })).toBeVisible();
    await expect(item(page, 'Inbox and All Tasks')).toHaveAttribute('data-status', 'affected');
    await expect(item(page, 'Today and Overdue')).toHaveAttribute('data-status', 'affected');
    await expect(item(page, 'Custom Lists')).toHaveAttribute('data-status', 'unchanged');
    // a parent is not "modified" by its children, but summarises them
    await expect(item(page, 'Task Management')).toHaveAttribute('data-status', 'unchanged');
    await expect(item(page, 'Task Management')).toContainText('2 changed inside');
    await expect(tree).toBeVisible();

    await item(page, 'Complete and Delete Tasks').click();
    await expect(page.getByTestId('ghost-note')).toContainText('removed in the comparison target');
    await expect(page.getByLabel('Entity name')).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await expect(page.getByTestId('entity-detail')).toContainText('Mark a task done'.slice(0, 4)); // base behaviors remain readable
    await item(page, 'Today and Overdue').click();
    await expect(page.getByTestId('state-note')).toContainText('Potentially affected');
    await expect(page.getByTestId('state-note')).toContainText('(changed)');
  });

  test('Engineering view shows the shared-system change and its consumers; clearing the comparison removes ghosts', async ({ page }) => {
    await page.keyboard.press('Control+2');
    await expect(item(page, 'Local Date Evaluation')).toHaveAttribute('data-status', 'modified');
    await expect(item(page, 'Task Filtering and Sorting')).toHaveAttribute('data-status', 'affected');
    await expect(item(page, 'Task Repository')).toHaveAttribute('data-status', 'unchanged');

    await page.keyboard.press('Control+1');
    await page.getByRole('button', { name: /Comparison HEAD/ }).click();
    await page.getByRole('button', { name: 'Clear comparison' }).click();
    await page.keyboard.press('Escape');
    await expect(item(page, 'Complete and Delete Tasks')).toHaveCount(0);
    await expect(item(page, 'Create and Edit Tasks')).not.toHaveAttribute('data-status', 'modified');
  });

  test('multi-hop potential impact with relationship paths; sources do not mark their dependencies', async ({ page }) => {
    await page.keyboard.press('Control+3');
    await page.getByTestId('tab-affected').click();
    const rows = page.getByTestId('affected-row');
    await expect(rows).toHaveCount(3);
    const inbox = page.locator('[data-testid="affected-row"][data-entity-id="cap.task-discovery.inbox-all"]');
    await expect(inbox.getByTestId('impact-chain')).toContainText('Inbox and All Tasks');
    await expect(inbox.getByTestId('impact-chain')).toContainText('Task Filtering and Sorting');
    await expect(inbox.getByTestId('impact-chain')).toContainText('Local Date Evaluation (changed)');
    // directly changed entities are not "potentially affected"
    await expect(page.locator('[data-testid="affected-row"][data-entity-id="sys.local-date"]')).toHaveCount(0);

    // consumers list on a change of the shared system
    await page.getByRole('tab', { name: /Changes/ }).click();
    await page.locator('[data-change-key="behavior:behavior.localdate.overdue-classification"]').click();
    const consumers = page.getByTestId('consumers');
    await expect(consumers.getByTestId('impact-chain')).toHaveCount(3);
    await expect(consumers).toContainText('not observed breakage');

    // jump into Engineering with the comparison still active
    await page.getByRole('button', { name: 'Show in Engineering' }).click();
    await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Local Date Evaluation');
    await expect(page.getByRole('contentinfo', { name: 'Status' })).toContainText('Comparing HEAD → Working tree');
    await expect(item(page, 'Task Filtering and Sorting')).toHaveAttribute('data-status', 'affected');
  });
});

test('AC-11 a changed source does not mark unrelated dependencies as affected', async ({ page }) => {
  await launch(page, { git: true, text: DEMO.proposal });
  await page.keyboard.press('Control+3');
  await expect(page.getByTestId('direct-count')).toContainText('1');
  await expect(page.getByTestId('potential-count')).toContainText('0');
  await page.getByTestId('tab-affected').click();
  await expect(page.getByText('No other entity depends on anything that changed.')).toBeVisible();
  await page.keyboard.press('Control+1');
  await expect(item(page, 'Today and Overdue')).toHaveAttribute('data-status', 'modified');
  await expect(item(page, 'Create and Edit Tasks')).toHaveAttribute('data-status', 'unchanged');
});

test.describe('revisions: errors and edge cases', () => {
  test('invalid JSON at a revision blocks comparison with its diagnostics (no text-diff fallback)', async ({ page }) => {
    const git = gitSeed();
    const bad = 'e5'.repeat(20);
    git.commits[bad] = { subject: 'broken', date: '2026-11-05T00:00:00Z', files: { [REL]: '{ "schemaVersion": 1,, }' } };
    git.refs.push({ name: 'broken', kind: 'branch', commit: bad });
    await launch(page, { git, text: DEMO.base });
    await page.keyboard.press('Control+3');
    await page.getByRole('combobox', { name: 'Target revision' }).click();
    await page.getByRole('option', { name: /^broken/ }).click();
    const blocked = page.getByTestId('compare-blocked');
    await expect(blocked).toContainText('contains an invalid contract');
    await expect(blocked).toContainText('will not fall back to a text diff');
    await expect(page.getByTestId('impact-view')).toContainText('Target: broken');
    await expect(page.getByTestId('impact-view')).toContainText(/line \d+/);
    await expect(page.getByTestId('change-row')).toHaveCount(0);
  });

  test('unknown ref gives an actionable error', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.base });
    await page.keyboard.press('Control+3');
    await page.getByRole('combobox', { name: 'Base revision' }).click();
    await page.getByRole('option', { name: 'Commit SHA…' }).click();
    await page.getByLabel('Base revision commit SHA').fill('deadbeef');
    await page.getByLabel('Base revision commit SHA').press('Enter');
    await expect(page.getByTestId('compare-error')).toContainText("Cannot resolve revision 'deadbeef'");
  });

  test('untracked file: explained as added, not an error', async ({ page }) => {
    const git = gitSeed();
    git.commits[SHA.base].files = {};
    await launch(page, { git, text: TASKY });
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('status-added')).toContainText('does not exist in HEAD');
    await expect(page.getByTestId('impact-view')).toContainText('Not committed yet — HEAD has no version of this path.');
    await expect(page.getByTestId('change-row').first()).toBeVisible();
  });

  test('detached HEAD is labelled', async ({ page }) => {
    await launch(page, { git: gitSeed({ head: 'detached' }), text: DEMO.base });
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('impact-view')).toContainText('HEAD is detached at a1a1a1a');
    await expect(page.getByRole('contentinfo', { name: 'Status' })).toContainText('detached HEAD a1a1a1a');
  });

  test('shallow clone note and compare popover from the top bar', async ({ page }) => {
    const git = gitSeed();
    git.shallow = true;
    await launch(page, { git, text: DEMO.implementation });
    await page.getByRole('button', { name: 'Compare revisions' }).click();
    const pop = page.getByRole('dialog');
    await expect(pop).toContainText('Compare revisions');
    await pop.getByRole('combobox', { name: 'Base revision' }).click();
    const opts = page.getByRole('listbox');
    await expect(opts).toContainText('Working tree');
    await expect(opts).toContainText('HEAD');
    await expect(opts).toContainText('Branches');
    await expect(opts).toContainText('Tags');
    await page.getByRole('option', { name: /^proposal/ }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('impact-view')).toContainText('shallow clone');
    await expect(page.getByTestId('impact-view')).toContainText('proposal → Working tree');
  });
});
