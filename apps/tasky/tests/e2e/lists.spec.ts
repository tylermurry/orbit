import { expect, test } from '@playwright/test';
import { go, nav, open, rowTitles } from './helpers';

test.describe('custom lists', () => {
  test('creates and renames a custom list [test.tasky.lists.create-rename]', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'New list' }).click();
    const create = page.getByRole('dialog', { name: 'New list' });
    await create.getByLabel('List name').fill('Groceries');
    await create.getByRole('button', { name: 'Create list' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Groceries' })).toBeVisible();
    await expect(nav(page).getByRole('button', { name: /^Groceries/ })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('button', { name: 'Rename list' }).click();
    const rename = page.getByRole('dialog', { name: 'Rename list' });
    await expect(rename.getByLabel('List name')).toHaveValue('Groceries');
    await rename.getByLabel('List name').fill('Food');
    await rename.getByRole('button', { name: 'Save name' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Food' })).toBeVisible();
    await expect(nav(page).getByRole('button', { name: /^Groceries/ })).toHaveCount(0);
  });

  test('rejects blank and duplicate list names [test.tasky.lists.name-validation]', async ({ page }) => {
    await open(page, { lists: [{ id: 'l1', name: 'Work' }] });
    await page.getByRole('button', { name: 'New list' }).click();
    const dialog = page.getByRole('dialog', { name: 'New list' });
    await dialog.getByRole('button', { name: 'Create list' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Enter a name for the list.');
    await dialog.getByLabel('List name').fill('work');
    await dialog.getByRole('button', { name: 'Create list' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('A list with that name already exists.');
    await dialog.getByLabel('List name').fill('inbox');
    await dialog.getByRole('button', { name: 'Create list' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('A list with that name already exists.');
  });

  test('Inbox cannot be renamed or deleted [test.tasky.lists.inbox-protected]', async ({ page }) => {
    await open(page, { lists: [{ id: 'l1', name: 'Work' }] });
    await go(page, 'Inbox');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rename list' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete list' })).toHaveCount(0);
    await go(page, 'Work');
    await expect(page.getByRole('button', { name: 'Rename list' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Delete list' })).toBeVisible();
  });

  test('deleting a list moves its tasks to Inbox after confirmation [test.tasky.lists.delete-moves-tasks]', async ({ page }) => {
    await open(page, {
      lists: [{ id: 'l1', name: 'Work' }],
      tasks: [
        { id: 'a', title: 'Alpha', listId: 'l1' },
        { id: 'b', title: 'Bravo', listId: 'l1' },
        { id: 'c', title: 'Charlie', listId: 'l1', completed: true },
        { id: 'd', title: 'Delta' },
      ],
    });
    await go(page, 'Work');
    await page.getByRole('button', { name: 'Delete list' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete list "Work"?' });
    await expect(dialog).toContainText('3 tasks will be moved to Inbox, not deleted');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(nav(page).getByRole('button', { name: /^Work/ })).toBeVisible();
    await page.getByRole('button', { name: 'Delete list' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete list' }).click();
    await expect(nav(page).getByRole('button', { name: /^Work/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    await page.getByLabel('Show completed').check();
    await expect(rowTitles(page)).toHaveText(['Alpha', 'Bravo', 'Delta', 'Charlie']);
  });

  test('assigns a task to a list by editing and by creating inside it [test.tasky.lists.assign-task]', async ({ page }) => {
    await open(page, {
      lists: [{ id: 'l1', name: 'Work' }, { id: 'l2', name: 'Home' }],
      tasks: [{ id: 'a', title: 'Alpha' }],
    });
    await page.getByRole('button', { name: "Edit 'Alpha'" }).click();
    await page.getByRole('dialog').getByLabel('List').selectOption({ label: 'Home' });
    await page.getByRole('button', { name: 'Save changes' }).click();
    await go(page, 'Home');
    await expect(rowTitles(page)).toHaveText(['Alpha']);
    await page.getByRole('button', { name: 'New task' }).click();
    await page.getByLabel('Title').fill('Beta');
    await page.getByRole('button', { name: 'Add task' }).click();
    await expect(rowTitles(page)).toHaveText(['Alpha', 'Beta']);
    await go(page, 'Work');
    await expect(rowTitles(page)).toHaveCount(0);
  });
});
