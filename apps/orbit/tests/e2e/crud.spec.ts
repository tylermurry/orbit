import { expect, test } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import { FILE, fileText, launch } from './helpers';

/** Drag one tree row onto the middle of another (nests it inside). */
async function dragInside(page: import('@playwright/test').Page, from: string, to: string) {
  const a = (await item(page, from).boundingBox())!;
  const b = (await item(page, to).boundingBox())!;
  await page.mouse.move(a.x + 60, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + a.height / 2 + 10, { steps: 3 });
  await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

const item = (page: import('@playwright/test').Page, name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) });
const saved = async (page: import('@playwright/test').Page): Promise<OrbitContract> => {
  const p = parseContract((await fileText(page, FILE))!);
  expect(p.ok, JSON.stringify(p.diagnostics)).toBe(true);
  return p.contract!;
};

test('AC-03 complete manual editing through the UI, saved and re-opened', async ({ page }) => {
  test.setTimeout(60_000);
  await launch(page, { path: FILE });

  // ── entities: create top-level and child, rename, reparent ──
  await page.getByRole('button', { name: 'Add capability' }).click();
  let dlg = page.getByRole('dialog', { name: 'Add capability' });
  await dlg.getByLabel('Name').fill('Reminders');
  await expect(dlg.getByLabel('Id')).toHaveValue('cap.reminders');
  await dlg.getByLabel('Description').fill('Nudge people about tasks');
  await dlg.getByRole('radio', { name: 'Top level' }).click();
  await dlg.getByRole('button', { name: 'Add capability' }).click();
  await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Reminders');

  await page.getByRole('button', { name: 'Add capability' }).click();
  dlg = page.getByRole('dialog', { name: 'Add capability' });
  await dlg.getByLabel('Name').fill('Snooze');
  await dlg.getByLabel('Description').fill('Postpone a reminder');
  await expect(dlg.getByRole('radio', { name: /Inside “Reminders”/ })).toBeChecked();
  await dlg.getByRole('button', { name: 'Add capability' }).click();
  await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Snooze');

  const name = page.getByTestId('entity-detail').getByLabel('Entity name');
  await name.fill('Snooze Reminder');
  await name.press('Enter');
  await page.getByTestId('entity-detail').getByLabel('Description', { exact: true }).fill('Delay a reminder by a chosen time.');
  await page.getByTestId('entity-detail').getByLabel('Entity name').click(); // blur description

  // reparent Snooze under Task Management by dragging it onto that row
  await dragInside(page, 'Snooze Reminder', 'Task Management');
  await expect(page.getByTestId('entity-detail').getByRole('navigation', { name: 'Ancestors' })).toContainText('Task Management');
  await expect(page.getByLabel('Entity name', { exact: true })).toHaveValue('Snooze Reminder');

  // ── behaviors + test mapping (create a test inline) ──
  await item(page, 'Reminders').click();
  await page.getByRole('button', { name: 'Add behavior' }).click();
  await page.keyboard.type('User can be reminded at the due time'); // a new behavior arrives focused with its text selected
  await page.keyboard.press('Enter');
  const card = page.locator('[data-behavior-id="behavior.reminders.new-behavior"]');
  await expect(card).toContainText('User can be reminded at the due time');
  await expect(card).not.toContainText('behavior.reminders'); // ids are never shown

  // map a new test, then an existing one, through the ... menu
  await card.getByRole('button', { name: 'Add test mapping' }).click();
  dlg = page.getByRole('dialog', { name: 'Add test mapping' });
  await dlg.getByLabel('New test title').fill('User can see a reminder fire on time');
  await dlg.getByLabel('New test location').fill('apps/tasky/tests/reminders.spec.ts#fires');
  await dlg.getByRole('button', { name: 'Create and map' }).click();
  await card.getByRole('button', { name: 'Add test mapping' }).click();
  dlg = page.getByRole('dialog', { name: 'Add test mapping' });
  await dlg.getByLabel('Map test Create task integration test').or(dlg.getByLabel(/Map test End-to-end: first run/)).first().check();
  await dlg.getByRole('button', { name: 'Map tests' }).click();
  await expect(card.getByTestId('test-row')).toHaveCount(2);
  await expect(card.getByTestId('test-row').first()).toContainText('User can see a reminder fire on time');

  // edit the behavior text in place with the pencil, like a bullet list (Escape discards)
  await card.getByRole('button', { name: /^Edit User can be reminded/ }).click();
  const text = card.getByLabel('Behavior', { exact: true });
  await text.fill('Discarded');
  await text.press('Escape');
  await expect(card).toContainText('User can be reminded at the due time');
  await card.getByRole('button', { name: /^Edit User can be reminded/ }).click();
  await text.fill('User is reminded exactly when the due time arrives');
  await text.press('Enter');
  await expect(card).toContainText('User is reminded exactly when the due time arrives');

  // open a test's file in the default editor (WebStorm); the in-memory host records the request
  await card.getByTestId('test-row').first().getByRole('button', { name: /in editor/ }).click();
  expect(await page.evaluate(() => window.__orbitMemoryHost!.openedInEditor)).toEqual(['/work/tasky/apps/tasky/tests/reminders.spec.ts']);

  // collapse and expand with the chevron
  await card.getByRole('button', { name: /^Collapse/ }).click();
  await expect(card.getByTestId('test-row')).toHaveCount(0);
  await card.getByRole('button', { name: /^Expand/ }).click();
  await expect(card.getByTestId('test-row')).toHaveCount(2);

  // ── relationship: add + edit + delete ──
  await page.getByRole('button', { name: 'Add relationship' }).click();
  dlg = page.getByRole('dialog', { name: 'Add relationship' });
  await dlg.getByRole('button', { name: /^Target entity/ }).click();
  await page.getByRole('option', { name: /Task Filtering and Sorting/ }).click(); // across kinds
  await dlg.getByLabel('Relationship description').fill('Reminders reuse sorting');
  await dlg.getByRole('combobox', { name: 'Relationship type' }).click();
  await page.getByRole('option', { name: /^uses/ }).click();
  await dlg.getByRole('button', { name: 'Add relationship' }).click();
  const relRow = page.getByTestId('rel-out').getByTestId('rel-row');
  await expect(relRow).toHaveCount(1);
  await expect(relRow).toContainText('Reminders');
  await expect(relRow).toContainText('uses');
  await relRow.getByRole('button', { name: /Edit relationship/ }).click();
  dlg = page.getByRole('dialog', { name: 'Edit relationship' });
  await dlg.getByRole('combobox', { name: 'Relationship type' }).click();
  await page.getByRole('option', { name: /^dependsOn/ }).click();
  await dlg.getByRole('button', { name: 'Save relationship' }).click();
  await expect(relRow).toContainText('depends on');
  await page.getByTestId('rel-out').getByRole('button', { name: /Delete relationship/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete relationship' }).click();
  await expect(page.getByTestId('rel-out').getByTestId('rel-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Add relationship' }).click();
  dlg = page.getByRole('dialog', { name: 'Add relationship' });
  await dlg.getByRole('radio', { name: 'This entity is the target' }).click();
  await dlg.getByRole('button', { name: /^Source entity/ }).click();
  await page.getByRole('option', { name: /^Task Organization/ }).click();
  await dlg.getByRole('button', { name: 'Add relationship' }).click();
  await expect(page.getByTestId('rel-in').getByTestId('rel-row')).toHaveCount(1);

  // ── tests & evidence library ──
  await page.getByRole('button', { name: 'Tests & evidence' }).click();
  const lib = page.getByRole('dialog', { name: 'Tests & evidence' });
  await expect(lib).toContainText('never runs tests');
  await lib.getByRole('button', { name: 'Add test' }).click();
  dlg = page.getByRole('dialog', { name: 'Add test' });
  await dlg.getByLabel('Test name').fill('Manual smoke test');
  await dlg.getByLabel('Test location').fill('https://example.com/manual');
  await dlg.getByRole('button', { name: 'Add test' }).click();
  await expect(lib.getByTestId('test-row-lib').filter({ hasText: 'Manual smoke test' })).toBeVisible();
  await lib.getByRole('button', { name: 'Edit test Manual smoke test' }).click();
  dlg = page.getByRole('dialog', { name: 'Edit test' });
  await dlg.getByLabel('Test name').fill('Manual smoke test v2');
  await dlg.getByRole('button', { name: 'Save test' }).click();
  await expect(lib.getByTestId('test-row-lib').filter({ hasText: 'Manual smoke test v2' })).toBeVisible();

  await lib.getByRole('tab', { name: /Evidence/ }).click();
  await lib.getByRole('button', { name: 'Add evidence' }).click();
  dlg = page.getByRole('dialog', { name: 'Add evidence record' });
  await dlg.getByRole('combobox', { name: 'Evidence test' }).click();
  await page.getByRole('option', { name: 'Manual smoke test v2' }).click();
  await dlg.getByRole('combobox', { name: 'Evidence status' }).click();
  await page.getByRole('option', { name: 'Failed' }).click();
  await dlg.getByLabel('Executed at').fill('2026-11-13T10:30');
  await dlg.getByLabel('Evidence commit').fill('1234');
  await expect(dlg.getByText('full 40-character hex SHA')).toBeVisible();
  await expect(dlg.getByRole('button', { name: 'Add record' })).toBeDisabled();
  await expect(dlg.getByRole('button', { name: 'Use HEAD' })).toBeDisabled(); // no git
  await dlg.getByLabel('Evidence commit').fill('0123456789abcdef0123456789abcdef01234567');
  await dlg.getByLabel('Evidence details').fill('ran by hand');
  await dlg.getByRole('button', { name: 'Add record' }).click();
  const evRow = lib.getByTestId('evidence-row').filter({ hasText: 'Manual smoke test v2' });
  await expect(evRow).toContainText('Failed');
  await expect(evRow).toContainText('0123456');
  await evRow.getByRole('button', { name: /Edit evidence/ }).click();
  dlg = page.getByRole('dialog', { name: 'Edit evidence record' });
  await dlg.getByRole('combobox', { name: 'Evidence status' }).click();
  await page.getByRole('option', { name: 'Passed' }).click();
  await dlg.getByRole('button', { name: 'Save record' }).click();
  await expect(evRow).toContainText('Passed');
  // delete a test that has behaviors + evidence: implications are listed
  await lib.getByRole('tab', { name: /Tests/ }).click();
  await lib.getByRole('button', { name: /Delete test Manual smoke test v2/ }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Delete its 1 evidence record');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete test' }).click();
  await expect(lib.getByTestId('test-row-lib').filter({ hasText: 'Manual smoke test' })).toHaveCount(0);
  // evidence deletion on another test
  await lib.getByRole('tab', { name: /Evidence/ }).click();
  const before = await lib.getByTestId('evidence-row').count();
  await lib.getByTestId('evidence-row').first().getByRole('button', { name: /Delete evidence/ }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete record' }).click();
  await expect(lib.getByTestId('evidence-row')).toHaveCount(before - 1);
  await lib.getByRole('button', { name: 'Close tests and evidence' }).click();

  // ── delete entity: implications listed, children reparent to the grandparent ──
  await item(page, 'Snooze Reminder').click();
  await page.getByRole('button', { name: 'Delete Snooze Reminder' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('Delete 0 behaviors');
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click();
  await expect(item(page, 'Snooze Reminder')).toHaveCount(0);

  // ── save, assert persisted JSON, re-open ──
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
  const c = await saved(page);
  expect(c.entities.find((e) => e.id === 'cap.reminders')).toMatchObject({ kind: 'capability', parentId: null, name: 'Reminders' });
  expect(c.entities.find((e) => e.id === 'cap.snooze')).toBeUndefined();
  const rem = c.entities.find((e) => e.id === 'cap.reminders')!;
  expect(rem.behaviors).toHaveLength(1);
  expect(rem.behaviors[0]).toMatchObject({ id: 'behavior.reminders.new-behavior', name: 'User is reminded exactly when the due time arrives', expected: 'User is reminded exactly when the due time arrives' });
  expect(rem.behaviors[0].testIds).toHaveLength(2);
  const newTestId = rem.behaviors[0].testIds.find((t) => c.tests.find((x) => x.id === t)?.name === 'User can see a reminder fire on time');
  expect(newTestId).toBeTruthy();
  expect(c.tests.find((t) => t.name.startsWith('Manual smoke'))).toBeUndefined();
  expect(c.relationships.find((r) => r.sourceId === 'cap.task-organization' && r.targetId === 'cap.reminders')).toBeTruthy();
  expect(c.relationships.find((r) => r.description === 'Reminders reuse sorting')).toBeUndefined();

  await page.evaluate((p) => window.__orbitMemoryHost!.queueOpenPick(p), FILE);
  await page.getByRole('button', { name: 'Open contract' }).click();
  await expect(item(page, 'Reminders')).toBeVisible();
  await item(page, 'Reminders').click();
  await expect(page.locator('[data-behavior-id="behavior.reminders.new-behavior"]')).toContainText('User can see a reminder fire on time');
});

test('reparent by drag moves the subtree; cycles are prevented', async ({ page }) => {
  await launch(page, { path: FILE });
  await item(page, 'Task Management').click();
  await dragInside(page, 'Task Management', 'Task Organization');
  await dragInside(page, 'Task Organization', 'Task Management'); // nesting a parent inside its own descendant is ignored
  await expect(item(page, 'Task Management')).toHaveAttribute('aria-level', '2');
  await page.keyboard.press('Control+s');
  await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
  const c = parseContract((await fileText(page, FILE))!).contract!;
  expect(c.entities.find((e) => e.id === 'cap.task-management')!.parentId).toBe('cap.task-organization');
  expect(c.entities.find((e) => e.id === 'cap.task-management')!.id).toBe('cap.task-management'); // id never changes
});

test('delete a parent entity reparents children and removes its relationships', async ({ page }) => {
  await launch(page, { path: FILE });
  await item(page, 'Task Organization').click();
  await page.getByRole('button', { name: 'Delete Task Organization' }).click();
  const ad = page.getByRole('alertdialog');
  await expect(ad).toContainText('Move its 2 children up to the top level');
  await ad.getByRole('button', { name: 'Delete' }).click();
  await expect(item(page, 'Custom Lists')).toBeVisible();
  await page.keyboard.press('Control+s');
  const c = parseContract((await fileText(page, FILE))!).contract!;
  expect(c.entities.find((e) => e.id === 'cap.task-organization')).toBeUndefined();
  expect(c.entities.find((e) => e.id === 'cap.task-organization.custom-lists')!.parentId).toBeNull();
});
