import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('only the workspace layout toggle switches between combined and split views', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 800 });
  await launch(page, { git: true });

  const combined = page.getByRole('radio', { name: 'Combined view' });
  const split = page.getByRole('radio', { name: 'Split view' });
  const workspace = page.getByTestId('workspace-split');
  const impact = page.getByTestId('impact-view');
  const capabilities = page.getByRole('tree', { name: 'Capabilities' });

  await expect(combined).toBeChecked();
  await expect(workspace).toHaveCount(0);
  await page.setViewportSize({ width: 1100, height: 800 });

  const toolbarBounds = () => page.getByRole('banner').evaluate((bar) => {
    const center = (element: Element) => {
      const { top, height } = element.getBoundingClientRect();
      return top + height / 2;
    };
    return {
      bottom: bar.getBoundingClientRect().bottom,
      controls: Array.from(bar.querySelectorAll('.topbar-group .switcher, .topbar-right > *'), center),
    };
  });
  const combinedBar = await toolbarBounds();
  expect(Math.max(...combinedBar.controls) - Math.min(...combinedBar.controls)).toBeLessThan(1);

  await split.click();
  await expect(split).toBeChecked();
  await expect(workspace).toBeVisible();
  await expect(capabilities).toBeVisible();
  await expect(impact).toBeVisible();
  const splitBar = await toolbarBounds();
  expect(splitBar.bottom).toBe(combinedBar.bottom);
  expect(Math.max(...splitBar.controls) - Math.min(...splitBar.controls)).toBeLessThan(1);

  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(workspace).toBeVisible();
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(split).toBeChecked();
  await expect(workspace).toBeVisible();
  await page.reload();
  await expect(split).toBeChecked();
  await expect(workspace).toBeVisible();

  await combined.click();
  await expect(combined).toBeChecked();
  await expect(workspace).toHaveCount(0);
  await expect(capabilities).toBeVisible();
  await expect(impact).toHaveCount(0);
  await page.setViewportSize({ width: 1600, height: 800 });
  await expect(combined).toBeChecked();
  await expect(workspace).toHaveCount(0);
});
