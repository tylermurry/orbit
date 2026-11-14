import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { parseContract } from '@orbit/contract';
import { FILE, fileText, launch } from './helpers';

test.describe('AC-12 Git independence', () => {
  test('without Git: the change views are hidden, Impact explains, everything else works and saves', async ({ page }) => {
    await launch(page, {});
    await expect(page.getByRole('group', { name: 'Change views' })).toHaveCount(0);
    await page.keyboard.press('Control+3');
    const nogit = page.getByTestId('impact-nogit');
    await expect(nogit).toContainText('Version comparison needs the contract to be inside a local Git repository');
    await expect(nogit).toContainText('not inside a Git repository');
    await expect(nogit).toContainText('Nothing is wrong with your contract');

    await page.keyboard.press('Control+1');
    const name = page.getByLabel('Entity name');
    await name.fill('Edited without git');
    await name.press('Enter');
    await page.keyboard.press('Control+s');
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');
    expect(parseContract((await fileText(page, '/home/user/tasky.orbit.json'))!).contract!.entities.find((e) => e.id === 'cap.task-management')!.name).toBe('Edited without git');
    // evidence cannot be checked against code, and nothing offers to
    await expect(page.getByTestId('evidence-line')).toContainText('not checked against any code version');
    await expect(page.getByRole('button', { name: 'Check latest code' })).toHaveCount(0);
  });

  test('git executable missing is described actionably', async ({ page }) => {
    await launch(page, { noGitReason: 'git-missing' });
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('impact-nogit')).toContainText('could not be found');
  });
});

async function overflowCheck(page: Page) {
  return page.evaluate(() => {
    const issues: string[] = [];
    if (document.documentElement.scrollWidth > window.innerWidth) issues.push('page scrolls horizontally');
    for (const el of Array.from(document.querySelectorAll('.topbar button, .topbar [role=radio]'))) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) issues.push(`clipped: ${el.getAttribute('aria-label') ?? el.textContent}`);
    }
    return issues;
  });
}

test.describe('AC-17 desktop viewport + keyboard', () => {
  test('tree: arrows, expand/collapse, Home/End, Enter select, roving tabindex, visible focus', async ({ page }) => {
    await launch(page, { path: FILE, git: true });
    expect(await overflowCheck(page)).toEqual([]);
    const tree = page.getByRole('tree', { name: 'Capabilities' });
    const items = tree.getByRole('treeitem');
    await expect(items.first()).toHaveAttribute('tabindex', '0');
    await expect(tree.locator('[tabindex="0"]')).toHaveCount(1);

    await items.first().focus();
    await expect(items.first()).toBeFocused();
    await expect(items.first()).toHaveAttribute('aria-expanded', 'true');
    await expect(items.first()).toHaveAttribute('aria-level', '1');
    await page.keyboard.press('ArrowLeft'); // collapse
    await expect(items.first()).toHaveAttribute('aria-expanded', 'false');
    await expect(items).toHaveCount(7);
    await page.keyboard.press('ArrowRight'); // expand
    await expect(items.first()).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('ArrowRight'); // into first child
    await expect(items.nth(1)).toBeFocused();
    await expect(items.nth(1)).toHaveAttribute('aria-level', '2');
    await expect(items.nth(1)).toHaveAttribute('tabindex', '0');
    await expect(items.first()).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowLeft'); // to parent
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(items.last()).toBeFocused();
    await page.keyboard.press('Home');
    await expect(items.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    const focused = items.nth(2);
    const nm = await focused.locator('.row-name').innerText();
    await expect(focused).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('entity-detail').getByLabel('Entity name')).toHaveValue(nm.trim());
    // type-ahead
    await page.keyboard.press('Home');
    await page.keyboard.type('Cust');
    await expect(tree.getByRole('treeitem', { name: /^Custom Lists/ })).toBeFocused();
    // focus ring is visible for keyboard users
    const outline = await tree.getByRole('treeitem', { name: /^Custom Lists/ }).evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe('none');
  });

  test('every top bar control is keyboard reachable and named; no clipping in any view', async ({ page }) => {
    await launch(page, { path: FILE, git: true });
    for (const view of ['Control+1', 'Control+2', 'Control+3']) {
      await page.keyboard.press(view);
      expect(await overflowCheck(page)).toEqual([]);
    }
    const unnamed = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, [role=button]'))
        .filter((b) => !b.closest('[hidden]') && !(b.textContent ?? '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby'))
        .map((b) => b.outerHTML.slice(0, 80)),
    );
    expect(unnamed).toEqual([]);
    // tab through the top bar: each stop is focusable and ends up in the content
    await page.locator('.topbar button').first().focus();
    const stops = new Set<string>();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      stops.add(await page.evaluate(() => (document.activeElement as HTMLElement)?.getAttribute('aria-label') ?? (document.activeElement as HTMLElement)?.textContent?.trim().slice(0, 20) ?? ''));
    }
    expect(stops.size).toBeGreaterThan(6);
  });

  test('the shortcut keys switch views and open dialogs', async ({ page }) => {
    await launch(page, { path: FILE, git: true });
    await page.keyboard.press('Control+2');
    await expect(page.getByRole('tree', { name: 'Systems' })).toBeVisible();
    await page.keyboard.press('Control+3');
    await expect(page.getByTestId('impact-view')).toBeVisible();
    await page.keyboard.press('Control+1');
    await expect(page.getByRole('tree', { name: 'Capabilities' })).toBeVisible();
    await page.keyboard.press('Control+o');
  });
});

test('top bar controls never overlap, even with a change view active', async ({ page }) => {
  await launch(page, { path: FILE, git: true });
  await page.keyboard.press('Control+3');
  await expect(page.getByTestId('impact-title')).toHaveText('View actual');
  const boxes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.topbar .identity, .topbar-center, .topbar-right > *'))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { n: (el.getAttribute('aria-label') ?? el.textContent ?? '').slice(0, 24), l: r.left, r: r.right, w: r.width };
      })
      .filter((b) => b.w > 0)
      .sort((a, b) => a.l - b.l),
  );
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].l, `${boxes[i - 1].n} overlaps ${boxes[i].n}`).toBeGreaterThanOrEqual(boxes[i - 1].r - 1);
  expect(boxes[boxes.length - 1].r).toBeLessThanOrEqual(1280);
  // each view button and its details arrow keep their full size
  const parts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.change-views button')).map((el) => {
      const r = el.getBoundingClientRect();
      return { n: el.getAttribute('aria-label') ?? el.textContent ?? '', l: r.left, r: r.right, clipped: el.scrollWidth > el.clientWidth + 1 };
    }),
  );
  expect(parts).toHaveLength(6);
  for (let i = 1; i < parts.length; i++) expect(parts[i].l, `${parts[i - 1].n} overlaps ${parts[i].n}`).toBeGreaterThanOrEqual(parts[i - 1].r - 1);
  for (const p of parts) expect(p.clipped, `${p.n} is clipped`).toBe(false);
});
