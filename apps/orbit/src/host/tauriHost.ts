// OrbitHost implementation backed by the Tauri Rust backend (apps/orbit/src-tauri).
import { Channel, invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';
import type {
  FileSnapshot,
  FileStat,
  GitContext,
  GitFileAtRevision,
  GitRef,
  OrbitHost,
  RunOutcome,
  SkillStatus,
  TerminalSession,
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
    async readPlaywrightBlob(path) {
      const bytes = await call<ArrayBuffer | number[]>('read_playwright_blob', { path });
      return Array.isArray(bytes) ? Uint8Array.from(bytes).buffer : bytes;
    },
    listPlaywrightBlobs: (dir) => call('list_playwright_blobs', { dir }),
    async readWalkthroughImage(manifest, image) {
      const bytes = await call<ArrayBuffer | number[]>('read_walkthrough_image', { manifest, image });
      return Array.isArray(bytes) ? Uint8Array.from(bytes).buffer : bytes;
    },
    statFile: (path) => call<FileStat>('stat_file', { path }),
    listXmlFiles: (dir) => call<string[]>('list_xml_files', { dir }),

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

    skillsStatus: (contract) => call<SkillStatus>('skills_status', { contract }),
    installSkills: (contract, checked, replaceCustom) => call<SkillStatus>('install_skills', { contract, checked, replaceCustom }),

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

    async openTerminal({ cwd, cols, rows, onData, onExit, command }): Promise<TerminalSession> {
      const data = new Channel<ArrayBuffer>();
      data.onmessage = (buf) => onData(new Uint8Array(buf));
      const exit = new Channel<number | null>();
      exit.onmessage = (code) => onExit(code);
      const id = await (command === undefined
        ? call<number>('term_open', { cwd, cols, rows, onData: data, onExit: exit })
        : call<number>('term_run', { cwd, command, cols, rows, onData: data, onExit: exit }));
      const quiet = (p: Promise<unknown>) => void p.catch(() => {});
      return {
        write: (text) => quiet(invoke('term_write', { id, data: text })),
        resize: (c, r) => quiet(invoke('term_resize', { id, cols: c, rows: r })),
        close: () => quiet(invoke('term_close', { id })),
      };
    },

    gitMergeBase: (repoRoot, a, b) => call<string | null>('git_merge_base', { repoRoot, a, b }),
  };
}
