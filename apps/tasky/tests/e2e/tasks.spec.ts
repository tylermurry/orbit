import { expect, test } from '@playwright/test';
import { go, open, rowTitles } from './helpers';

const WORK = { id: 'list-work', name: 'Work' };

test.describe('task create, edit, complete, delete', () => {
  test('creates a task in the selected list [test.tasky.tasks.create]', async ({ page }) => {
    await open(page, { lists: [WORK] });
    await go(page, 'Work');
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog.getByLabel('List')).toHaveValue('list-work');
    await dialog.getByLabel('Title').fill('Write quarterly report');
    await dialog.getByLabel('Notes').fill('Include revenue');
    await dialog.getByLabel('Due date').fill('2026-06-20');
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden();
    await expect(rowTitles(page)).toHaveText(['Write quarterly report']);
    await go(page, 'Inbox');
    await expect(page.getByRole('heading', { name: 'Inbox is empty' })).toBeVisible();
  });

  test('defaults new tasks to Inbox outside a custom list [test.tasky.tasks.default-inbox]', async ({ page }) => {
    await open(page, { lists: [WORK] });
    await go(page, 'All Tasks');
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await expect(dialog.getByLabel('List')).toHaveValue('inbox');
    await dialog.getByLabel('Title').fill('Pay rent');
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await go(page, 'Inbox');
    await expect(rowTitles(page)).toHaveText(['Pay rent']);
    await go(page, 'Work');
    await expect(page.getByRole('heading', { name: 'No tasks in Work' })).toBeVisible();
  });

  test('rejects empty and whitespace-only titles with an inline message [test.tasky.tasks.create-validation]', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'New task' }).click();
    const dialog = page.getByRole('dialog', { name: 'New task' });
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a title for the task.');
    await expect(dialog.getByLabel('Title')).toHaveAttribute('aria-invalid', 'true');
    await dialog.getByLabel('Title').fill('    ');
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Title').fill('Real title');
    await dialog.getByRole('button', { name: 'Add task' }).click();
    await expect(dialog).toBeHidden();
    await expect(rowTitles(page)).toHaveText(['Real title']);
  });

  test('edits title, notes, due date and list [test.tasky.tasks.edit]', async ({ page }) => {
    await open(page, { lists: [WORK], tasks: [{ id: 't1', title: 'Draft memo' }] });
    await page.getByRole('button', { name: "Edit 'Draft memo'" }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit task' });
    await expect(dialog.getByLabel('Title')).toHaveValue('Draft memo');
    await dialog.getByLabel('Title').fill('Final memo');
    await dialog.getByLabel('Notes').fill('Send to the team');
    await dialog.getByLabel('Due date').fill('2026-06-30');
    await dialog.getByLabel('List').selectOption({ label: 'Work' });
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(dialog).toBeHidden();
    await expect(rowTitles(page)).toHaveCount(0); // moved out of Inbox
    await go(page, 'Work');
    await expect(rowTitles(page)).toHaveText(['Final memo']);
    await page.getByRole('button', { name: "Edit 'Final memo'" }).click();
    await expect(page.getByLabel('Notes')).toHaveValue('Send to the team');
    await expect(page.getByLabel('Due date')).toHaveValue('2026-06-30');
    await expect(page.getByRole('dialog').getByLabel('List')).toHaveValue('list-work');
  });

  test('edit dialog traps focus, closes on Escape and returns focus [test.tasky.tasks.dialog-accessibility]', async ({ page }) => {
    await open(page, { tasks: [{ id: 't1', title: 'Draft memo' }] });
    const opener = page.getByRole('button', { name: "Edit 'Draft memo'" });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Edit task' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Title')).toBeFocused();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog'))).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('marks a task complete and incomplete [test.tasky.tasks.complete]', async ({ page }) => {
    await open(page, { tasks: [{ id: 't1', title: 'Buy milk' }, { id: 't2', title: 'Walk dog' }] });
    await page.getByRole('checkbox', { name: "Mark 'Buy milk' complete" }).click();
    await expect(rowTitles(page)).toHaveText(['Walk dog']);
    await page.getByLabel('Show completed').check();
    await expect(rowTitles(page)).toHaveText(['Walk dog', 'Buy milk']);
    const done = page.getByRole('checkbox', { name: "Mark 'Buy milk' incomplete" });
    await expect(done).toHaveAttribute('aria-checked', 'true');
    await done.click();
    await expect(page.getByRole('checkbox', { name: "Mark 'Buy milk' complete" })).toHaveAttribute('aria-checked', 'false');
  });

  test('deletes a task only after confirmation [test.tasky.tasks.delete]', async ({ page }) => {
    await open(page, { tasks: [{ id: 't1', title: 'Buy milk' }, { id: 't2', title: 'Walk dog' }] });
    await page.getByRole('button', { name: "Delete 'Buy milk'" }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete task?' });
    await expect(dialog).toContainText('Buy milk');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(rowTitles(page)).toHaveText(['Buy milk', 'Walk dog']);
    await page.getByRole('button', { name: "Delete 'Buy milk'" }).click();
    await page.getByRole('dialog', { name: 'Delete task?' }).getByRole('button', { name: 'Delete task' }).click();
    await expect(rowTitles(page)).toHaveText(['Walk dog']);
  });

  test('task controls are labeled and keyboard operable [test.tasky.tasks.keyboard-operable]', async ({ page }) => {
    await open(page, { tasks: [{ id: 't1', title: 'Buy milk' }] });
    const check = page.getByRole('checkbox', { name: "Mark 'Buy milk' complete" });
    await check.focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: "Mark 'Buy milk' incomplete" })).toHaveCount(0); // hidden once complete
    await page.getByLabel('Show completed').focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('checkbox', { name: "Mark 'Buy milk' incomplete" })).toBeVisible();
    await page.getByRole('button', { name: "Delete 'Buy milk'" }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Delete task?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeFocused();
  });
});
