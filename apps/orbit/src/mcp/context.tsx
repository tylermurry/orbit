import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { ACTIVE_WINDOW_MS, mcpUiState } from './runtime';
import type { McpRuntime, McpSnapshot, McpUiState } from './runtime';

const McpContext = createContext<McpRuntime | null>(null);

export function McpProvider({ runtime, children }: { runtime: McpRuntime; children: ReactNode }) {
  return <McpContext.Provider value={runtime}>{children}</McpContext.Provider>;
}

export interface UseMcp extends McpSnapshot {
  state: McpUiState;
  runtime: McpRuntime;
}

/** Live MCP status, activity log and controls for the UI. Re-renders when the "Active" window lapses. */
export function useMcp(): UseMcp {
  const runtime = useContext(McpContext);
  if (!runtime) throw new Error('McpProvider missing');
  const snap = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot);
  const [, tick] = useState(0);
  useEffect(() => {
    if (snap.lastRequestAt === null) return;
    const left = snap.lastRequestAt + ACTIVE_WINDOW_MS - Date.now();
    if (left <= 0) return;
    const t = setTimeout(() => tick((n) => n + 1), left + 50);
    return () => clearTimeout(t);
  }, [snap.lastRequestAt]);
  return { ...snap, state: mcpUiState(snap, Date.now()), runtime };
}
