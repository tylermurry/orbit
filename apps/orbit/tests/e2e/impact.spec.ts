import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseContract, serializeContract } from '@orbit/contract';
import { DEMO, FILE, REL, REPO, SHA, TASKY, compareVia, fileText, gitSeed, launch } from './helpers';

const item = (page: Page, name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const row = (page: Page, key: string) => page.locator(`[data-change-key="${key}"]`);
const views = (page: Page) => page.getByRole('banner').getByRole('group', { name: 'Change views' });
const viewBtn = (page: Page, name: string) => views(page).getByRole('button', { name, exact: true });
const title = (page: Page) => page.getByTestId('impact-title');

test.describe('AC-09 semantic diff', () => {
  test('View actual (the default): totals, field-level before/after, owner moves, and the direct vs potential split', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.implementation });
    await page.keyboard.press('Control+3');
    const view = page.getByTestId('impact-view');
    await expect(title(page)).toHaveText('View actual');
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
    await compareVia(page, 'HEAD', 'reformat');
    await expect(title(page)).toHaveText('Custom comparison');
    await expect(page.getByTestId('no-changes')).toContainText('No product changes in this view');
    await expect(page.getByTestId('no-changes')).toContainText('Formatting and ordering differences are ignored');
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
    await expect(title(page)).toHaveText('View actual');
    await expect(viewBtn(page, 'View actual')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('change-row')).toHaveCount(1);
    await row(page, 'entity:cap.task-management').click();
    await expect(page.getByTestId('change-detail').locator('[data-field="name"]')).toContainText('Renamed in Orbit');
    // a renamed entity shows its title as a text diff in the detail view while comparing
    await page.keyboard.press('Control+1');
    const diffTitle = page.getByTestId('text-diff').first();
    await expect(diffTitle.locator('del').first()).toBeVisible();
    await expect(diffTitle).toContainText(/Renamed.*in Orbit/);
    await page.keyboard.press('Control+3');
    await compareVia(page, 'HEAD', 'working'); // the saved file has no changes
    await expect(page.getByTestId('no-changes')).toBeVisible();
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
    // compare mode defaults to showing changes only; unchanged items are checked after turning that off
    await expect(item(page, 'Custom Lists')).toHaveCount(0);
    await expect(page.getByTestId('show-changes')).toHaveAttribute('aria-pressed', 'true');
    await expect(item(page, 'Complete and Delete Tasks')).toHaveAttribute('data-status', 'removed');
    await expect(item(page, 'Complete and Delete Tasks')).toHaveClass(/ghost/);
    await expect(item(page, 'Complete and Delete Tasks')).toContainText('Removed');
    await expect(item(page, 'Create and Edit Tasks')).toHaveAttribute('data-status', 'modified');
    await expect(item(page, 'Create and Edit Tasks').getByRole('img', { name: 'Modified' })).toBeVisible();
    await expect(item(page, 'Inbox and All Tasks')).toHaveAttribute('data-status', 'affected');
    await expect(item(page, 'Today and Overdue')).toHaveAttribute('data-status', 'affected');
    await page.getByTestId('show-changes').click();
    await expect(item(page, 'Custom Lists')).toHaveAttribute('data-status', 'unchanged');
    // a parent is not "modified" by its children, but summarises them
    await expect(item(page, 'Task Management')).toHaveAttribute('data-status', 'unchanged');
    await expect(item(page, 'Task Management')).toContainText('2 changed inside');
    await expect(tree).toBeVisible();

    await item(page, 'Complete and Delete Tasks').click();
    await expect(page.getByTestId('ghost-note')).toContainText('removed in the comparison target');
    await expect(page.getByLabel('Entity name')).toBeDisabled();
    await expect(page.getByRole('button', { name: /^Delete / })).toHaveCount(0);
    await expect(page.getByTestId('entity-detail')).toContainText('Complete and reopen'); // base behaviors remain readable
    await item(page, 'Create and Edit Tasks').click();
    await expect(page.locator('[data-testid="behavior-card"][data-change="added"], [data-testid="behavior-card"][data-change="modified"], [data-testid="behavior-card"][data-change="removed"]').first()).toBeVisible();
    await item(page, 'Today and Overdue').click();
    const affected = page.locator('[data-testid="behavior-card"][data-change="affected"]').first();
    await expect(affected).toContainText('Potentially affected');
    await expect(affected.getByTestId('behavior-impact')).toContainText('(changed)');
  });

  test('Engineering view shows the shared-system change and its consumers; clearing the comparison removes ghosts', async ({ page }) => {
    await page.keyboard.press('Control+2');
    await expect(item(page, 'Local Date Evaluation')).toHaveAttribute('data-status', 'modified');
    await expect(item(page, 'Task Filtering and Sorting')).toHaveAttribute('data-status', 'affected');
    await expect(item(page, 'Task Repository')).toHaveCount(0);
    await page.getByTestId('show-changes').click();
    await expect(item(page, 'Task Repository')).toHaveAttribute('data-status', 'unchanged');

    await page.keyboard.press('Control+1');
    await viewBtn(page, 'View actual').click(); // clicking the active view turns it off
    await expect(viewBtn(page, 'View actual')).toHaveAttribute('aria-pressed', 'false');
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
    await expect(page.getByRole('contentinfo', { name: 'Status' })).toContainText('Showing View actual');
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
  await page.getByTestId('show-changes').click();
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
    await compareVia(page, 'HEAD', 'broken');
    const blocked = page.getByTestId('compare-blocked');
    await expect(blocked).toContainText('is not a valid contract');
    await expect(page.getByTestId('impact-view')).toContainText('Target: Another version');
    await expect(page.getByTestId('impact-view')).toContainText(/line \d+/);
    await expect(page.getByTestId('change-row')).toHaveCount(0);
  });

  test('unknown ref gives an actionable error', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.base });
    await page.keyboard.press('Control+3');
    await compareVia(page, 'deadbeef', 'working');
    await expect(page.getByTestId('compare-error')).toContainText("Cannot resolve revision 'deadbeef'");
  });

  test('untracked file: explained as added, not an error', async ({ page }) => {
    const git = gitSeed();
    git.commits[SHA.base].files = {};
    await launch(page, { git, text: TASKY });
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('status-added')).toContainText('does not exist in Baseline');
    await expect(page.getByTestId('change-row').first()).toBeVisible();
  });

  test('detached HEAD: View actual still works and nothing git-ish is shown', async ({ page }) => {
    await launch(page, { git: gitSeed({ head: 'detached' }), text: DEMO.base });
    await page.keyboard.press('Control+3');
    await expect(title(page)).toHaveText('View actual');
    await expect(page.getByTestId('impact-view')).not.toContainText('HEAD');
    await expect(page.getByRole('contentinfo', { name: 'Status' })).not.toContainText('HEAD');
  });
});

test('a view button toggles its comparison; its arrow shows the git details without changing anything', async ({ page }) => {
  await launch(page, { git: true, text: DEMO.implementation });
  const actual = viewBtn(page, 'View actual');
  await expect(actual).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'View actual details' }).click();
  const pop = page.getByTestId('details-actual');
  await expect(pop).toContainText('Baseline');
  await expect(pop).toContainText('merge-base');
  await expect(pop).toContainText('a1a1a1a');
  await expect(actual).toHaveAttribute('aria-pressed', 'false'); // opening details does not turn the view on
  await page.keyboard.press('Escape');
  await actual.click();
  await expect(actual).toHaveAttribute('aria-pressed', 'true');
  await actual.click();
  await expect(actual).toHaveAttribute('aria-pressed', 'false');
});

test('a renamed behavior shows its text as a diff while comparing', async ({ page }) => {
  await launch(page, { git: true, text: DEMO.base });
  await page.getByRole('treeitem', { name: /^Create and Edit Tasks/ }).click();
  const card = page.getByTestId('behavior-card').first();
  await card.getByRole('button', { name: /^Edit / }).click();
  const text = card.getByLabel('Behavior', { exact: true });
  await text.fill('User can rename this behavior');
  await text.press('Enter');
  await page.keyboard.press('Control+3'); // defaults to View actual (latest = unsaved edits)
  await page.keyboard.press('Control+1');
  const diffed = page.getByTestId('behavior-card').first().getByTestId('text-diff');
  await expect(diffed.locator('del').first()).toBeVisible();
  await expect(diffed).toContainText('rename this behavior');
});

test.describe('file-backed product-owner change views', () => {
  const proposalButton = (page: Page, name: string) => page.getByRole('radiogroup', { name: 'Impact' }).getByRole('radio', { name, exact: true });
  const call = (page: Page, name: string, args: Record<string, unknown>) => page.evaluate(([name, args]) => window.__orbitMcp!.callTool(name, args), [name, args] as const);
  const file = `${REPO}/orbit.proposal.json`;

  test('reviews draft revisions and compares the approved revision with saved Actual', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.base });
    await expect(proposalButton(page, 'Proposal')).toHaveAttribute('aria-disabled', 'true');
    expect((await call(page, 'create_proposal', { operations: [{ tool: 'create_test', args: { id: 'test.proposed', name: 'A planned test', location: 'tests/proposed.ts' } }] })).isError).toBeUndefined();
    await proposalButton(page, 'Proposal').click();
    await expect(title(page)).toHaveText('Proposal');
    await expect(row(page, 'test:test.proposed').getByRole('img', { name: 'Planned' })).toBeVisible();
    await expect(proposalButton(page, 'Actual vs. Proposal')).toHaveAttribute('aria-disabled', 'true');
    const review = (await call(page, 'view_changes', { view: 'proposal' })).structuredContent!;
    expect((await call(page, 'approve_proposal', { revision: 1, fileHash: review.proposalFileHash })).isError).toBeUndefined();
    expect((await call(page, 'revise_proposal', { revision: 1, operations: [{ tool: 'update_product', args: { name: 'Draft only' } }] })).isError).toBeUndefined();
    await proposalButton(page, 'Actual vs. Proposal').click();
    await expect(title(page)).toHaveText('Actual vs. Proposal');
    await expect(row(page, 'test:test.proposed').getByRole('img', { name: 'Pending' })).toBeVisible();
    await expect(page.getByTestId('change-row')).toHaveCount(1);
    expect(await fileText(page, FILE)).toBe(DEMO.base);
    expect(JSON.parse((await fileText(page, file))!).approved.revision).toBe(1);

    await page.evaluate((name) => window.__orbitMemoryHost!.externalDelete(name), file);
    await expect(proposalButton(page, 'Proposal')).toHaveAttribute('aria-disabled', 'true');
    await proposalButton(page, 'Actual').click();
    await expect(page.getByTestId('no-changes')).toBeVisible();
  });
});
