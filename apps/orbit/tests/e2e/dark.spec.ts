import { test } from '@playwright/test';
import { DEMO, launch } from './helpers';

const dir = process.env.ORBIT_SHOTS ?? '/tmp';

test.use({ colorScheme: 'dark' });
test('dark mode looks intentional', async ({ page }) => {
  await launch(page, { git: true, text: DEMO.implementation });
  await page.getByRole('treeitem', { name: /^Today and Overdue/ }).click();
  await page.screenshot({ path: `${dir}/dark-product.png` });
  await page.keyboard.press('Control+3');
  await page.getByTestId('change-row').nth(3).click();
  await page.screenshot({ path: `${dir}/dark-impact.png` });
  await page.keyboard.press('Control+2');
  await page.screenshot({ path: `${dir}/dark-eng.png` });
});
