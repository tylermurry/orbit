import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test.describe('AI view filter', () => {
  test('filter_view shows a yellow banner, narrows the tree, and the X clears it', async ({ page }) => {
    await launch(page);
    await expect(page.getByRole('tree')).toBeVisible();
    const before = await page.getByRole('treeitem').count();
    const r = await page.evaluate(() =>
      window.__orbitMcp!.callTool('filter_view', {
        description: 'Showing capabilities and behaviors related to a task being overdue.',
        entityIds: ['cap.task-discovery.today-overdue'],
        behaviorIds: ['behavior.today.rollover'],
      }),
    );
    expect(r.isError).toBeFalsy();
    const banner = page.getByTestId('banner-filter');
    await expect(banner).toContainText('related to a task being overdue');
    await expect(page.getByRole('treeitem', { name: /Behavior:/ }).first()).toBeVisible();
    expect(await page.getByRole('treeitem').count()).toBeLessThan(before);
    await page.screenshot({ path: 'test-results/filter-banner.png' });
    await banner.getByRole('button', { name: 'Clear filter' }).click();
    await expect(banner).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(before);
  });
});
