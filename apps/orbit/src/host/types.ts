// The boundary between the Orbit UI and its host (Tauri Rust backend in production,
// an in-memory fake in browser-based E2E tests). All file and Git access goes through here.
// Git access is READ-ONLY, with one narrow exception: gitTagProposal creates/moves the lightweight
// tag `orbit/proposal/<branch>` so the product owner can always find the proposal commit.

export interface FileSnapshot {
  /** Absolute path as given/normalized by the host. */
  path: string;
  /** Raw UTF-8 text exactly as on disk (BOM stripped). */
  text: string;
  /** Lowercase hex SHA-256 of the raw bytes on disk — used for conflict detection. */
  sha256: string;
  modifiedMs: number;
}

export interface FileStat {
  path: string;
  exists: boolean;
  sha256?: string;
  modifiedMs?: number;
}

export type WriteResult =
  | { ok: true; sha256: string; modifiedMs: number }
  /** On-disk content no longer matches expectedSha256 (or file appeared/disappeared). Nothing was written. */
  | { ok: false; reason: 'conflict'; current: FileStat }
  | { ok: false; reason: 'error'; message: string };

export interface GitContext {
  /** false when git is unavailable or the file is not inside a repository. */
  available: boolean;
  /** Why unavailable, actionable: 'git-missing' | 'not-a-repo' | 'error'. */
  unavailableReason?: 'git-missing' | 'not-a-repo' | 'error';
  message?: string;
  repoRoot?: string;
  /** Path of the contract file relative to repoRoot, forward slashes. */
  relPath?: string;
  /** Full SHA of HEAD; undefined for a repo with no commits (unborn branch). */
  headCommit?: string;
  /** Current branch name, undefined when detached. */
  headBranch?: string;
  detached?: boolean;
  /** Whether relPath is tracked at HEAD. */
  trackedAtHead?: boolean;
  /** Working-tree file content differs from HEAD's blob (or untracked). */
  workingTreeDiffers?: boolean;
  shallow?: boolean;
}

export interface GitRef {
  /** Display name, e.g. 'main', 'HEAD', 'v1.0'. */
  name: string;
  kind: 'head' | 'branch' | 'tag';
  /** Full commit SHA the ref points at. */
  commit: string;
  /** Commit subject line. */
  subject: string;
  /** ISO commit date. */
  date: string;
}

export interface GitFileAtRevision {
  /** Resolved full commit SHA. */
  commit: string;
  /** false when the path does not exist at that commit. */
  exists: boolean;
  text?: string;
}

export interface RunOutcome {
  /** null when the process was killed (e.g. cancelled). */
  exitCode: number | null;
  cancelled: boolean;
  durationMs: number;
  /** Last part of the combined output. */
  output: string;
}

export interface OrbitHost {
  readonly kind: 'tauri' | 'memory';

  // ── dialogs ──
  /** Returns absolute path or null if cancelled. Filter *.json. */
  pickOpenFile(): Promise<string | null>;
  /** Returns absolute path or null if cancelled. defaultName e.g. 'product.orbit.json'. Native dialog handles overwrite confirmation. */
  pickSaveFile(defaultName: string): Promise<string | null>;

  // ── files ──
  readFile(path: string): Promise<FileSnapshot>;
  statFile(path: string): Promise<FileStat>;
  /**
   * Atomic write (temp file in same dir + rename). If expectedSha256 is a string, write only if the current
   * on-disk sha matches; if null, write only if the file does NOT exist; if undefined, write unconditionally (Save As after the
   * user confirmed overwrite in the native dialog).
   */
  writeFileAtomic(path: string, text: string, expectedSha256: string | null | undefined): Promise<WriteResult>;
  /** Initial file to open (CLI argument or ORBIT_FILE env var), if any. */
  initialFile(): Promise<string | null>;

  // ── external tools ──
  /** Open an existing file in the user's default editor (currently WebStorm). Rejects with an actionable message on failure. */
  openInEditor(path: string): Promise<void>;

  // ── validation ──
  /**
   * Run the contract's validation command in `cwd` (only ever on a person's explicit request), streaming output
   * to `onOutput`. Resolves when the command exits or is cancelled; rejects when it cannot start.
   */
  runCommand(cwd: string, command: string, runId: string, onOutput: (text: string) => void): Promise<RunOutcome>;
  /** Stop a run started by runCommand and everything it started. */
  cancelCommand(runId: string): Promise<boolean>;

  // ── git (read-only) ──
  gitContext(path: string): Promise<GitContext>;
  gitListRefs(repoRoot: string): Promise<GitRef[]>;
  /** rev: branch/tag name, 'HEAD', or (abbreviated) SHA. Throws Error with actionable message if rev can't be resolved. */
  gitReadFileAt(repoRoot: string, rev: string, relPath: string): Promise<GitFileAtRevision>;
  /** Best common ancestor of two revisions (`git merge-base`); null when they share no history. Throws if a rev can't be resolved. */
  gitMergeBase(repoRoot: string, a: string, b: string): Promise<string | null>;
  /**
   * The only git write: point the lightweight tag `orbit/proposal/<branch>` at HEAD. Refuses when the tag exists
   * unless `replace` is true. Returns the full tag name and commit.
   */
  gitTagProposal(repoRoot: string, branch: string, replace: boolean): Promise<{ tag: string; commit: string; replaced: boolean }>;
}

/** Tag that marks the proposal commit for a feature branch. */
export function proposalTag(branch: string): string {
  return `orbit/proposal/${branch}`;
}
