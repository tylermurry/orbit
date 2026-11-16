import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import path from 'node:path';
import { DEMO, ROOT, launch } from './helpers';

type Payload = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function ai(page: Page, name: string, args: Record<string, unknown> = {}): Promise<{ isError?: boolean; data: Payload }> {
  const r = await page.evaluate(([n, a]) => window.__orbitMcp!.callTool(n as string, a as Record<string, unknown>), [name, args] as const);
  return { isError: r.isError, data: r.structuredContent as Payload };
}

const item = (page: Page, name: string) => page.getByRole('treeitem', { name: new RegExp(`^${name}`) });

test.describe('AI tool runtime (window.__orbitMcp)', () => {
  test('exposes the tool list and rejects unknown tools', async ({ page }) => {
    await launch(page);
    await expect(page.getByRole('button', { name: 'Switch project (Tasky)' })).toBeVisible();
    const names = await page.evaluate(() => window.__orbitMcp!.listTools().map((t) => t.name));
    expect(names).toEqual(expect.arrayContaining(['get_status', 'create_entity', 'apply_edits', 'compare', 'save_file']));
    const err = await page.evaluate(() => window.__orbitMcp!.callTool('nope', {}).then(() => 'resolved', (e: Error) => e.message));
    expect(err).toMatch(/Unknown tool 'nope'/);
  });

  test('AI edits show a toast and update the UI live; navigate moves the view; undo reverts', async ({ page }) => {
    await launch(page);
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'false');

    const created = await ai(page, 'create_entity', { kind: 'capability', name: 'Reminders', summary: 'Nudges before tasks are due' });
    expect(created.isError).toBeFalsy();
    expect(created.data.entity.id).toBe('cap.reminders');
    await expect(page.getByTestId('toast').filter({ hasText: "AI · Created capability 'Reminders'" })).toBeVisible();
    await expect(item(page, 'Reminders')).toBeVisible();
    await expect(page.getByTestId('save-button')).toHaveAttribute('data-dirty', 'true');

    await ai(page, 'navigate', { entityId: 'cap.reminders' });
    await expect(page.getByTestId('entity-detail')).toContainText('Reminders');

    const b = await ai(page, 'create_behavior', { entityId: 'cap.reminders', name: 'Overdue items remain visible', expected: 'Overdue tasks stay visible until completed.' });
    expect(b.isError).toBeFalsy();
    await expect(page.getByTestId('toast').filter({ hasText: "AI · Created behavior 'Overdue items remain visible'" })).toBeVisible();
    await expect(page.getByTestId('entity-detail')).toContainText('Overdue items remain visible');

    // a nested entity expands its parent so it is visible
    await ai(page, 'create_entity', { kind: 'capability', name: 'Snooze', summary: 'Delay a reminder', parentId: 'cap.reminders' });
    await expect(item(page, 'Snooze')).toBeVisible();

    // invalid edits are refused and the UI is untouched
    const bad = await ai(page, 'create_entity', { kind: 'capability', name: 'Bad', summary: 'x', parentId: 'sys.local-data' });
    expect(bad.isError).toBe(true);
    expect(bad.data.error).toMatch(/can only be nested under a capability/);
    await expect(item(page, 'Bad')).toHaveCount(0);

    // atomic batch = one undo step
    await ai(page, 'apply_edits', {
      operations: [
        { tool: 'create_entity', args: { kind: 'system', name: 'Scheduler', summary: 'Runs timers', id: 'sys.scheduler' } },
        { tool: 'create_relationship', args: { type: 'uses', sourceId: 'cap.reminders', targetId: 'sys.scheduler' } },
      ],
    });
    await page.keyboard.press('Control+2');
    await expect(item(page, 'Scheduler')).toBeVisible();
    await ai(page, 'undo');
    await expect(item(page, 'Scheduler')).toHaveCount(0);
    const status = await ai(page, 'get_status');
    expect(status.data).toMatchObject({ dirty: true, valid: true });
    expect(status.data.history.canRedo).toBe(true);
  });

  test('navigation tools switch views and open the library', async ({ page }) => {
    await launch(page, { git: true, text: DEMO.implementation });
    await ai(page, 'navigate', { entityId: 'sys.local-date' });
    await expect(page.getByRole('tree', { name: 'Systems' })).toBeVisible();
    await ai(page, 'navigate', { openLibrary: 'evidence' });
    await expect(page.getByRole('dialog')).toContainText('never runs tests');
    await ai(page, 'navigate', { openLibrary: 'none' });
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const cmp = await ai(page, 'compare', { base: 'main', target: 'implementation', show: true });
    expect(cmp.isError).toBeFalsy();
    expect(cmp.data.totalChanges).toBe(17);
    await expect(page.getByTestId('impact-title')).toHaveText('Custom comparison');
    await expect(page.getByTestId('change-row')).toHaveCount(17);
    await ai(page, 'clear_comparison');
  });

  test('evidence context from AI changes assurance in the UI', async ({ page }) => {
    await launch(page, { git: true });
    const r = await ai(page, 'set_evidence_context', { mode: 'head' });
    expect(r.isError).toBeFalsy();
    await expect(page.getByTestId('toast').filter({ hasText: 'AI · Inspecting evidence for HEAD' })).toBeVisible();
    const s = await ai(page, 'get_status');
    expect(s.data.evidenceContext.kind).toBe('head');
  });

  test('save_file persists through the host and refuses external-change conflicts', async ({ page }) => {
    const p = await launch(page);
    await ai(page, 'update_product', { name: 'Tasky AI' });
    const saved = await ai(page, 'save_file');
    expect(saved.data.saved).toBe(true);
    expect(await page.evaluate((x) => window.__orbitMemoryHost!.getFile(x), p)).toContain('Tasky AI');
    await ai(page, 'update_product', { name: 'Tasky AI 2' });
    await page.evaluate(([x]) => window.__orbitMemoryHost!.externalWrite(x, '{"schemaVersion":1}'), [p]);
    const conflict = await ai(page, 'save_file');
    expect(conflict.isError).toBe(true);
    expect(conflict.data.reason).toBe('conflict');
  });
});

test.describe('AI access dialog', () => {
  test('browser mode explains that the server runs in the desktop app and shows setup snippets', async ({ page }) => {
    await launch(page);
    const btn = page.getByTestId('ai-button');
    await expect(btn).toBeVisible();
    await expect(btn).toHaveAttribute('data-state', 'unsupported');
    await btn.click();
    const dialog = page.getByRole('dialog', { name: 'AI access (MCP)' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('mcp-desktop-only')).toContainText('MCP server runs in the desktop app');
    await expect(dialog.getByRole('switch')).toBeDisabled();
    await expect(dialog).toContainText('in-memory and undoable until you save');
    await expect(dialog.getByLabel('Claude Code command', { exact: true })).toContainText('claude mcp add --transport http orbit http://127.0.0.1:47821/mcp');
    await dialog.getByRole('tab', { name: 'JSON config' }).click();
    await expect(dialog.getByLabel('JSON config', { exact: true })).toContainText('"mcpServers"');
    await dialog.getByRole('tab', { name: 'stdio bridge' }).click();
    await expect(dialog.getByLabel('stdio bridge command', { exact: true })).toContainText('orbit-mcp-stdio.mjs');
    await expect(dialog.getByTestId('mcp-activity')).toContainText('No AI requests yet');
  });

  test('the activity log lists AI requests', async ({ page }) => {
    await launch(page);
    await ai(page, 'get_status');
    await ai(page, 'create_entity', { kind: 'system', name: 'Mailer', summary: 'Sends mail' });
    await ai(page, 'get_entity', { id: 'sys.nothing' });
    await page.getByTestId('ai-button').click();
    const rows = page.getByTestId('mcp-activity-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('get_entity');
    await expect(rows.nth(0)).toContainText('Error');
    await expect(rows.nth(1)).toContainText("Created system 'Mailer'");
    await expect(rows.nth(1)).toContainText('Changed');
  });
});

test.describe('AI access dialog (desktop server seeded)', () => {
  const status = { enabled: true, running: true, url: 'http://127.0.0.1:47821/mcp', port: 47821, token: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90' };

  async function launchDesktop(page: Page, over: Partial<typeof status> & { error?: string } = {}) {
    await page.addInitScript((s) => {
      (window as unknown as { __ORBIT_TEST_MCP_STATUS__: unknown }).__ORBIT_TEST_MCP_STATUS__ = s;
    }, { ...status, ...over });
    return launch(page, { git: true });
  }

  test('shows endpoint and live-filled snippets (no token)', async ({ page }) => {
    await launchDesktop(page);
    const btn = page.getByTestId('ai-button');
    await expect(btn).toHaveAttribute('data-state', 'ready');
    await btn.click();
    const dialog = page.getByRole('dialog', { name: 'AI access (MCP)' });
    await expect(dialog.getByTestId('mcp-desktop-only')).toHaveCount(0);
    await expect(dialog.getByTestId('mcp-status')).toContainText('Running');
    await expect(dialog.getByLabel('Endpoint URL', { exact: true })).toHaveValue(status.url);
    await expect(dialog.getByLabel('Claude Code command', { exact: true })).toContainText(`claude mcp add --transport http orbit ${status.url}`);
    await expect(dialog.getByLabel('Access token')).toHaveCount(0);
    // toggle off
    await dialog.getByRole('switch').click();
    await expect(dialog.getByTestId('mcp-status')).toContainText('Stopped');
    await page.keyboard.press('Escape');
    await expect(btn).toHaveAttribute('data-state', 'off');
  });

  test('turns Active while the AI works and shows an error state', async ({ page }) => {
    await launchDesktop(page);
    await ai(page, 'get_status');
    await expect(page.getByTestId('ai-button')).toHaveAttribute('data-state', 'active');
    await page.close();
    const p2 = await page.context().newPage();
    await launchDesktop(p2, { running: false, error: 'Ports 47821-47830 are all in use.' });
    await expect(p2.getByTestId('ai-button')).toHaveAttribute('data-state', 'error');
    await p2.getByTestId('ai-button').click();
    await expect(p2.getByRole('alert')).toContainText('Ports 47821-47830 are all in use.');
  });

  test('screenshot: AI access dialog', async ({ page }) => {
    await launchDesktop(page);
    await ai(page, 'get_status');
    await ai(page, 'list_entities', { query: 'overdue' });
    await ai(page, 'create_behavior', { entityId: 'cap.task-discovery.today-overdue', name: 'Overdue items remain visible', expected: 'Overdue tasks stay in Today until they are completed.' });
    await ai(page, 'get_entity', { id: 'cap.task-discovery.today-overdu' });
    await ai(page, 'navigate', { entityId: 'cap.task-discovery.today-overdue' });
    await page.getByTestId('ai-button').click();
    const dialog = page.getByRole('dialog', { name: 'AI access (MCP)' });
    await expect(dialog.getByTestId('mcp-activity-row')).toHaveCount(5);
    await page.waitForTimeout(500); // let the dialog finish its open animation
    await page.screenshot({ path: path.join(ROOT, 'docs/screenshots/orbit-mcp.png') });
  });
});
