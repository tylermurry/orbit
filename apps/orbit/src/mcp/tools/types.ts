import type { Controller } from '../../state/controller';
import type { Store } from '../../state/store';
import type { OrbitHost } from '../../host/types';

export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: false;
}

/** An MCP Tool object as returned by `tools/list`. */
export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  annotations: ToolAnnotations;
}

/** An MCP CallToolResult. */
export interface CallToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
}

/**
 * read: pure inspection. nav: moves the human's view / comparison (no document change).
 * edit: changes the in-memory contract (undoable). file: touches the file on disk or swaps the open document.
 */
export type ToolKind = 'read' | 'nav' | 'edit' | 'file';

export interface ToolContext {
  store: Store;
  ctrl: Controller;
  host: OrbitHost;
  now(): Date;
}

export interface ToolOutput {
  data: Record<string, unknown>;
  /** Shown to the human as "AI · <toast>". Only set when something visibly changed. */
  toast?: string;
}

export interface ToolDef {
  tool: Tool;
  kind: ToolKind;
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput> | ToolOutput;
}

/** An actionable tool failure: becomes `{ isError: true }` with the message and suggestions. */
export class ToolError extends Error {
  suggestions: string[];
  data: Record<string, unknown>;
  constructor(message: string, opts: { suggestions?: string[]; data?: Record<string, unknown> } = {}) {
    super(message);
    this.name = 'ToolError';
    this.suggestions = opts.suggestions ?? [];
    this.data = opts.data ?? {};
  }
}

/** Protocol-level failure (maps to JSON-RPC -32602). */
export class UnknownToolError extends Error {
  readonly code = -32602;
  constructor(name: string, known: string[]) {
    super(`Unknown tool '${name}'. Available tools: ${known.join(', ')}.`);
    this.name = 'UnknownToolError';
  }
}

export interface ToolExecution {
  result: CallToolResult;
  tool: string;
  kind: ToolKind;
  ok: boolean;
  /** true when the document or file on disk changed. */
  mutated: boolean;
  summary: string;
}

export interface ToolRuntime {
  listTools(): Tool[];
  callTool(name: string, args?: unknown): Promise<CallToolResult>;
  /** Like callTool, with metadata for the activity log. Serialized with every other call. */
  execute(name: string, args?: unknown): Promise<ToolExecution>;
}
