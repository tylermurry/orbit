import { expect, test } from '@playwright/test';
import { go, nav, open, rowTitles } from './helpers';

const LISTS = [{ id: 'l1', name: 'Work' }];

test.describe('views', () => {
  test('Inbox shows only Inbox tasks and hides completed until toggled [test.tasky.views.inbox]', async ({ page }) => {
    await open(page, {
      lists: LISTS,
      tasks: [
        { id: 'a', title: 'Inbox open' },
        { id: 'b', title: 'Inbox done', completed: true },
        { id: 'c', title: 'Work task', listId: 'l1' },
      ],
    });
    await expect(rowTitles(page)).toHaveText(['Inbox open']);
    await page.getByLabel('Show completed').check();
    await expect(rowTitles(page)).toHaveText(['Inbox open', 'Inbox done']);
    await expect(nav(page).getByRole('button', { name: /^Inbox/ })).toContainText('1');
  });

  test('All Tasks shows completed tasks after incomplete ones in due-date order [test.tasky.views.all-tasks]', async ({ page }) => {
    await open(page, {
      lists: LISTS,
      tasks: [
        { id: 'a', title: 'Done early', completed: true, dueDate: '2026-06-01' },
        { id: 'b', title: 'No date' },
        { id: 'c', title: 'Later', dueDate: '2026-06-30', listId: 'l1' },
        { id: 'd', title: 'Sooner', dueDate: '2026-06-18' },
      ],
    });
    await go(page, 'All Tasks');
    await expect(page.getByLabel('Show completed')).toHaveCount(0);
    await expect(rowTitles(page)).toHaveText(['Sooner', 'Later', 'No date', 'Done early']);
  });

  test('Today shows tasks due today and overdue, labeling overdue in text [test.tasky.views.today-overdue]', async ({ page }) => {
    await open(page, {
      lists: LISTS,
      tasks: [
        { id: 'a', title: 'Due today', dueDate: '2026-06-15' },
        { id: 'b', title: 'Long overdue', dueDate: '2026-06-10', listId: 'l1' },
        { id: 'c', title: 'Due tomorrow', dueDate: '2026-06-16' },
        { id: 'd', title: 'No date' },
        { id: 'e', title: 'Done today', dueDate: '2026-06-15', completed: true },
      ],
    });
    await go(page, 'Today');
    await expect(rowTitles(page)).toHaveText(['Long overdue', 'Due today']);
    const overdueRow = page.getByRole('listitem').filter({ hasText: 'Long overdue' });
    await expect(overdueRow).toContainText('Overdue');
    await expect(page.getByRole('listitem').filter({ hasText: 'Due today' })).not.toContainText('Overdue');
    await expect(overdueRow).toContainText('Work');
  });

  test('Today re-evaluates when the local date rolls over on focus [test.tasky.views.today-rollover]', async ({ page }) => {
    await open(
      page,
      {
        tasks: [
          { id: 'a', title: 'Due the 15th', dueDate: '2026-06-15' },
          { id: 'b', title: 'Due the 16th', dueDate: '2026-06-16' },
        ],
      },
      '2026-06-15T23:59:00-04:00',
    );
    await go(page, 'Today');
    await expect(rowTitles(page)).toHaveText(['Due the 15th']);
    await expect(page.getByText('Overdue', { exact: true })).toHaveCount(0);
    await page.clock.setFixedTime('2026-06-16T00:01:00-04:00');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(rowTitles(page)).toHaveText(['Due the 15th', 'Due the 16th']);
    await expect(page.getByRole('listitem').filter({ hasText: 'Due the 15th' })).toContainText('Overdue');
    await expect(page.getByRole('listitem').filter({ hasText: 'Due the 16th' })).not.toContainText('Overdue');
  });

  test('Today updates at local midnight without any interaction [test.tasky.views.today-midnight-timer]', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-06-15T23:59:50-04:00') });
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      ['tasky:v1', JSON.stringify({
        version: 1,
        lists: [],
        tasks: [
          { id: 'a', title: 'Due the 15th', notes: '', dueDate: '2026-06-15', completed: false, listId: 'inbox', createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
        ],
      })],
    );
    await page.goto('/');
    await go(page, 'Today');
    await expect(page.getByText('Overdue', { exact: true })).toHaveCount(0);
    await page.clock.fastForward(20_000);
    await expect(page.getByText('Overdue', { exact: true })).toBeVisible();
  });

  test('every view has a useful empty state [test.tasky.views.empty-states]', async ({ page }) => {
    await open(page, { lists: LISTS });
    await expect(page.getByRole('heading', { name: 'Inbox is empty' })).toBeVisible();
    await go(page, 'Today');
    await expect(page.getByRole('heading', { name: 'Nothing due today' })).toBeVisible();
    await go(page, 'All Tasks');
    await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
    await go(page, 'Work');
    await expect(page.getByRole('heading', { name: 'No tasks in Work' })).toBeVisible();
  });
});
