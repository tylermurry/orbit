import { expect, test } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import { FILE, fileText, launch } from './helpers';

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
  await dlg.getByLabel('Summary').fill('Nudge people about tasks');
  await dlg.getByRole('radio', { name: 'Top level' }).click();
  await dlg.getByRole('button', { name: 'Add capability' }).click();
  await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue('Reminders');

  await page.getByRole('button', { name: 'Add capability' }).click();
  dlg = page.getByRole('dialog', { name: 'Add capability' });
  await dlg.getByLabel('Name').fill('Snooze');
  await dlg.getByLabel('Summary').fill('Postpone a reminder');
  await expect(dlg.getByRole('radio', { name: /Inside “Reminders”/ })).toBeChecked();
  await dlg.getByRole('button', { name: 'Add capability' }).click();
  await expect(page.getByTestId('entity-detail').getByLabel('Parent: Reminders')).toBeVisible();

  const name = page.getByTestId('entity-detail').getByLabel('Entity name');
  await name.fill('Snooze Reminder');
  await name.press('Enter');
  await page.getByTestId('entity-detail').getByLabel('Description', { exact: true }).fill('Delay a reminder by a chosen time.');
  await page.getByTestId('entity-detail').getByLabel('Summary', { exact: true }).click(); // blur description

  // reparent Snooze under Task Management (same-kind picker, no cycles, no systems)
  await page.getByLabel('Parent: Reminders').click();
  const list = page.getByRole('listbox', { name: 'Parent' });
  await expect(list.getByRole('option', { name: /Snooze Reminder/ })).toHaveCount(0); // not itself
  await expect(list.getByRole('option', { name: /Task Repository/ })).toHaveCount(0); // never a system
  await list.getByRole('option', { name: /^Task Management/ }).click();
  await expect(page.getByLabel('Parent: Task Management')).toBeVisible();
  await expect(page.getByLabel('Entity name', { exact: true })).toHaveValue('Snooze Reminder');

  // ── behaviors + test mapping (create a test inline) ──
  await item(page, 'Reminders').click();
  await page.getByRole('button', { name: 'Add behavior' }).click();
  dlg = page.getByRole('dialog', { name: 'Add behavior' });
  await dlg.getByLabel('Behavior name').fill('Remind at due time');
  await expect(dlg.getByLabel('Behavior id')).toHaveValue('behavior.reminders.remind-at-due-time');
  await dlg.getByLabel('Expected outcome').fill('A reminder fires when its due time arrives.');
  await dlg.getByRole('button', { name: 'Create test…' }).click();
  await dlg.getByLabel('New test name').fill('Reminder fires on time');
  await dlg.getByLabel('New test location').fill('apps/tasky/tests/reminders.spec.ts#fires');
  await dlg.getByRole('button', { name: 'Add test' }).click();
  await dlg.getByLabel('Map test Create task integration test').or(dlg.getByLabel(/Map test End-to-end: first run/)).first().check();
  await dlg.getByRole('button', { name: 'Add behavior' }).click();
  const card = page.locator('[data-behavior-id="behavior.reminders.remind-at-due-time"]');
  await expect(card).toContainText('Remind at due time');
  await expect(card.getByTestId('test-row')).toHaveCount(2);
  await expect(card.getByTestId('test-row').first()).toContainText('Reminder fires on time');

  // edit the behavior; id is read-only
  await card.getByRole('button', { name: /Edit behavior/ }).click();
  dlg = page.getByRole('dialog', { name: 'Edit behavior' });
  await expect(dlg.getByLabel('Behavior id')).toHaveAttribute('readonly', '');
  await dlg.getByLabel('Expected outcome').fill('A reminder fires exactly when its due time arrives.');
  await dlg.getByRole('button', { name: 'Save behavior' }).click();
  await expect(card).toContainText('exactly when its due time');

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
  expect(rem.behaviors[0]).toMatchObject({ id: 'behavior.reminders.remind-at-due-time', expected: 'A reminder fires exactly when its due time arrives.' });
  expect(rem.behaviors[0].testIds).toHaveLength(2);
  const newTestId = rem.behaviors[0].testIds.find((t) => c.tests.find((x) => x.id === t)?.name === 'Reminder fires on time');
  expect(newTestId).toBeTruthy();
  expect(c.tests.find((t) => t.name.startsWith('Manual smoke'))).toBeUndefined();
  expect(c.relationships.find((r) => r.sourceId === 'cap.task-organization' && r.targetId === 'cap.reminders')).toBeTruthy();
  expect(c.relationships.find((r) => r.description === 'Reminders reuse sorting')).toBeUndefined();

  await page.evaluate((p) => window.__orbitMemoryHost!.queueOpenPick(p), FILE);
  await page.getByRole('button', { name: 'Open contract' }).click();
  await expect(item(page, 'Reminders')).toBeVisible();
  await item(page, 'Reminders').click();
  await expect(page.locator('[data-behavior-id="behavior.reminders.remind-at-due-time"]')).toContainText('Reminder fires on time');
});

test('reparent moves the subtree; cycles are prevented by the picker', async ({ page }) => {
  await launch(page, { path: FILE });
  await item(page, 'Task Management').click();
  await page.getByLabel('Parent: No parent (top level)').click();
  const list = page.getByRole('listbox', { name: 'Parent' });
  await expect(list.getByRole('option', { name: /Create and Edit Tasks/ })).toHaveCount(0); // descendant -> would create a cycle
  await expect(list.getByRole('option', { name: /Complete and Delete Tasks/ })).toHaveCount(0);
  await list.getByRole('option', { name: /^Task Organization/ }).click();
  await expect(page.getByLabel('Parent: Task Organization')).toBeVisible();
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
