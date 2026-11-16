import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test.describe('terminal panel', () => {
  test('toggles from the View menu and Ctrl+`, spans the full width and remembers it is open', async ({ page }) => {
    await launch(page);
    const panel = page.getByRole('region', { name: 'Terminal' });
    await expect(panel).toHaveCount(0);
    const terminal = page.getByRole('menuitemcheckbox', { name: 'Claude Terminal' });
    const view = page.getByRole('button', { name: 'View', exact: true });
    await view.click();
    await expect(terminal).not.toBeChecked();
    await terminal.click();
    await expect(panel).toBeVisible();
    // The browser build has no PTY; it explains where the terminal works.
    await expect(panel).toContainText('available in the Orbit desktop app');
    const [pw, vw] = await Promise.all([panel.evaluate((el) => el.getBoundingClientRect().width), page.evaluate(() => window.innerWidth)]);
    expect(pw).toBe(vw);
    await page.screenshot({ path: 'test-results/terminal-panel.png' });
    await view.click();
    await expect(terminal).toBeChecked();
    await terminal.click();
    await expect(panel).toBeHidden();
    await page.keyboard.press('Control+Backquote');
    await expect(panel).toBeVisible();
    await page.reload();
    await expect(panel).toBeVisible();
    await page.getByRole('button', { name: 'Hide terminal' }).click();
    await expect(panel).toBeHidden();
  });
});
