/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { createMcpRuntime, mcpUiState } from '../../src/mcp/runtime';
import type { McpSnapshot } from '../../src/mcp/runtime';
import { FILE, setup } from './util';

async function boot() {
  const { host, store, ctrl } = setup();
  await ctrl.openPath(FILE);
  return { store, rt: createMcpRuntime({ store, ctrl, host }) };
}

describe('MCP bridge runtime', () => {
  it('answers tools/list and tools/call in the bridge response shape', async () => {
    const { rt } = await boot();
    const list: any = await rt.handleBridgeRequest({ requestId: 'r1', method: 'tools/list', params: {} });
    expect(list.result.tools.length).toBeGreaterThan(40);
    const call: any = await rt.handleBridgeRequest({ requestId: 'r2', method: 'tools/call', params: { name: 'get_status', arguments: {} } });
    expect(call.result.isError).toBeUndefined();
    expect(call.result.structuredContent.product.id).toBe('tasky');
    expect(JSON.parse(call.result.content[0].text).product.id).toBe('tasky');
    const noArgs: any = await rt.handleBridgeRequest({ requestId: 'r3', method: 'tools/call', params: { name: 'get_status' } });
    expect(noArgs.result.structuredContent.file.name).toBe('tasky.orbit.json');
  });

  it('maps protocol problems to JSON-RPC errors and tool failures to isError results', async () => {
    const { rt } = await boot();
    const unknown: any = await rt.handleBridgeRequest({ requestId: 'r', method: 'tools/call', params: { name: 'nope', arguments: {} } });
    expect(unknown.error.code).toBe(-32602);
    expect(unknown.error.message).toMatch(/Unknown tool 'nope'/);
    const noName: any = await rt.handleBridgeRequest({ requestId: 'r', method: 'tools/call', params: {} });
    expect(noName.error.code).toBe(-32602);
    const badArgs: any = await rt.handleBridgeRequest({ requestId: 'r', method: 'tools/call', params: { name: 'get_status', arguments: [] } });
    expect(badArgs.error.code).toBe(-32602);
    const failed: any = await rt.handleBridgeRequest({ requestId: 'r', method: 'tools/call', params: { name: 'get_entity', arguments: { id: 'zzz' } } });
    expect(failed.error).toBeUndefined();
    expect(failed.result.isError).toBe(true);
  });

  it('keeps an activity log with mutation flags and a bounded ring buffer', async () => {
    const { rt } = await boot();
    await rt.callTool('get_status', {});
    await rt.callTool('update_product', { name: 'Changed' });
    await rt.callTool('get_entity', { id: 'zzz' });
    await rt.callTool('update_product', { name: 'Changed' }).catch(() => undefined);
    const a = rt.getSnapshot().activity;
    expect(a.map((x) => [x.tool, x.ok, x.mutated])).toEqual([
      ['update_product', true, false],
      ['get_entity', false, false],
      ['update_product', true, true],
      ['get_status', true, false],
    ]);
    expect(a[2].summary).toBe("Updated product 'Changed'");
    expect(a[1].summary).toMatch(/was not found/);
    for (let i = 0; i < 60; i++) await rt.callTool('get_status', {});
    expect(rt.getSnapshot().activity).toHaveLength(50);
    await expect(rt.callTool('nope', {})).rejects.toThrow(/Unknown tool/);
    expect(rt.getSnapshot().activity[0]).toMatchObject({ tool: 'nope', ok: false });
  });

  it('derives the AI button state', () => {
    const base: McpSnapshot = { supported: true, status: null, statusError: null, activity: [], lastRequestAt: null, inflight: 0, toolCount: 1 };
    const st = (enabled: boolean, running: boolean, error?: string) => ({ enabled, running, token: 't', ...(error ? { error } : {}) });
    expect(mcpUiState({ ...base, supported: false }, 0)).toBe('unsupported');
    expect(mcpUiState(base, 0)).toBe('off');
    expect(mcpUiState({ ...base, status: st(false, false) }, 0)).toBe('off');
    expect(mcpUiState({ ...base, status: st(true, true) }, 100_000)).toBe('ready');
    expect(mcpUiState({ ...base, status: st(true, true), lastRequestAt: 95_000 }, 100_000)).toBe('active');
    expect(mcpUiState({ ...base, status: st(true, true), lastRequestAt: 80_000 }, 100_000)).toBe('ready');
    expect(mcpUiState({ ...base, status: st(true, true), inflight: 1 }, 100_000)).toBe('active');
    expect(mcpUiState({ ...base, status: st(true, false, 'port busy') }, 0)).toBe('error');
    expect(mcpUiState({ ...base, status: st(true, false) }, 0)).toBe('error');
  });
});
