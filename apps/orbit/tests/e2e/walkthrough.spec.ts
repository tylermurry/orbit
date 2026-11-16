import { expect, test } from '@playwright/test';
import { launch } from './helpers';

test('steps through descriptions, screenshots, and their combination from a behavior test', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reports = '/home/user/apps/tasky/test-results';
  const image = 'walkthroughs/example.png';
  const nextImage = 'walkthroughs/next.png';
  const widescreenPng = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAJCAIAAAC0SDtlAAAAFElEQVR4nGOo3/CAJMQwqmFQaAAALpIogCijeeoAAAAASUVORK5CYII=';
  const standardPng = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOo3/AAjhhwcgDdYBi1+abiNAAAAABJRU5ErkJggg==';
  await launch(page, { files: {
    [`${reports}/orbit.walkthroughs.json`]: JSON.stringify({ version: 1, tests: {
      'test.tasky.tasks.create': { steps: [
        { description: 'User opens New task.', expectations: ['The new task form opens.'] },
        { image },
        { description: 'User saves the task.', expectations: ['The task appears in Work.'], image: nextImage },
      ] },
    } }),
    [`${reports}/${image}`]: widescreenPng,
    [`${reports}/${nextImage}`]: standardPng,
  } });
  const tree = page.getByRole('tree');
  const taskManagement = tree.getByRole('treeitem', { name: /^Task Management/ });
  await taskManagement.focus();
  await page.keyboard.press('ArrowRight');
  await tree.getByRole('treeitem', { name: /^Create and Edit Tasks/ }).click();
  const behavior = page.locator('[data-behavior-id="behavior.tasks.create"]');
  const expand = behavior.getByRole('button', { name: 'Expand Create a task' });
  if (await expand.isVisible()) await expand.click();
  const collapse = behavior.getByRole('button', { name: 'Collapse Create a task' });
  const trigger = behavior.getByRole('button', { name: /^View walkthrough/ });
  const testRow = behavior.getByTestId('test-row').filter({ has: page.getByRole('button', { name: /^View walkthrough/ }) });
  await behavior.locator('.bh-chevron').click();
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await testRow.click({ position: { x: 2, y: 8 } });
  await expect(collapse).toHaveAttribute('aria-expanded', 'true');
  await collapse.click();
  await expect(testRow).toHaveCount(0);
  await expand.press('Enter');
  await collapse.hover();
  await expect(trigger).toHaveText('End-to-end: creates a task in the selected list');
  await expect(trigger).toHaveCSS('text-decoration-line', 'underline');
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('User opens New task.');
  const expectations = dialog.getByRole('region', { name: 'Expectations' });
  await expect(expectations.getByRole('listitem')).toHaveText('The new task form opens.');
  await expect(dialog).toContainText('No image found for this step');
  const preview = dialog.locator('.walkthrough-preview');
  const height = (await preview.boundingBox())?.height;
  await expect(dialog.getByRole('img')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Previous' })).toBeDisabled();

  await page.keyboard.press('ArrowRight');
  const screenshot = dialog.getByRole('img', { name: 'Screenshot for step 2' });
  await expect(screenshot).toHaveJSProperty('naturalWidth', 16);
  expect((await preview.boundingBox())?.height).toBe(height);
  const widePreview = (await preview.boundingBox())!;
  const wideDialog = (await dialog.boundingBox())!;
  expect(widePreview.width).toBeCloseTo(widePreview.height * 16 / 9, 1);
  await expect(expectations).toContainText('No expectations recorded for this step');

  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      HTMLImageElement.prototype.decode = decode;
      const resume = new Promise<void>((resolve) => window.addEventListener('resume-image-decode', () => resolve(), { once: true }));
      document.body.dataset.imageDecode = 'paused';
      await resume;
      await decode.call(this);
    };
  });
  await dialog.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-image-decode', 'paused');
  await expect(screenshot).toBeVisible();
  await expect(dialog.getByRole('status')).toHaveText('2 of 3');
  await page.evaluate(() => window.dispatchEvent(new Event('resume-image-decode')));
  await expect(dialog.getByRole('img', { name: 'Screenshot for step 3' })).toHaveJSProperty('naturalWidth', 4);
  const standardPreview = (await preview.boundingBox())!;
  expect(standardPreview.width).toBeCloseTo(standardPreview.height * 4 / 3, 1);
  expect((await dialog.boundingBox())?.width).toBeLessThan(wideDialog.width);
  await expect(dialog).toContainText('User saves the task.');
  await expect(expectations.getByRole('listitem')).toHaveText('The task appears in Work.');
  await expect(dialog.getByRole('button', { name: 'Next' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Previous' }).click();
  await expect(dialog.getByRole('status')).toHaveText('2 of 3');
  await page.setViewportSize({ width: 1920, height: 800 });
  expect((await dialog.boundingBox())?.width).toBe(wideDialog.width);
  await page.setViewportSize({ width: 720, height: 800 });
  const narrowPreview = (await preview.boundingBox())!;
  expect((await dialog.boundingBox())?.width).toBeLessThan(720);
  expect(narrowPreview.width).toBeLessThan(widePreview.width);
  expect(narrowPreview.width).toBeCloseTo(narrowPreview.height * 16 / 9, 1);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});
