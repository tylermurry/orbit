import { expect, test } from '@playwright/test';
import { FILE, launch } from './helpers';

test('drag to reorder capabilities and keyboard nudge', async ({ page }) => {
  await launch(page, { path: FILE });
  const tree = page.getByRole('tree', { name: 'Capabilities' });
  const roots = () => tree.locator('[role="treeitem"][aria-level="1"] .row-name').allTextContents();
  const before = await roots();
  const last = tree.locator('[role="treeitem"][aria-level="1"]').last();
  const first = tree.locator('[role="treeitem"][aria-level="1"]').first();
  const fb = (await first.boundingBox())!;
  const lb = (await last.boundingBox())!;
  await page.mouse.move(lb.x + 60, lb.y + lb.height / 2);
  await page.mouse.down();
  await page.mouse.move(lb.x + 60, lb.y - 20, { steps: 5 });
  await page.mouse.move(fb.x + 60, fb.y + 2, { steps: 10 });
  await page.mouse.up();
  const after = await roots();
  expect(after[0]).toBe(before[before.length - 1]);
  await tree.locator('[role="treeitem"][aria-level="1"]').first().focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await roots())[1]).toBe(before[before.length - 1]);
});
