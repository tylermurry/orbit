import { ancestorsOf, parseContract, validateContract } from '@orbit/contract';
import type { Diagnostic, OrbitContract } from '@orbit/contract';
import { canon, currentText } from '../../state/store';
import { currentDiagnostics, describeDiff, diagCounts, historyState, requireContract, requireEditable, same, slimDiagnostic, st } from './helpers';
import { OPS, OPS_BY_NAME } from './ops';
import type { OpEnv, OpResult } from './ops';
import { S, validateArgs } from './schema';
import { ToolError } from './types';
import type { ToolContext, ToolDef, ToolOutput } from './types';

const errKey = (d: Diagnostic) => `${d.code}|${d.message}`;

function opEnv(ctx: ToolContext): OpEnv {
  const git = st(ctx).git;
  return { headCommit: git?.available ? git.headCommit : undefined, now: () => ctx.now() };
}

interface Spec {
  op: string;
  args: Record<string, unknown>;
}

/**
 * Apply one or more operations to the working contract as ONE undoable edit.
 * Rejects (changing nothing) when the result would introduce semantic/schema errors that the contract did not already have.
 */
export function runEdit(ctx: ToolContext, specs: Spec[], opts: { dryRun?: boolean; batch?: boolean } = {}): ToolOutput {
  const before = requireEditable(ctx);
  const env = opEnv(ctx);
  let c: OrbitContract = before;
  const done: { op: string; summary: string; result: Record<string, unknown> }[] = [];
  const warnings: string[] = [];
  const reveal = new Set<string>();

  specs.forEach((spec, i) => {
    const def = OPS_BY_NAME.get(spec.op)!;
    let r: OpResult;
    try {
      r = def.run(c, spec.args, env);
    } catch (e) {
      if (opts.batch && e instanceof ToolError) {
        throw new ToolError(`Operation ${i + 1} of ${specs.length} (${spec.op}) failed, so NOTHING was applied: ${e.message}`, { suggestions: e.suggestions, data: { ...e.data, failedOperationIndex: i, failedOperation: spec.op } });
      }
      throw e;
    }
    c = r.contract;
    done.push({ op: spec.op, summary: r.summary, result: r.result ?? {} });
    warnings.push(...(r.warnings ?? []));
    r.reveal?.forEach((id) => reveal.add(id));
  });

  const changed = !same(before, c);
  if (changed) {
    const existing = new Set(validateContract(before).filter((d) => d.severity === 'error').map(errKey));
    const added = validateContract(c).filter((d) => d.severity === 'error' && !existing.has(errKey(d)));
    if (added.length) {
      throw new ToolError(
        `Edit rejected: it would introduce ${added.length} validation error${added.length === 1 ? '' : 's'}. Nothing was changed.\n${added.slice(0, 5).map((d) => `- ${d.message}`).join('\n')}`,
        { suggestions: ['Fix the arguments so every reference resolves (ids exist, same-kind parents, non-blank text), then retry.'], data: { wouldBeDiagnostics: added.map(slimDiagnostic) } },
      );
    }
  }

  const summary = done.length === 1 ? done[0].summary : `Applied ${done.length} edits: ${done.map((d) => d.summary).join('; ')}`;
  const single = done.length === 1 && !opts.batch;
  const payload: Record<string, unknown> = single ? { ...done[0].result } : { results: done };
  if (opts.dryRun) {
    return { data: { dryRun: true, wouldChange: changed, summary, ...payload, warnings } };
  }
  if (changed) {
    ctx.store.dispatch({ type: 'edit', fn: () => c });
    if (reveal.size) {
      const expanded = { ...st(ctx).expanded };
      for (const id of reveal) {
        expanded[id] = true;
        for (const a of ancestorsOf(c, id)) expanded[a.id] = true;
      }
      ctx.ctrl.setExpanded(expanded);
    }
  }
  const state = st(ctx);
  return {
    data: { changed, summary, ...payload, warnings, ...(changed ? {} : { note: 'The contract already had exactly this content; nothing was changed.' }), state: historyState(state) },
    toast: changed ? (done.length === 1 ? summary : `Applied ${done.length} edits (${done.map((d) => d.summary).join('; ')})`) : undefined,
  };
}

const dryRunProp = S.bool('When true, validate and describe the result without changing anything.');

export function editTools(): ToolDef[] {
  const tools: ToolDef[] = OPS.map((def) => ({
    kind: 'edit' as const,
    tool: {
      name: def.name,
      title: def.title,
      description: `${def.description} Edits are in-memory and undoable (undo) until save_file; rejected if they would introduce validation errors.`,
      inputSchema: { ...def.schema, properties: { ...(def.schema.properties as object), dryRun: dryRunProp } },
      annotations: { readOnlyHint: false, destructiveHint: def.destructive, idempotentHint: def.idempotent, openWorldHint: false as const },
    },
    run(args, ctx) {
      const { dryRun, ...rest } = args;
      return runEdit(ctx, [{ op: def.name, args: rest }], { dryRun: dryRun === true });
    },
  }));

  const opNames = OPS.map((o) => o.name);
  tools.push({
    kind: 'edit',
    tool: {
      name: 'apply_edits',
      title: 'Apply several edits atomically',
      description:
        "Apply an ordered list of edit operations as ONE atomic, single-undo-step change: either all succeed or nothing changes. Each operation is { tool, args } where tool is one of the write tools (" +
        opNames.join(', ') +
        ") and args are exactly that tool's arguments. Operations see the results of earlier ones, so create a test then map it, or create an entity then add behaviors to it - but to reference something created earlier in the batch, pass an explicit id (auto-generated ids are only known after the call). Validation runs once on the final result. Prefer this for any multi-step change.",
      inputSchema: S.obj(
        {
          operations: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            description: 'Operations applied in order.',
            items: S.obj({ tool: S.oneOf(opNames, 'Write tool name.'), args: { type: 'object', description: "That tool's arguments (without dryRun)." } }, ['tool', 'args']),
          },
          dryRun: dryRunProp,
        },
        ['operations'],
      ),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    run(args, ctx) {
      const ops = args.operations as { tool: string; args: Record<string, unknown> }[];
      const specs: Spec[] = ops.map((o, i) => {
        const def = OPS_BY_NAME.get(o.tool)!;
        const { dryRun: _ignored, ...rest } = o.args;
        const problems = validateArgs(def.schema, rest, `operations[${i}].args`);
        if (problems.length) throw new ToolError(`Operation ${i + 1} (${o.tool}) has invalid arguments, so NOTHING was applied:\n${problems.map((p) => `- ${p}`).join('\n')}`, { data: { failedOperationIndex: i } });
        return { op: o.tool, args: rest };
      });
      return runEdit(ctx, specs, { dryRun: args.dryRun === true, batch: true });
    },
  });

  // ── undo / redo ──
  for (const dir of ['undo', 'redo'] as const) {
    tools.push({
      kind: 'edit',
      tool: {
        name: dir,
        title: dir === 'undo' ? 'Undo last edit' : 'Redo last undone edit',
        description:
          dir === 'undo'
            ? 'Undo the most recent edit in the app (the undo stack is shared with the human user, so this can undo their last edit too). Returns what changed. Check get_status.history first.'
            : 'Redo the most recently undone edit (the stack is cleared by any new edit).',
        inputSchema: S.obj({}),
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      run(_args, ctx) {
        const s = st(ctx);
        const c0 = requireContract(ctx);
        if (s.loadedInvalid) throw new ToolError('The open file is read-only (validation errors); there is no edit history.', { suggestions: ['Repair it with set_raw_json first.'] });
        const stack = dir === 'undo' ? s.undo : s.redo;
        if (!stack.length) throw new ToolError(`Nothing to ${dir}.`, { suggestions: [dir === 'undo' ? 'No edits have been made since the file was opened or last saved/reloaded.' : 'Redo is only available right after an undo.'] });
        ctx.store.dispatch({ type: dir });
        const c1 = st(ctx).contract;
        const d = describeDiff(c0, c1);
        const summary = `${dir === 'undo' ? 'Undid' : 'Redid'} last edit (${d.changes} change${d.changes === 1 ? '' : 's'})`;
        return { data: { summary, changes: d.labels, state: historyState(st(ctx)) }, toast: summary };
      },
    });
  }

  // ── raw JSON ──
  tools.push({
    kind: 'read',
    tool: {
      name: 'get_raw_json',
      title: 'Get raw JSON text',
      description:
        "Return the text the Raw JSON editor shows: the user's unapplied draft if there is one (hasUnappliedDraft), otherwise the canonical working contract (or the exact on-disk text for a file that failed validation, which is read-only until repaired).",
      inputSchema: S.obj({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    run(_args, ctx) {
      const s = st(ctx);
      if (!s.filePath) throw new ToolError('No contract file is open.', { suggestions: ['Call open_file first.'] });
      const d = currentDiagnostics(s);
      return { data: { source: d.source, hasUnappliedDraft: d.source === 'raw-draft', loadedInvalid: s.loadedInvalid, text: d.text || currentText(s), ...diagCounts(d.diagnostics) } };
    },
  });

  tools.push({
    kind: 'edit',
    tool: {
      name: 'set_raw_json',
      title: 'Validate or apply raw JSON',
      description:
        "Mirror of the Raw JSON editor. The text must be the COMPLETE contract. apply: false only validates (returns diagnostics, changes nothing). apply: true parses and, only if valid, replaces the working contract as one undoable edit (also how to repair a file that opened read-only/invalid). Malformed or invalid text is NEVER applied: you get diagnostics with line/column and the working contract is untouched. For targeted changes prefer the structured tools or apply_edits.",
      inputSchema: S.obj({ text: S.str('Complete contract JSON text.', { minLength: 1 }), apply: S.bool('true = apply when valid; false = validate only.') }, ['text', 'apply']),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    },
    run(args, ctx) {
      const s = st(ctx);
      if (!s.filePath) throw new ToolError('No contract file is open.', { suggestions: ['Call open_file or create_contract first.'] });
      const text = args.text as string;
      const parse = parseContract(text);
      const seen = new Set<string>();
      const diagnostics = parse.diagnostics.filter((d) => {
        const k = `${d.code}|${d.message}|${d.line}|${d.column}|${d.path}`;
        return seen.has(k) ? false : (seen.add(k), true);
      });
      const counts = diagCounts(diagnostics);
      if (!parse.ok || !parse.contract) {
        throw new ToolError(`The text is not a valid contract (${counts.errors} error${counts.errors === 1 ? '' : 's'}); the working contract was not touched.`, {
          suggestions: ['Fix the listed diagnostics (line/column given) and resend the complete text.'],
          data: { applied: false, valid: false, diagnostics: diagnostics.map(slimDiagnostic) },
        });
      }
      if (args.apply !== true) return { data: { applied: false, valid: true, ...counts, diagnostics: diagnostics.map(slimDiagnostic) } };
      const warnings: string[] = [];
      if (s.rawDraft !== null && s.rawDraft !== currentText(s) && s.rawDraft !== text) warnings.push("The user's unapplied Raw JSON draft was replaced.");
      const noop = !s.loadedInvalid && s.contract && canon(s.contract) === canon(parse.contract);
      if (noop) {
        if (s.rawDraft !== null) ctx.store.dispatch({ type: 'setRawDraft', text: null });
        return { data: { applied: false, valid: true, changed: false, note: 'The text is identical to the working contract; nothing changed.', ...counts, warnings } };
      }
      const before = s.loadedInvalid ? null : s.contract;
      ctx.store.dispatch({ type: 'applyRaw', parse });
      const d = describeDiff(before, parse.contract);
      const summary = s.loadedInvalid ? 'Applied raw JSON repair' : `Applied raw JSON (${d.changes} change${d.changes === 1 ? '' : 's'})`;
      return { data: { applied: true, valid: true, changed: true, summary, changes: d.labels, ...counts, diagnostics: diagnostics.map(slimDiagnostic), warnings, state: historyState(st(ctx)) }, toast: summary };
    },
  });

  return tools;
}
