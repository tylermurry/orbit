import { createEmptyContract, diffContracts, parseContract, serializeContract } from '@orbit/contract';
import type { OrbitContract } from '@orbit/contract';
import { fileName, slugify } from '../../lib/format';
import { isDirty } from '../../state/store';
import { currentDiagnostics, describeDiff, diagCounts, historyState, slimDiagnostic, st } from './helpers';
import { S } from './schema';
import { ToolError } from './types';
import type { ToolContext, ToolDef, ToolOutput } from './types';

const ann = (readOnly: boolean, destructive: boolean, idempotent: boolean) => ({ readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: false as const });

function requireFile(ctx: ToolContext) {
  const s = st(ctx);
  if (!s.filePath) throw new ToolError('No contract file is open.', { suggestions: ['Call open_file with an absolute path, or create_contract.'] });
  return s;
}

function dirtyGuard(ctx: ToolContext, discard: unknown, what: string) {
  if (isDirty(st(ctx)) && discard !== true) {
    throw new ToolError(`There are unsaved changes in the open file; ${what} would discard them. Nothing was changed.`, {
      suggestions: ['Call save_file first to keep them (or save_file_as to keep both versions),', 'or pass discardUnsavedChanges: true if discarding them is really intended (they could otherwise be recovered only with undo before reloading).'],
      data: { dirty: true },
    });
  }
}

function openedSummary(ctx: ToolContext): Record<string, unknown> {
  const s = st(ctx);
  const d = currentDiagnostics(s);
  return {
    path: s.filePath,
    product: s.contract ? { id: s.contract.product.id, name: s.contract.product.name } : null,
    loadedInvalid: s.loadedInvalid,
    readOnly: s.loadedInvalid || !s.contract,
    ...diagCounts(d.diagnostics),
    diagnostics: s.loadedInvalid || !s.contract ? d.diagnostics.slice(0, 20).map(slimDiagnostic) : undefined,
    git: s.git?.available ? { branch: s.git.headBranch ?? null, headCommit: s.git.headCommit ?? null } : { available: false },
    note: s.loadedInvalid ? 'The file has validation errors and is read-only. Inspect with get_diagnostics and repair with set_raw_json (apply: true).' : undefined,
  };
}

export function fileTools(): ToolDef[] {
  const tools: ToolDef[] = [];

  tools.push({
    kind: 'file',
    tool: {
      name: 'open_file',
      title: 'Open a contract file',
      description:
        "Open an existing Orbit contract by absolute path, replacing the currently open document. Refuses when there are unsaved changes unless discardUnsavedChanges: true. A file with validation errors opens read-only (repair with set_raw_json); invalid JSON opens in Raw JSON.",
      inputSchema: S.obj({ path: S.nonEmpty('Absolute path to the contract file, e.g. /work/app/orbit.json.'), discardUnsavedChanges: S.bool('Required (true) when the open document has unsaved changes.') }, ['path']),
      annotations: ann(false, true, true),
    },
    async run(a, ctx) {
      const path = a.path as string;
      dirtyGuard(ctx, a.discardUnsavedChanges, 'opening another file');
      const stat = await ctx.host.statFile(path).catch((e: Error) => {
        throw new ToolError(`Cannot access '${path}': ${e.message}`);
      });
      if (!stat.exists) throw new ToolError(`File not found: ${path}`, { suggestions: ['Check the absolute path; list_recent_files shows recently opened files.', 'Use create_contract to create a new file.'] });
      const ok = await ctx.ctrl.openPath(path);
      if (!ok || st(ctx).filePath !== path) throw new ToolError(`Could not open '${path}'. It may be unreadable or not a text file.`);
      return { data: { opened: true, ...openedSummary(ctx) }, toast: `Opened ${fileName(path)}` };
    },
  });

  tools.push({
    kind: 'file',
    tool: {
      name: 'create_contract',
      title: 'Create a new contract file',
      description: 'Create a new, valid, empty contract at an absolute path (the file must not exist yet) and open it. product.id defaults to a slug of the name. Refuses when there are unsaved changes unless discardUnsavedChanges: true.',
      inputSchema: S.obj(
        {
          path: S.nonEmpty('Absolute path for the new file. Use orbit.json by default, e.g. /work/app/orbit.json.'),
          product: S.obj({ id: S.nonEmpty('Stable product id (default: slug of name).'), name: S.nonEmpty('Product name.'), summary: S.nonEmpty('One-line summary.') }, ['name', 'summary']),
          discardUnsavedChanges: S.bool('Required (true) when the open document has unsaved changes.'),
        },
        ['path', 'product'],
      ),
      annotations: ann(false, true, false),
    },
    async run(a, ctx) {
      dirtyGuard(ctx, a.discardUnsavedChanges, 'creating a new contract');
      const path = a.path as string;
      const p = a.product as { id?: string; name: string; summary: string };
      const contract: OrbitContract = createEmptyContract({ id: (p.id ?? slugify(p.name)).trim(), name: p.name.trim(), summary: p.summary.trim() });
      const res = await ctx.host.writeFileAtomic(path, serializeContract(contract), null);
      if (!res.ok) {
        throw new ToolError(res.reason === 'conflict' ? `A file already exists at ${path}; refusing to overwrite it.` : `Could not create the file: ${res.message}`, {
          suggestions: res.reason === 'conflict' ? ['Choose a different path, or open the existing file with open_file.'] : [],
        });
      }
      if (!(await ctx.ctrl.openPath(path))) throw new ToolError(`The file was created at ${path} but could not be opened.`);
      return { data: { created: true, ...openedSummary(ctx) }, toast: `Created contract '${contract.product.name}'` };
    },
  });

  const saveFailure = (r: Extract<Awaited<ReturnType<ToolContext['ctrl']['saveHeadless']>>, { ok: false }>): never => {
    const suggestions: string[] = [];
    if (r.reason === 'conflict') suggestions.push('review_external_changes: see exactly how the disk version differs from your working version.', 'reload_from_disk (discardUnsavedChanges: true): take the disk version and drop the working edits.', 'save_file_as: write the working version to a new path and keep both.');
    if (r.reason === 'validation') suggestions.push('get_diagnostics: see the errors.', 'Pass saveDespiteErrors: true to write the text exactly as it is (like "Save anyway" in the UI).');
    if (r.reason === 'raw-draft') suggestions.push('get_raw_json shows the draft; set_raw_json with apply: true applies it.');
    if (r.reason === 'exists') suggestions.push('Pass overwrite: true to replace the existing file, or choose another path.');
    throw new ToolError(r.message, { suggestions, data: { reason: r.reason, ...(r.current ? { onDisk: r.current } : {}), ...(r.diagnostics ? { diagnostics: r.diagnostics.slice(0, 20).map(slimDiagnostic) } : {}) } });
  };

  tools.push({
    kind: 'file',
    tool: {
      name: 'save_file',
      title: 'Save to disk',
      description:
        "Write the working contract to its file (canonical formatting, atomic write). NEVER overwrites external changes: if the file changed on disk since it was opened, returns an error describing the conflict (resolve with review_external_changes, reload_from_disk or save_file_as). Refuses to write when there are validation errors unless saveDespiteErrors: true (writes the exact text, like 'Save anyway'). Does nothing when there are no changes. This is the only tool that makes AI edits permanent.",
      inputSchema: S.obj({ saveDespiteErrors: S.bool('Write even though validation errors exist.') }),
      annotations: ann(false, true, true),
    },
    async run(a, ctx): Promise<ToolOutput> {
      requireFile(ctx);
      const r = await ctx.ctrl.saveHeadless({ anyway: a.saveDespiteErrors === true });
      if (!r.ok) return saveFailure(r);
      if (!r.changed) return { data: { saved: false, note: 'Nothing to save: the file on disk already matches the working contract.', path: r.path, state: historyState(st(ctx)) } };
      return { data: { saved: true, path: r.path, bytes: r.bytes, state: historyState(st(ctx)) }, toast: `Saved ${fileName(r.path)}` };
    },
  });

  tools.push({
    kind: 'file',
    tool: {
      name: 'save_file_as',
      title: 'Save to a new path',
      description: 'Write the working contract to a new absolute path and switch the open document to it. Refuses to replace an existing file unless overwrite: true. Same validation rules as save_file.',
      inputSchema: S.obj({ path: S.nonEmpty('Absolute destination path.'), overwrite: S.bool('Replace an existing file at that path.'), saveDespiteErrors: S.bool('Write even though validation errors exist.') }, ['path']),
      annotations: ann(false, true, true),
    },
    async run(a, ctx): Promise<ToolOutput> {
      requireFile(ctx);
      const r = await ctx.ctrl.saveAsHeadless(a.path as string, { overwrite: a.overwrite === true, anyway: a.saveDespiteErrors === true });
      if (!r.ok) return saveFailure(r);
      return { data: { saved: true, path: r.path, bytes: r.bytes, state: historyState(st(ctx)) }, toast: `Saved as ${fileName(r.path)}` };
    },
  });

  tools.push({
    kind: 'file',
    tool: {
      name: 'reload_from_disk',
      title: 'Reload from disk',
      description: 'Discard the in-memory state and re-read the file from disk (also clears an external-change conflict and the undo history). When there are unsaved changes you must pass discardUnsavedChanges: true.',
      inputSchema: S.obj({ discardUnsavedChanges: S.bool('Must be true when the document is dirty.') }),
      annotations: ann(false, true, true),
    },
    async run(a, ctx) {
      const s = requireFile(ctx);
      dirtyGuard(ctx, a.discardUnsavedChanges, 'reloading from disk');
      const stat = await ctx.host.statFile(s.filePath!);
      if (!stat.exists) throw new ToolError(`The file no longer exists on disk: ${s.filePath}`, { suggestions: ['save_file_as writes the working version to a path of your choice.'] });
      const before = s.contract;
      const ok = await ctx.ctrl.openPath(s.filePath!, { keepContext: true, quiet: true });
      if (!ok) throw new ToolError('The file could not be re-read.');
      const d = describeDiff(before, st(ctx).contract);
      return { data: { reloaded: true, changesFromPreviousWorkingVersion: d.changes, ...openedSummary(ctx) }, toast: 'Reloaded from disk' };
    },
  });

  tools.push({
    kind: 'read',
    tool: {
      name: 'review_external_changes',
      title: 'Review disk vs working differences',
      description:
        "Semantic diff of the version currently on disk (base) against the working version in the app (target) - exactly what the app's 'Review differences' shows. Use it when save_file reports a conflict or get_status shows externalChange. Lists changed items with field-level before/after. showInApp: true also opens the review sheet for the user.",
      inputSchema: S.obj({ showInApp: S.bool('Also open the review sheet in the UI.') }),
      annotations: ann(true, false, true),
    },
    async run(a, ctx) {
      const s = requireFile(ctx);
      let disk;
      try {
        disk = await ctx.host.readFile(s.filePath!);
      } catch (e) {
        throw new ToolError(`The file could not be read from disk (${(e as Error).message}); it may have been deleted.`, { suggestions: ['save_file_as writes the working version somewhere else.'] });
      }
      const parsed = parseContract(disk.text);
      if (!parsed.ok || !parsed.contract) throw new ToolError('The version on disk is not a valid contract, so a semantic comparison is not possible.', { suggestions: ['save_file_as keeps your working version at a new path.'], data: { diagnostics: parsed.diagnostics.slice(0, 10).map(slimDiagnostic) } });
      if (!s.contract || s.loadedInvalid) throw new ToolError('The working version is not a valid contract, so a semantic comparison is not possible.');
      const diff = diffContracts(parsed.contract, s.contract);
      if (a.showInApp === true) ctx.store.dispatch({ type: 'review', review: { title: 'Disk version → your version', diff } });
      return {
        data: {
          direction: 'disk (base) → working (target)',
          diskChangedSinceOpen: disk.sha256 !== s.diskSha,
          externalChange: s.externalChange?.kind ?? null,
          identical: diff.changes.length === 0,
          totals: diff.totals,
          changes: diff.changes.map((c) => ({ key: c.key, category: c.category, kind: c.kind, label: c.label, group: c.group, fields: c.fields.map((f) => ({ field: f.field, before: f.before, after: f.after })) })),
        },
      };
    },
  });

  tools.push({
    kind: 'read',
    tool: {
      name: 'list_recent_files',
      title: 'List recent files',
      description: 'Recently opened contract files (most recent first), usable with open_file.',
      inputSchema: S.obj({}),
      annotations: ann(true, false, true),
    },
    run(_a, ctx) {
      const s = st(ctx);
      return { data: { current: s.filePath, recent: s.recent } };
    },
  });

  return tools;
}
