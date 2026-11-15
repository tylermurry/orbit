import type { FileSnapshot, FileStat, GitContext, GitFileAtRevision, GitRef, OrbitHost, RunOutcome, WriteResult } from './types';

/** Seed describing a fake git repository (read-only from Orbit's perspective). */
export interface MemoryGitSeed {
  repoRoot: string;
  /** Full 40-hex sha -> commit. `files` is keyed by repo-relative path. */
  /** `parents` (optional) enables merge-base; a commit without parents is a root. */
  commits: Record<string, { subject: string; date: string; files: Record<string, string>; parents?: string[] }>;
  refs: { name: string; kind: 'branch' | 'tag'; commit: string }[];
  head: { branch?: string; commit?: string };
  shallow?: boolean;
}

/** What a fake validation command does: its output and exit code, the files it writes, and how long it takes. */
export interface MemoryCommand {
  exitCode: number;
  output?: string;
  /** Absolute path -> text, written when the command finishes. */
  writes?: Record<string, string>;
  delayMs?: number;
}

export interface MemorySeed {
  /** Absolute path -> text (the "working tree" / plain filesystem). */
  files: Record<string, string>;
  initialFile?: string | null;
  /** Queue of paths returned by successive pickOpenFile calls (null = cancelled). */
  openPicks?: (string | null)[];
  savePicks?: (string | null)[];
  git?: MemoryGitSeed | null;
  /** When git is absent, which reason to report. */
  gitUnavailable?: 'git-missing' | 'not-a-repo';
  /** Fake validation commands by exact command text; any other command fails to start. */
  commands?: Record<string, MemoryCommand>;
  /** Poll interval override for external-change detection (tests). */
  pollMs?: number;
}

export interface OrbitTestApi {
  /** Simulate another program changing a file on disk. */
  externalWrite(path: string, text: string): Promise<void>;
  externalDelete(path: string): void;
  getFile(path: string): string | undefined;
  fileList(): string[];
  /** Every successful writeFileAtomic call, in order. */
  writes: { path: string; text: string }[];
  /** Every path passed to openInEditor, in order. */
  openedInEditor: string[];
  /** Every command run, with its folder, in order. */
  ranCommands: { cwd: string; command: string }[];
  queueOpenPick(path: string | null): void;
  queueSavePick(path: string | null): void;
  setGit(git: MemoryGitSeed | null): void;
  addCommit(sha: string, commit: { subject: string; date: string; files: Record<string, string>; parents?: string[] }, branch?: string): void;
}

declare global {
  interface Window {
    __ORBIT_TEST_HOST__?: MemorySeed;
    __orbitMemoryHost?: OrbitTestApi;
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface MemoryHost extends OrbitHost, OrbitTestApi {
  readonly kind: 'memory';
  readonly pollMs: number;
}

export function createMemoryHost(seed: MemorySeed): MemoryHost {
  const files = new Map<string, { text: string; modifiedMs: number }>();
  let clock = 1_700_000_000_000;
  const touch = (path: string, text: string) => files.set(path, { text, modifiedMs: (clock += 1000) });
  for (const [p, t] of Object.entries(seed.files)) touch(p, t);
  let git: MemoryGitSeed | null = seed.git ? structuredClone(seed.git) : null;
  const openPicks = [...(seed.openPicks ?? [])];
  const savePicks = [...(seed.savePicks ?? [])];
  const writes: { path: string; text: string }[] = [];
  const openedInEditor: string[] = [];
  const ranCommands: { cwd: string; command: string }[] = [];
  const cancels = new Map<string, () => void>();

  const headCommit = () => git?.head.commit ?? (git?.head.branch ? git.refs.find((r) => r.name === git!.head.branch)?.commit : undefined);

  function underRepo(path: string): string | null {
    if (!git) return null;
    const root = git.repoRoot.endsWith('/') ? git.repoRoot : git.repoRoot + '/';
    return path.startsWith(root) ? path.slice(root.length) : null;
  }

  function resolveRev(rev: string): string {
    if (!git) throw new Error('Not a git repository.');
    if (rev === 'HEAD') {
      const h = headCommit();
      if (!h) throw new Error("HEAD has no commits yet. Commit the file first, or choose another revision.");
      return h;
    }
    const ref = git.refs.find((r) => r.name === rev);
    if (ref) return ref.commit;
    if (/^[0-9a-f]{4,40}$/i.test(rev)) {
      const lower = rev.toLowerCase();
      const matches = Object.keys(git.commits).filter((s) => s.startsWith(lower));
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new Error(`Revision '${rev}' is ambiguous. Use more characters of the commit SHA.`);
    }
    throw new Error(`Cannot resolve revision '${rev}'. Check the spelling, or pick a branch, tag or commit from the list.`);
  }

  const api: MemoryHost = {
    kind: 'memory',
    pollMs: seed.pollMs ?? 2000,
    writes,
    openedInEditor,
    ranCommands,

    async pickOpenFile() {
      return openPicks.length ? (openPicks.shift() ?? null) : null;
    },
    async pickSaveFile() {
      return savePicks.length ? (savePicks.shift() ?? null) : null;
    },
    async readFile(path): Promise<FileSnapshot> {
      const f = files.get(path);
      if (!f) throw new Error(`File not found: ${path}`);
      return { path, text: f.text, sha256: await sha256Hex(f.text), modifiedMs: f.modifiedMs };
    },
    async statFile(path): Promise<FileStat> {
      const f = files.get(path);
      if (!f) return { path, exists: false };
      return { path, exists: true, sha256: await sha256Hex(f.text), modifiedMs: f.modifiedMs };
    },
    async listXmlFiles(dir): Promise<string[]> {
      const prefix = `${dir.replace(/\/+$/, '')}/`;
      return [...files.keys()].filter((p) => p.startsWith(prefix) && p.toLowerCase().endsWith('.xml')).sort();
    },
    async writeFileAtomic(path, text, expected): Promise<WriteResult> {
      const cur = await api.statFile(path);
      if (expected === null && cur.exists) return { ok: false, reason: 'conflict', current: cur };
      if (typeof expected === 'string' && (!cur.exists || cur.sha256 !== expected)) return { ok: false, reason: 'conflict', current: cur };
      touch(path, text);
      writes.push({ path, text });
      const st = await api.statFile(path);
      return { ok: true, sha256: st.sha256!, modifiedMs: st.modifiedMs! };
    },
    async openInEditor(path) {
      openedInEditor.push(path);
    },
    async initialFile() {
      return seed.initialFile ?? null;
    },

    async gitContext(path): Promise<GitContext> {
      const rel = underRepo(path);
      if (!git || rel === null) {
        const reason = seed.gitUnavailable ?? 'not-a-repo';
        return {
          available: false,
          unavailableReason: reason,
          message: reason === 'git-missing' ? 'The git executable was not found on this computer.' : 'This file is not inside a Git repository.',
        };
      }
      const head = headCommit();
      const atHead = head ? git.commits[head]?.files[rel] : undefined;
      const wt = files.get(path)?.text;
      return {
        available: true,
        repoRoot: git.repoRoot,
        relPath: rel,
        headCommit: head,
        headBranch: git.head.branch,
        detached: !git.head.branch,
        trackedAtHead: atHead !== undefined,
        workingTreeDiffers: atHead === undefined ? true : wt !== atHead,
        shallow: git.shallow,
        implementationDirty: atHead !== wt,
      };
    },
    async gitListRefs(): Promise<GitRef[]> {
      if (!git) return [];
      const out: GitRef[] = [];
      const h = headCommit();
      if (h) out.push({ name: 'HEAD', kind: 'head', commit: h, subject: git.commits[h]?.subject ?? '', date: git.commits[h]?.date ?? '' });
      for (const r of git.refs) {
        out.push({ name: r.name, kind: r.kind, commit: r.commit, subject: git.commits[r.commit]?.subject ?? '', date: git.commits[r.commit]?.date ?? '' });
      }
      return out;
    },
    async gitReadFileAt(_root, rev, relPath): Promise<GitFileAtRevision> {
      const sha = resolveRev(rev);
      const text = git!.commits[sha]?.files[relPath];
      return text === undefined ? { commit: sha, exists: false } : { commit: sha, exists: true, text };
    },

    async runCommand(cwd, command, runId, onOutput): Promise<RunOutcome> {
      const c = seed.commands?.[command];
      if (!c) throw new Error(`Could not start the test command: '${command}' was not found.`);
      ranCommands.push({ cwd, command });
      const started = Date.now();
      const cancelled = await new Promise<boolean>((resolve) => {
        const t = setTimeout(() => {
          cancels.delete(runId);
          resolve(false);
        }, c.delayMs ?? 0);
        cancels.set(runId, () => {
          clearTimeout(t);
          resolve(true);
        });
      });
      if (cancelled) return { exitCode: null, cancelled: true, durationMs: Date.now() - started, output: '' };
      if (c.output) onOutput(c.output);
      for (const [p, text] of Object.entries(c.writes ?? {})) touch(p, text);
      return { exitCode: c.exitCode, cancelled: false, durationMs: Date.now() - started, output: c.output ?? '' };
    },
    async cancelCommand(runId) {
      const f = cancels.get(runId);
      cancels.delete(runId);
      f?.();
      return !!f;
    },
    async gitMergeBase(_root, a, b) {
      const ca = resolveRev(a);
      const cb = resolveRev(b);
      const ancestors = new Set<string>();
      const walk = [ca];
      while (walk.length) {
        const c = walk.shift()!;
        if (ancestors.has(c)) continue;
        ancestors.add(c);
        walk.push(...(git!.commits[c]?.parents ?? []));
      }
      const seen = new Set<string>();
      const q = [cb];
      while (q.length) {
        const c = q.shift()!;
        if (seen.has(c)) continue;
        seen.add(c);
        if (ancestors.has(c)) return c;
        q.push(...(git!.commits[c]?.parents ?? []));
      }
      return null;
    },
    // ── test helpers ──
    async externalWrite(path, text) {
      touch(path, text);
    },
    externalDelete(path) {
      files.delete(path);
    },
    getFile(path) {
      return files.get(path)?.text;
    },
    fileList() {
      return [...files.keys()];
    },
    queueOpenPick(p) {
      openPicks.push(p);
    },
    queueSavePick(p) {
      savePicks.push(p);
    },
    setGit(g) {
      git = g ? structuredClone(g) : null;
    },
    addCommit(sha, commit, branch) {
      if (!git) return;
      git.commits[sha] = commit;
      const b = branch ?? git.head.branch;
      if (b) {
        const ref = git.refs.find((r) => r.name === b);
        if (ref) ref.commit = sha;
        else git.refs.push({ name: b, kind: 'branch', commit: sha });
        if (b === git.head.branch) git.head.commit = undefined;
      }
    },
  };
  return api;
}
