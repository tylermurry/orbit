// The AI tool runtime: a registry of MCP tools that operate on the live document store, exactly like the UI does.
import type { OrbitHost } from '../host/types';
import type { Controller } from '../state/controller';
import type { Store } from '../state/store';
import { editTools } from './tools/edit';
import { fileTools } from './tools/files';
import { navTools } from './tools/nav';
import { planTools } from './tools/plan';
import { readTools } from './tools/read';
import { validateArgs } from './tools/schema';
import { ToolError, UnknownToolError } from './tools/types';
import type { CallToolResult, Tool, ToolContext, ToolDef, ToolExecution, ToolOutput, ToolRuntime } from './tools/types';

export type { CallToolResult, Tool, ToolExecution, ToolRuntime } from './tools/types';
export { ToolError, UnknownToolError } from './tools/types';

const text = (payload: Record<string, unknown>): string => JSON.stringify(payload, null, 2);

function success(payload: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: text(payload) }], structuredContent: payload };
}

function failure(message: string, extra: { suggestions?: string[]; data?: Record<string, unknown> } = {}): CallToolResult {
  const payload: Record<string, unknown> = { error: message, ...(extra.suggestions?.length ? { suggestions: extra.suggestions } : {}), ...(extra.data ?? {}) };
  return { content: [{ type: 'text', text: text(payload) }], structuredContent: payload, isError: true };
}

export function buildRegistry(): ToolDef[] {
  return [...readTools(), ...fileTools(), ...editTools(), ...planTools(), ...navTools()];
}

export interface ToolRuntimeOptions {
  store: Store;
  ctrl: Controller;
  host: OrbitHost;
  /** Test hook: clock used for default timestamps. */
  now?: () => Date;
}

export function createToolRuntime({ store, ctrl, host, now = () => new Date() }: ToolRuntimeOptions): ToolRuntime {
  const registry = buildRegistry();
  const byName = new Map(registry.map((d) => [d.tool.name, d]));
  const ctx: ToolContext = { store, ctrl, host, now };
  const tools: Tool[] = registry.map((d) => d.tool);

  async function executeNow(name: string, rawArgs: unknown): Promise<ToolExecution> {
    const def = byName.get(name);
    if (!def) throw new UnknownToolError(name, [...byName.keys()]);
    const base = { tool: name, kind: def.kind };
    const args = rawArgs === undefined || rawArgs === null ? {} : rawArgs;
    const problems = validateArgs(def.tool.inputSchema, args);
    if (problems.length) {
      const msg = `Invalid arguments for ${name}:\n${problems.map((p) => `- ${p}`).join('\n')}`;
      return { ...base, result: failure(msg, { suggestions: ['Check the tool inputSchema from tools/list and retry.'] }), ok: false, mutated: false, summary: problems[0] };
    }
    try {
      const out: ToolOutput = await def.run(args as Record<string, unknown>, ctx);
      if (out.toast) ctrl.toast(`AI · ${out.toast}`, 'success');
      const mutated = (def.kind === 'edit' || def.kind === 'file') && !!out.toast;
      return { ...base, result: success(out.data), ok: true, mutated, summary: out.toast ?? '' };
    } catch (e) {
      if (e instanceof ToolError) {
        return { ...base, result: failure(e.message, { suggestions: e.suggestions, data: e.data }), ok: false, mutated: false, summary: e.message.split('\n')[0] };
      }
      const msg = e instanceof Error ? e.message : String(e);
      return { ...base, result: failure(`Unexpected error in ${name}: ${msg}`), ok: false, mutated: false, summary: msg };
    }
  }

  // Serialize every call so concurrent AI requests never interleave edits.
  let tail: Promise<unknown> = Promise.resolve();
  function execute(name: string, args?: unknown): Promise<ToolExecution> {
    const run = tail.then(() => executeNow(name, args));
    tail = run.catch(() => undefined);
    return run;
  }

  return {
    listTools: () => tools,
    execute,
    async callTool(name, args) {
      return (await execute(name, args)).result;
    },
  };
}
