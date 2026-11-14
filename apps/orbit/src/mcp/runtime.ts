// Connects the tool registry to the outside world:
//  - Tauri: answers `mcp:request` events from the Rust MCP server and tracks server status.
//  - Memory host (tests / browser): exposes window.__orbitMcp = { listTools, callTool }.
// Also keeps a ring-buffer activity log the UI shows.
import type { OrbitHost } from '../host/types';
import type { Controller } from '../state/controller';
import type { Store } from '../state/store';
import { MCP_REQUEST_EVENT, MCP_STATUS_EVENT } from './bridge';
import type { McpBridgeRequest, McpBridgeResponse, McpStatus } from './bridge';
import { createToolRuntime, UnknownToolError } from './tools';
import type { CallToolResult, Tool } from './tools';

export const ACTIVE_WINDOW_MS = 10_000;
const MAX_ACTIVITY = 50;

export interface ActivityEntry {
  id: number;
  at: number;
  tool: string;
  ok: boolean;
  summary: string;
  mutated: boolean;
  ms: number;
}

export interface McpSnapshot {
  /** The MCP server runs in the desktop app only. */
  supported: boolean;
  status: McpStatus | null;
  statusError: string | null;
  activity: ActivityEntry[];
  lastRequestAt: number | null;
  inflight: number;
  toolCount: number;
}

export type McpUiState = 'unsupported' | 'off' | 'ready' | 'active' | 'error';

export function mcpUiState(s: McpSnapshot, now: number): McpUiState {
  if (!s.supported) return 'unsupported';
  if (!s.status) return s.statusError ? 'error' : 'off';
  if (!s.status.enabled) return 'off';
  if (s.status.error || (s.status.enabled && !s.status.running)) return 'error';
  if (s.inflight > 0 || (s.lastRequestAt !== null && now - s.lastRequestAt < ACTIVE_WINDOW_MS)) return 'active';
  return 'ready';
}

export interface McpRuntime {
  listTools(): Tool[];
  callTool(name: string, args?: unknown): Promise<CallToolResult>;
  handleBridgeRequest(req: McpBridgeRequest): Promise<McpBridgeResponse>;
  getSnapshot(): McpSnapshot;
  subscribe(fn: () => void): () => void;
  /** Begin listening (Tauri events or window.__orbitMcp). Returns a stop function. */
  start(): () => void;
  setEnabled(enabled: boolean): Promise<void>;
  /** Resolves to an error message, or null on success. */
  regenerateToken(): Promise<string | null>;
}

declare global {
  interface Window {
    /** Test/screenshot seed: pretend the desktop MCP server has this status (memory host only). */
    __ORBIT_TEST_MCP_STATUS__?: McpStatus;
    __orbitMcp?: { listTools(): Tool[]; callTool(name: string, args?: unknown): Promise<CallToolResult> };
  }
}

const shorten = (t: string) => (t.length > 110 ? `${t.slice(0, 109)}…` : t);

function briefArgs(args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const v = Object.values(args as Record<string, unknown>).find((x) => typeof x === 'string') as string | undefined;
  return v ? (v.length > 48 ? `${v.slice(0, 47)}…` : v) : '';
}

export function createMcpRuntime({ store, ctrl, host }: { store: Store; ctrl: Controller; host: OrbitHost }): McpRuntime {
  const tools = createToolRuntime({ store, ctrl, host });
  const listeners = new Set<() => void>();
  let seq = 1;
  const seed = host.kind === 'memory' && typeof window !== 'undefined' ? window.__ORBIT_TEST_MCP_STATUS__ : undefined;
  let snapshot: McpSnapshot = {
    supported: host.kind === 'tauri' || !!seed,
    status: seed ?? null,
    statusError: null,
    activity: [],
    lastRequestAt: null,
    inflight: 0,
    toolCount: tools.listTools().length,
  };
  const update = (patch: Partial<McpSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((l) => l());
  };

  async function callLogged(name: string, args: unknown): Promise<CallToolResult> {
    const t0 = Date.now();
    update({ lastRequestAt: t0, inflight: snapshot.inflight + 1 });
    try {
      const ex = await tools.execute(name, args);
      const entry: ActivityEntry = { id: seq++, at: Date.now(), tool: name, ok: ex.ok, summary: shorten(ex.summary || briefArgs(args)), mutated: ex.mutated, ms: Date.now() - t0 };
      update({ activity: [entry, ...snapshot.activity].slice(0, MAX_ACTIVITY), lastRequestAt: Date.now() });
      return ex.result;
    } catch (e) {
      const entry: ActivityEntry = { id: seq++, at: Date.now(), tool: name, ok: false, summary: shorten(e instanceof Error ? e.message : String(e)), mutated: false, ms: Date.now() - t0 };
      update({ activity: [entry, ...snapshot.activity].slice(0, MAX_ACTIVITY) });
      throw e;
    } finally {
      update({ inflight: Math.max(0, snapshot.inflight - 1) });
    }
  }

  async function handleBridgeRequest(req: McpBridgeRequest): Promise<McpBridgeResponse> {
    try {
      if (req.method === 'tools/list') {
        update({ lastRequestAt: Date.now() });
        return { result: { tools: tools.listTools() } };
      }
      if (req.method === 'tools/call') {
        const p = req.params ?? {};
        if (typeof p.name !== 'string' || !p.name) return { error: { code: -32602, message: "tools/call requires a string 'name'." } };
        const args = p.arguments;
        if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
          return { error: { code: -32602, message: "tools/call 'arguments' must be an object." } };
        }
        return { result: await callLogged(p.name, args) };
      }
      return { error: { code: -32601, message: `Method not found: ${String((req as { method?: unknown }).method)}` } };
    } catch (e) {
      if (e instanceof UnknownToolError) return { error: { code: e.code, message: e.message } };
      return { error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
    }
  }

  function start(): () => void {
    if (host.kind !== 'tauri') {
      const api = { listTools: () => tools.listTools(), callTool: (name: string, args?: unknown) => callLogged(name, args) };
      window.__orbitMcp = api;
      return () => {
        if (window.__orbitMcp === api) delete window.__orbitMcp;
      };
    }
    let stopped = false;
    const unlisten: (() => void)[] = [];
    void (async () => {
      try {
        const [{ listen }, { invoke }] = await Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')]);
        const u1 = await listen<McpBridgeRequest>(MCP_REQUEST_EVENT, (e) => {
          const req = e.payload;
          void handleBridgeRequest(req).then((response) => invoke('mcp_respond', { requestId: req.requestId, response }));
        });
        const u2 = await listen<McpStatus>(MCP_STATUS_EVENT, (e) => update({ status: e.payload, statusError: null }));
        if (stopped) {
          u1();
          u2();
          return;
        }
        unlisten.push(u1, u2);
        update({ status: await invoke<McpStatus>('mcp_status'), statusError: null });
      } catch (e) {
        update({ statusError: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => {
      stopped = true;
      unlisten.forEach((u) => u());
    };
  }

  async function setEnabled(enabled: boolean) {
    if (host.kind !== 'tauri') {
      if (snapshot.status) update({ status: { ...snapshot.status, enabled, running: enabled } });
      return;
    }
    const { invoke } = await import('@tauri-apps/api/core');
    update({ status: await invoke<McpStatus>('mcp_set_enabled', { enabled }) });
  }

  async function regenerateToken(): Promise<string | null> {
    if (host.kind !== 'tauri') {
      if (!snapshot.status) return 'AI access runs in the desktop app.';
      update({ status: { ...snapshot.status, token: 'regenerated-test-token' } });
      return null;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      update({ status: await invoke<McpStatus>('mcp_regenerate_token') });
      return null;
    } catch (e) {
      return typeof e === 'string' ? e : e instanceof Error ? e.message : 'Could not regenerate the token.';
    }
  }

  return {
    listTools: () => tools.listTools(),
    callTool: callLogged,
    handleBridgeRequest,
    getSnapshot: () => snapshot,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start,
    setEnabled,
    regenerateToken,
  };
}
