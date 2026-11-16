import { expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseWalkthroughs } from '../../src/lib/walkthrough';
import { walkthroughPathOf } from '../../src/state/controller';
import { FILE, TASKY, setup } from './util';

const steps = [
  { description: 'Open New task.' },
  { image: 'walkthroughs/form.png' },
  { description: 'The task appears in Work.', image: 'walkthroughs/run/work.jpg' },
];
const text = JSON.stringify({ version: 1, tests: {
  'test.tasky.tasks.create': { steps: [...steps, { image: 'walkthroughs/../secret.png' }, { image: 'https://example.org/a.png' }, {}] },
} });

it('keeps description-only, image-only and combined steps in order', () => {
  expect(parseWalkthroughs(text).get('test.tasky.tasks.create')).toEqual({ steps });
  expect(parseWalkthroughs('{incomplete').size).toBe(0);
});

it('loads and refreshes walkthroughs independently of JUnit, for XML and directory configurations', async () => {
  const { ctrl, host, store } = setup();
  await ctrl.openPath(FILE);
  const path = '/work/repo/apps/tasky/test-results/orbit.walkthroughs.json';
  expect(walkthroughPathOf(store.getState())).toBe(path);
  await host.externalWrite(path, text);
  await ctrl.pollResults();
  expect(store.getState().resultsFile?.state).toBe('missing');
  expect(store.getState().walkthroughs?.tests.get('test.tasky.tasks.create')?.steps).toEqual(steps);

  const nextFile = '/work/other/orbit.json';
  const next = JSON.parse(TASKY);
  next.validation.results = 'reports/';
  await host.externalWrite(nextFile, JSON.stringify(next));
  await ctrl.openPath(nextFile);
  expect(store.getState().walkthroughs).toBeNull();
  const nextReport = '/work/other/reports/orbit.walkthroughs.json';
  expect(walkthroughPathOf(store.getState())).toBe(nextReport);
  await host.externalWrite(nextReport, text);
  await ctrl.pollResults();
  expect(store.getState().walkthroughs?.path).toBe(nextReport);
  host.externalDelete(nextReport);
  await ctrl.pollResults();
  expect(store.getState().walkthroughs).toBeNull();
});

it('reads native Playwright assertions and screenshot attachments from a discovered blob report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'orbit-blob-test-'));
  const requireModule = createRequire(import.meta.url);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOo3/AAjhhwcgDdYBi1+abiNAAAAABJRU5ErkJggg==';
  try {
    writeFileSync(join(dir, 'tasks.spec.ts'), `
      const { test, expect } = require(${JSON.stringify(requireModule.resolve('@playwright/test'))});
      test('creates a task in the selected list', async () => {
        await test.step('User saves the task', async (step) => {
          expect('Work', 'The task appears in Work.').toBe('Work');
          expect(1).toBe(1);
          await step.attach('After saving', {
            body: Buffer.from('${png}', 'base64'),
            contentType: 'image/png',
          });
        });
      });
    `);
    const output = join(dir, 'blob-report', 'report.zip');
    execFileSync(process.execPath, [requireModule.resolve('@playwright/test/cli'), 'test', '--reporter=blob', '--workers=1'], {
      cwd: dir,
      env: { ...process.env, PLAYWRIGHT_BLOB_OUTPUT_FILE: output },
      timeout: 10_000,
    });
    const { ctrl, host, store } = setup();
    await ctrl.openPath(FILE);
    await host.externalWrite('/work/repo/apps/tasky/test-results/blob-report/report.zip', readFileSync(output).toString('base64'));
    await ctrl.pollResults();
    const walkthrough = store.getState().walkthroughs?.tests.get('test.tasky.tasks.create');
    expect(walkthrough?.steps).toEqual([{
      description: 'User saves the task',
      expectations: ['The task appears in Work.', 'Expect "toBe"'],
      image: 'resources/inline-0.png',
    }]);
    const screenshot = await walkthrough?.readImage?.(walkthrough.steps[0]!.image!);
    expect(screenshot && Buffer.from(screenshot).toString('base64')).toBe(png);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);
