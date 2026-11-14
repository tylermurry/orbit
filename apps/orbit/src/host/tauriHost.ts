// OrbitHost implementation backed by the Tauri Rust backend (apps/orbit/src-tauri).
import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  FileSnapshot,
  FileStat,
  GitContext,
  GitFileAtRevision,
  GitRef,
  OrbitHost,
  RunOutcome,
  WriteResult,
} from './types';

/** True when running inside the Tauri webview (false in a plain browser). */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const JSON_FILTERS = [{ name: 'JSON', extensions: ['json'] }];

/**
 * Wire encoding of the write precondition (see src-tauri/src/files.rs):
 * undefined -> any, null -> absent (file must not exist), string -> sha256 must match.
 */
type WireExpected = { kind: 'any' } | { kind: 'absent' } | { kind: 'sha256'; value: string };

function encodeExpected(expected: string | null | undefined): WireExpected {
  if (expected === undefined) return { kind: 'any' };
  if (expected === null) return { kind: 'absent' };
  return { kind: 'sha256', value: expected };
}

function toError(e: unknown): Error {
  return e instanceof Error ? e : new Error(typeof e === 'string' ? e : JSON.stringify(e));
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toError(e);
  }
}

export function createTauriHost(): OrbitHost {
  return {
    kind: 'tauri',

    async pickOpenFile() {
      const result = await open({ multiple: false, directory: false, filters: JSON_FILTERS });
      return typeof result === 'string' ? result : null;
    },

    async pickSaveFile(defaultName) {
      const result = await save({ defaultPath: defaultName, filters: JSON_FILTERS });
      return typeof result === 'string' ? result : null;
    },

    readFile: (path) => call<FileSnapshot>('read_file', { path }),
    statFile: (path) => call<FileStat>('stat_file', { path }),

    async writeFileAtomic(path, text, expectedSha256) {
      try {
        return await invoke<WriteResult>('write_file_atomic', {
          path,
          text,
          expected: encodeExpected(expectedSha256),
        });
      } catch (e) {
        return { ok: false, reason: 'error', message: toError(e).message };
      }
    },

    initialFile: () => call<string | null>('initial_file'),

    openInEditor: (path) => call<void>('open_in_editor', { path }),

    gitContext: (path) => call<GitContext>('git_context', { path }),
    gitListRefs: (repoRoot) => call<GitRef[]>('git_list_refs', { repoRoot }),
    gitReadFileAt: (repoRoot, rev, relPath) =>
      call<GitFileAtRevision>('git_read_file_at', { repoRoot, rev, relPath }),
    async runCommand(cwd, command, runId, onOutput) {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<{ runId: string; text: string }>('run:output', (e) => {
        if (e.payload.runId === runId) onOutput(e.payload.text);
      });
      try {
        return await call<RunOutcome>('run_command', { cwd, command, runId });
      } finally {
        unlisten();
      }
    },
    cancelCommand: (runId) => call<boolean>('cancel_command', { runId }),

    gitMergeBase: (repoRoot, a, b) => call<string | null>('git_merge_base', { repoRoot, a, b }),
    gitTagProposal: (repoRoot, branch, replace) =>
      call<{ tag: string; commit: string; replaced: boolean }>('git_tag_proposal', { repoRoot, branch, replace }),
  };
}
