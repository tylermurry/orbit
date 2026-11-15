import { describe, expect, it } from 'vitest';
import { behaviorAssurance } from '@orbit/contract';
import { createToolRuntime } from '../../src/mcp/tools';
import type { MemorySeed } from '../../src/host/memoryHost';
import { resultsPathOf, runFolderOf } from '../../src/state/controller';
import { assuranceContext } from '../../src/state/store';
import { FILE, TASKY, gitSeed, setup } from './util';

const RESULTS = '/work/repo/apps/tasky/test-results/junit.xml';
const COMMAND = 'npm run validate -w @orbit/tasky';
const junit = (cases: [string, 'pass' | 'fail'][]) =>
  `<testsuites><testsuite name="s">${cases.map(([id, r]) => `<testcase classname="t.ts" name="case [${id}]">${r === 'fail' ? '<failure message="boom"/>' : ''}</testcase>`).join('')}</testsuite></testsuites>`;

async function boot(seed: Partial<MemorySeed> = {}) {
  const s = setup({ git: gitSeed(TASKY), ...seed });
  await s.ctrl.openPath(FILE);
  await s.ctrl.pollResults(true);
  const rt = createToolRuntime({ store: s.store, ctrl: s.ctrl, host: s.host, now: () => new Date('2026-11-14T10:00:00Z') });
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await rt.callTool(name, args);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { d: r.structuredContent as any, err: !!r.isError };
  };
  return { ...s, call };
}

describe('validation paths', () => {
  it('runs from the repository root and resolves the results file against it', async () => {
    const { store } = await boot();
    expect(runFolderOf(store.getState())).toBe('/work/repo');
    expect(resultsPathOf(store.getState())).toBe(RESULTS);
  });
});

describe('running the test suite', () => {
  it('needs a setup, then the person\'s approval of the exact command, then runs and reads the results', async () => {
    const { ctrl, store, host } = await boot({ commands: { [COMMAND]: { exitCode: 1, output: 'ran 2 tests\n', writes: { [RESULTS]: junit([['test.tasky.views.today-overdue', 'pass'], ['test.tasky.local-date.rollover', 'fail']]) } } } });
    expect(store.getState().resultsFile?.state).toBe('missing');
    expect(await ctrl.runValidation()).toBe('needs-approval');
    expect(host.ranCommands).toEqual([]);
    ctrl.approveCommand(COMMAND);
    expect(ctrl.isCommandApproved(COMMAND)).toBe(true);
    expect(ctrl.isCommandApproved(`${COMMAND} && rm -rf /`)).toBe(false); // approval is for the exact text
    expect(await ctrl.runValidation()).toBe('started');
    expect(host.ranCommands).toEqual([{ cwd: '/work/repo', command: COMMAND }]);
    const s = store.getState();
    expect(s.run).toBeNull();
    expect(s.lastRun).toMatchObject({ exitCode: 1, cancelled: false, command: COMMAND });
    expect(s.resultsFile).toMatchObject({ state: 'ok', path: RESULTS });
    const ctx = assuranceContext(s);
    expect(behaviorAssurance(s.contract!, 'behavior.today.due-today', ctx)?.status).toBe('passing');
    expect(behaviorAssurance(s.contract!, 'behavior.localdate.rollover', ctx)?.status).toBe('failing');
  });

  it('is not configured without a validation block, and refuses a second run while one is going', async () => {
    const plain = await boot({});
    plain.store.dispatch({ type: 'edit', fn: (c) => ({ ...c, validation: undefined }) });
    expect(await plain.ctrl.runValidation()).toBe('not-configured');

    const { ctrl, store } = await boot({ commands: { [COMMAND]: { exitCode: 0, delayMs: 50 } } });
    ctrl.approveCommand(COMMAND);
    const first = ctrl.runValidation();
    expect(store.getState().run).not.toBeNull();
    expect(await ctrl.runValidation()).toBe('busy');
    await first;
  });

  it('cancel stops the run and records it as cancelled', async () => {
    const { ctrl, store } = await boot({ commands: { [COMMAND]: { exitCode: 0, delayMs: 5_000 } } });
    ctrl.approveCommand(COMMAND);
    const run = ctrl.runValidation();
    await ctrl.cancelValidation();
    await run;
    expect(store.getState().lastRun).toMatchObject({ cancelled: true, exitCode: null });
  });

  it('reports a command that cannot start', async () => {
    const { ctrl, store } = await boot({ commands: {} });
    ctrl.approveCommand(COMMAND);
    await ctrl.runValidation();
    expect(store.getState().lastRun?.output).toMatch(/Could not start/);
    expect(store.getState().toasts.some((t) => t.tone === 'error')).toBe(true);
  });
});

describe('watching the results file', () => {
  it('picks up results written by someone else (a terminal or the AI), and reports unreadable files', async () => {
    const { ctrl, store, host } = await boot();
    await host.externalWrite(RESULTS, junit([['test.tasky.views.today-overdue', 'pass']]));
    await ctrl.pollResults();
    expect(store.getState().resultsFile?.state).toBe('ok');
    const first = store.getState().resultsFile;
    await ctrl.pollResults(); // unchanged file: nothing is re-read
    expect(store.getState().resultsFile).toBe(first);
    await host.externalWrite(RESULTS, '{"not": "junit"}');
    await ctrl.pollResults();
    expect(store.getState().resultsFile).toMatchObject({ state: 'invalid', message: expect.stringMatching(/not a JUnit XML/) });
  });
});

describe('run_tests (MCP)', () => {
  it('refuses an unapproved command and opens the Validate tab for the person', async () => {
    const { call, store, host } = await boot({ commands: { [COMMAND]: { exitCode: 0 } } });
    const r = await call('run_tests');
    expect(r.err).toBe(true);
    expect(r.d.error).toMatch(/not approved/);
    expect(store.getState()).toMatchObject({ terminalOpen: true, terminalTab: 'validate' });
    expect(host.ranCommands).toEqual([]);
  });

  it('runs an approved command and returns statuses, failing tests first', async () => {
    const { call, ctrl } = await boot({ commands: { [COMMAND]: { exitCode: 1, output: 'FAIL rollover\n', writes: { [RESULTS]: junit([['test.tasky.views.today-overdue', 'pass'], ['test.tasky.local-date.rollover', 'fail']]) } } } });
    ctrl.approveCommand(COMMAND);
    const r = await call('run_tests');
    expect(r.err, JSON.stringify(r.d)).toBe(false);
    expect(r.d).toMatchObject({ exitCode: 1, cancelled: false, totals: { passing: 1, failing: 1 } });
    expect(r.d.failing).toEqual([expect.objectContaining({ id: 'test.tasky.local-date.rollover', status: 'failing', lastResult: expect.objectContaining({ message: 'boom' }) })]);
    expect(r.d.output).toContain('FAIL rollover');
  });

  it('explains how to set up a missing command', async () => {
    const { call, store } = await boot();
    store.dispatch({ type: 'edit', fn: (c) => ({ ...c, validation: undefined }) });
    const r = await call('run_tests');
    expect(r.err).toBe(true);
    expect(r.d.suggestions.join(' ')).toMatch(/set_validation/);
  });
});
