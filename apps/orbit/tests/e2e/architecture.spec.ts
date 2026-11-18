import { expect, test } from '@playwright/test';
import type { OrbitContract } from '@orbit/contract';
import { launch, TASKY } from './helpers';

test('Architecture rolls up dependencies and reveals their exact endpoints in System', async ({ page }) => {
  const tasky = JSON.parse(TASKY) as OrbitContract;
  tasky.relationships.push({
    id: 'rel.architecture.example',
    type: 'uses',
    sourceId: 'sys.filtering-sorting',
    targetId: 'sys.task-repository',
    description: 'Example link to an external subsystem.',
  });
  await launch(page, { text: JSON.stringify(tasky), git: true });
  await page.getByRole('radio', { name: 'System' }).click();
  await expect(page.getByRole('tab', { name: 'Systems' })).toHaveAttribute('aria-selected', 'true');
  const tabs = page.getByRole('tablist', { name: 'System views' });
  await tabs.getByRole('tab', { name: 'Overview' }).click();

  const map = page.getByRole('group', { name: 'Architecture dependency map' });
  const presentation = map.getByRole('button', { name: 'Presentation Logic', exact: true });
  const filtering = map.getByRole('button', { name: 'Task Filtering and Sorting', exact: true });
  await expect(presentation).toBeVisible();
  await expect(filtering).toHaveCount(0);
  const inspector = page.getByRole('complementary', { name: 'Architecture selection' });
  await expect(inspector).toContainText('Select a node or a relationship');
  const mapBounds = (await map.boundingBox())!;
  const sidebarBounds = (await inspector.boundingBox())!;
  expect(sidebarBounds.x).toBeCloseTo(mapBounds.x + mapBounds.width);
  expect(sidebarBounds.y).toBeCloseTo(mapBounds.y);
  expect(sidebarBounds.height).toBeCloseTo(mapBounds.height);
  const divider = page.getByRole('separator', { name: 'Resize Architecture sidebar' });
  const handle = (await divider.boundingBox())!;
  const x = handle.x + handle.width / 2;
  const y = handle.y + handle.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y);
  await page.mouse.up();
  await expect(divider).toHaveAttribute('aria-valuenow', String(sidebarBounds.width + 100));
  await divider.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', String(sidebarBounds.width + 76));
  await divider.dblclick();
  await expect(divider).toHaveAttribute('aria-valuenow', String(sidebarBounds.width));
  await expect.poll(() => map.boundingBox()).toEqual(mapBounds);
  const rolledUp = map.getByRole('button', { name: /Task Discovery connects to Presentation Logic/ });
  await rolledUp.focus();
  await page.keyboard.press('Enter');
  const scoped = inspector.locator('.architecture-relationships > li');
  await expect(scoped).toHaveCount(2);
  const usesLink = scoped.filter({ has: page.locator('.architecture-relationship-title', { hasText: 'uses' }) });
  await expect(usesLink.locator('.architecture-relationship-title .rt-Badge[data-accent-color="indigo"]')).toHaveText('Task Discovery');
  await expect(usesLink.locator('.architecture-relationship-title .rt-Badge[data-accent-color="cyan"]')).toHaveText('Presentation Logic');
  await expect(scoped.locator('.architecture-relationship-title').filter({ hasText: 'is implemented by' })).toHaveCount(1);
  await expect(usesLink.getByRole('button', { name: /Show \d+ underlying links?/ })).toBeVisible();
  expect(await map.boundingBox()).toEqual(mapBounds);
  await page.getByRole('button', { name: 'Close architecture selection' }).click();
  await expect(inspector).toContainText('Select a node or a relationship');

  await map.getByRole('button', { name: 'Task Discovery', exact: true }).click();
  await expect(inspector).toContainText('Views that answer "what is in this list?"');

  await presentation.dblclick();
  const breadcrumb = page.getByRole('navigation', { name: 'Architecture hierarchy' });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Presentation Logic');
  await expect(filtering).toBeVisible();
  await expect(map.getByRole('button', { name: 'Task Repository', exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'List Repository', exact: true })).toHaveCount(0);
  await expect(map.getByRole('button', { name: 'Task Filtering and Sorting uses Local Date Evaluation', exact: true })).toBeVisible();
  await expect(map.getByRole('button', { name: 'Task Filtering and Sorting uses Task Repository', exact: true })).toBeVisible();

  await filtering.click();
  await inspector.getByRole('button', { name: 'Open in Systems' }).click();
  await expect(page.getByTestId('entity-detail')).toHaveAttribute('data-entity-id', 'sys.filtering-sorting');
  await tabs.getByRole('tab', { name: 'Overview' }).click();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Presentation Logic');
  await page.getByRole('radio', { name: 'Split view' }).click();
  await expect(page.getByTestId('workspace-split').getByRole('group', { name: 'Architecture dependency map' })).toBeVisible();
  await expect(page.getByTestId('impact-view')).toBeVisible();
  await tabs.getByRole('tab', { name: 'Systems' }).click();
  await page.getByRole('button', { name: 'Show in Overview' }).click();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Task Filtering and Sorting');
});

test('wheel zoom can pause between levels, reverse, or finish the same drill-down', async ({ page }) => {
  const tasky = JSON.parse(TASKY) as OrbitContract;
  tasky.entities.push({
    id: 'sys.today-eligibility', kind: 'system', parentId: 'sys.filtering-sorting',
    name: 'Today Eligibility', summary: '', description: '', behaviors: [],
  });
  tasky.relationships.push({
    id: 'rel.eligibility.uses.local-date', type: 'uses',
    sourceId: 'sys.today-eligibility', targetId: 'sys.local-date',
  });
  await launch(page, { text: JSON.stringify(tasky) });
  await page.getByRole('radio', { name: 'System' }).click();
  await page.getByRole('tab', { name: 'Overview' }).click();
  const breadcrumb = page.getByRole('navigation', { name: 'Architecture hierarchy' });
  const map = page.getByRole('group', { name: 'Architecture dependency map' });
  const presentation = map.getByRole('button', { name: 'Presentation Logic', exact: true });
  const moving = map.locator(':scope > g[aria-hidden="true"]');
  await presentation.hover();
  await page.mouse.wheel(0, -100);
  await expect(moving).toBeVisible();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveCount(0);
  await page.mouse.wheel(0, 100);
  await expect(moving).toHaveCount(0);
  await expect(presentation).toBeVisible();

  await presentation.hover();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Presentation Logic');
  await expect(map.getByRole('button', { name: 'Local Date Evaluation', exact: true })).toBeVisible();

  await map.getByRole('button', { name: 'Task Filtering and Sorting', exact: true }).hover();
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Task Filtering and Sorting');
  await expect(map.getByRole('button', { name: 'Today Eligibility uses Local Date Evaluation', exact: true })).toBeVisible();

  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Presentation Logic');
  for (let i = 0; i < 5; i++) await page.mouse.wheel(0, 100);
  await expect(presentation).toBeVisible();
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveCount(0);
});

test('Showing underlying links drills into the system and highlights the exact links', async ({ page }) => {
  await launch(page, { text: TASKY, git: true });
  await page.getByRole('radio', { name: 'System' }).click();
  await page.getByRole('tablist', { name: 'System views' }).getByRole('tab', { name: 'Overview' }).click();
  const map = page.getByRole('group', { name: 'Architecture dependency map' });
  const inspector = page.getByRole('complementary', { name: 'Architecture selection' });
  await map.getByRole('button', { name: /Task Discovery connects to Presentation Logic/ }).click();
  const usesLink = inspector.locator('.architecture-relationships > li')
    .filter({ has: page.locator('.architecture-relationship-title', { hasText: 'uses' }) });
  await usesLink.getByRole('button', { name: /underlying link/ }).click();
  const breadcrumb = page.getByRole('navigation', { name: 'Architecture hierarchy' });
  await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText('Presentation Logic');
  const exact = inspector.locator('.architecture-relationships > li').filter({ hasText: 'Local Date Evaluation' });
  await expect(exact.locator('.rt-Badge[data-accent-color="indigo"]')).toHaveText('Today and Overdue');
  await expect(inspector.locator('.architecture-relationship-title').filter({ hasText: 'is implemented by' })).toHaveCount(0);
  await expect(map.locator('.architecture-edge.selected').first()).toBeVisible();
});
