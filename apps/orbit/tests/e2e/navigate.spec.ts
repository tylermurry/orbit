import { expect, test } from '@playwright/test';
import { FILE, launch } from './helpers';

const item = (page: import('@playwright/test').Page, name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) });

test.describe('AC-02 open and navigate', () => {
  test('capability tree in Product, system tree in Engineering, with details, behaviors, tests and relationships', async ({ page }) => {
    await launch(page, { path: FILE });
    const caps = page.getByRole('tree', { name: 'Capabilities' });
    await expect(caps.getByRole('treeitem')).toHaveCount(9); // 3 roots + 6 children are all visible (roots expanded by default)
    await expect(item(page, 'Task Management')).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /Local Data/ })).toHaveCount(0); // systems are not in the Product tree

    await item(page, 'Today and Overdue').click();
    const detail = page.getByTestId('entity-detail');
    await expect(detail.getByLabel('Entity name')).toHaveValue('Today and Overdue');
    await expect(detail.getByText('cap.task-discovery.today-overdue').first()).toBeVisible();
    await expect(detail.getByLabel('Parent: Task Discovery')).toBeVisible();
    await expect(detail.getByTestId('behavior-card')).toHaveCount(4);
    const card = detail.locator('[data-behavior-id="behavior.today.due-today"]');
    await expect(card).toContainText('Today lists tasks due today or earlier');
    await expect(card.getByTestId('test-row')).toHaveCount(1);
    await expect(card.getByTestId('test-row')).toContainText('Freshness unknown'); // no code revision selected
    await expect(detail.locator('[data-behavior-id="behavior.today.timezone-change"]')).toContainText('No tests');

    // focused relationships: textual alternative
    await expect(page.getByTestId('rel-out').getByTestId('rel-row')).toHaveCount(3);
    await expect(page.getByTestId('rel-out')).toContainText('Today and Overdue');
    await expect(page.getByTestId('rel-out')).toContainText('depends on');
    await expect(page.getByTestId('rel-out')).toContainText('Create and Edit Tasks');

    // Engineering view
    await page.getByRole('radio', { name: 'Engineering' }).click();
    const sys = page.getByRole('tree', { name: 'Systems' });
    await expect(sys.getByRole('treeitem')).toHaveCount(6);
    await item(page, 'Task Repository').click();
    await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Task Repository');
    await expect(page.getByTestId('rel-in').getByTestId('rel-row').first()).toBeVisible();
  });

  test('AC-08 focused graph: labeled typed edges, navigation by click, textual list, kind badges', async ({ page }) => {
    await launch(page, { path: FILE });
    await item(page, 'Today and Overdue').click();
    const graph = page.getByTestId('graph');
    await expect(graph.getByTestId('graph-node')).toHaveCount(4); // selected + 3 distinct targets
    await expect(graph.getByTestId('graph-edge')).toHaveCount(3);
    const labels = await graph.getByTestId('graph-edge-label').allTextContents();
    expect(labels.sort()).toEqual(['depends on', 'is implemented by', 'uses']);
    await expect(graph.locator('[data-rel-type="uses"]')).toHaveCount(1);
    await expect(page.getByLabel('Graph legend')).toContainText('dashed');

    // clicking a connected node of the other kind switches to Engineering and selects it
    await graph.getByRole('button', { name: /Task Filtering and Sorting, system/ }).click();
    await expect(page.getByRole('tree', { name: 'Systems' })).toBeVisible();
    await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Task Filtering and Sorting');
    // here: Task Filtering and Sorting has incoming from two capabilities and outgoing to one system
    const g2 = page.getByTestId('graph');
    await expect(g2.getByTestId('graph-node')).toHaveCount(4);
    await expect(g2.locator('[data-col="left"]')).toHaveCount(2);
    await expect(g2.locator('[data-col="right"]')).toHaveCount(1);
    // keyboard activation of a node
    await g2.getByRole('button', { name: /Local Date Evaluation, system/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Local Date Evaluation');
  });

  test('AC-08 cycles and parallel edges do not crash the graph; entity appears once', async ({ page }) => {
    await launch(page, { path: FILE });
    // Add relationships so that "Today and Overdue" <-> "Create and Edit Tasks" forms a 2-cycle with 2 parallel edges
    await item(page, 'Create and Edit Tasks').click();
    await page.getByRole('button', { name: 'Add relationship' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add relationship' });
    await dlg.getByRole('radio', { name: 'This entity is the source' }).click();
    await dlg.getByRole('combobox', { name: 'Relationship type' }).click();
    await page.getByRole('option', { name: /^dependsOn/ }).click();
    await dlg.getByRole('button', { name: /^Target entity/ }).click();
    await page.getByRole('option', { name: /Today and Overdue/ }).click();
    await expect(dlg.getByTestId('rel-preview')).toContainText('Create and Edit Tasks depends on Today and Overdue');
    await dlg.getByRole('button', { name: 'Add relationship' }).click();

    const graph = page.getByTestId('graph');
    // Today and Overdue is both a source (depends on this) and a target: one node, two edges
    await expect(graph.locator('[data-entity-id="cap.task-discovery.today-overdue"]')).toHaveCount(1);
    await expect(graph.locator('[data-entity-id="cap.task-discovery.today-overdue"]')).toHaveAttribute('data-col', 'left');
    await expect(graph.getByTestId('graph-edge')).toHaveCount(3); // implementedBy Task Repository + the 2-cycle pair
    await expect(page.getByTestId('rel-in').getByTestId('rel-row')).toHaveCount(1);
    await expect(page.getByTestId('rel-out').getByTestId('rel-row')).toHaveCount(2);

    // Add a parallel edge of a different type between the same pair
    await page.getByRole('button', { name: 'Add relationship' }).click();
    await dlg.getByRole('combobox', { name: 'Relationship type' }).click();
    await page.getByRole('option', { name: /^uses/ }).click();
    await dlg.getByRole('button', { name: /^Target entity/ }).click();
    await page.getByRole('option', { name: /Today and Overdue/ }).click();
    await dlg.getByRole('button', { name: 'Add relationship' }).click();
    await expect(graph.getByTestId('graph-edge')).toHaveCount(4);
    await expect(graph.locator('[data-entity-id="cap.task-discovery.today-overdue"]')).toHaveCount(1);
  });

  test('self edges are impossible and duplicates warn in the relationship dialog', async ({ page }) => {
    await launch(page, { path: FILE });
    await item(page, 'Today and Overdue').click();
    await page.getByRole('button', { name: 'Add relationship' }).click();
    const dlg = page.getByRole('dialog', { name: 'Add relationship' });
    await dlg.getByRole('button', { name: /^Target entity/ }).click();
    const options = page.getByRole('option');
    await expect(options.filter({ hasText: /^Today and Overdue/ })).toHaveCount(0); // self is excluded
    await page.getByRole('option', { name: /Create and Edit Tasks/ }).click(); // existing dependsOn edge
    await expect(dlg.getByText('An identical relationship already exists')).toBeVisible();
    await expect(dlg.getByText('Impact flows backwards')).toBeVisible();
  });

  test('search: matches entities and behaviors, distinct empty states', async ({ page }) => {
    await launch(page, { path: FILE });
    const search = page.getByRole('searchbox', { name: /Search capabilities/ }).or(page.getByLabel(/Search capabilities/));
    await page.keyboard.press('Control+f');
    await expect(search).toBeFocused();
    await search.fill('overdue');
    await expect(page.getByRole('treeitem', { name: /^Today and Overdue/ })).toBeVisible();
    await expect(page.getByRole('treeitem', { name: /^Task Discovery/ })).toBeVisible(); // ancestor auto-expanded
    await expect(page.getByRole('treeitem', { name: /Task Management/ })).toHaveCount(0);
    const behaviorRow = page.getByRole('treeitem', { name: /^Behavior: Overdue/ }).first();
    await expect(behaviorRow).toBeVisible();
    await behaviorRow.click();
    await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Today and Overdue');
    await expect(page.locator('[data-behavior-id="behavior.today.overdue-labeled"]')).toBeVisible();

    await search.fill('zzzqqq');
    await expect(page.getByTestId('no-matches')).toContainText('No matches for “zzzqqq”');
    await expect(page.getByText('No capabilities yet')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear search' }).first().click();
    await expect(page.getByRole('treeitem', { name: /Task Management/ })).toBeVisible();
  });

  test('expand/collapse state persists per file across reloads', async ({ page }) => {
    await launch(page, { path: FILE });
    await item(page, 'Task Management').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(item(page, 'Task Management')).toHaveAttribute('aria-expanded', 'false');
    await expect(item(page, 'Create and Edit Tasks')).toHaveCount(0);
    await page.reload();
    await expect(item(page, 'Task Management')).toHaveAttribute('aria-expanded', 'false');
    await expect(item(page, 'Create and Edit Tasks')).toHaveCount(0);
    await expect(item(page, 'Task Discovery')).toHaveAttribute('aria-expanded', 'true');
  });
});
