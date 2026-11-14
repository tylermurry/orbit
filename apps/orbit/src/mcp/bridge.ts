// Contract between the Rust MCP HTTP server (src-tauri/src/mcp.rs) and the UI-side tool runtime (src/mcp/*).
//
// Flow: AI client --HTTP JSON-RPC--> Rust (/mcp) --Tauri event 'mcp:request'--> UI runtime executes against the
// live document store --invoke('mcp_respond')--> Rust --HTTP response--> AI client.
//
// Rust handles the protocol itself: `initialize`, `notifications/*`, `ping`, auth (bearer token), Origin checks,
// protocol-version negotiation, batching rejection, and timeouts. Only `tools/list` and `tools/call` are forwarded.

/** Payload of the Tauri event 'mcp:request' emitted by Rust to the main window. */
export interface McpBridgeRequest {
  /** Opaque correlation id; pass back unchanged to mcp_respond. */
  requestId: string;
  method: 'tools/list' | 'tools/call';
  /** For tools/call: { name: string; arguments?: Record<string, unknown> }. For tools/list: {} (cursor ignored). */
  params: Record<string, unknown>;
}

/** Argument of invoke('mcp_respond', { requestId, response }). Exactly one of result / error. */
export type McpBridgeResponse =
  | { result: unknown }
  /** JSON-RPC error (protocol-level, e.g. unknown tool → -32602). Tool execution failures should instead be a
   *  normal result with `isError: true` per the MCP spec. */
  | { error: { code: number; message: string; data?: unknown } };

/** Result of invoke('mcp_status') and invoke('mcp_set_enabled', { enabled }). */
export interface McpStatus {
  enabled: boolean;
  running: boolean;
  /** e.g. "http://127.0.0.1:47821/mcp" when running. */
  url?: string;
  port?: number;
  /** Bearer token clients must send as `Authorization: Bearer <token>`. */
  token: string;
  /** Actionable error, e.g. port range busy. */
  error?: string;
}

/** Payload of the Tauri event 'mcp:status' (emitted when status changes, e.g. server started/stopped). */
export type McpStatusEvent = McpStatus;

export const MCP_REQUEST_EVENT = 'mcp:request';
export const MCP_STATUS_EVENT = 'mcp:status';
