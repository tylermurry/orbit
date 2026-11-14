import { parseAppData } from '../domain/validation';
import type { AppData } from '../domain/types';

export const STORAGE_KEY = 'tasky:v1';
export const BACKUP_KEY_PREFIX = 'tasky:v1:backup:';

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: AppData }
  | { status: 'corrupt'; raw: string | null; reason: string };

export class CorruptDataError extends Error {
  constructor(public reason: string) {
    super(`Stored Tasky data cannot be read: ${reason}`);
    this.name = 'CorruptDataError';
  }
}

export const emptyData = (): AppData => ({ version: 1, lists: [], tasks: [] });

/**
 * Shared helper over a Storage that holds the whole Tasky document under one versioned key.
 * Both repositories use it so list deletion can move tasks in a single write.
 * Reading never writes: corrupt data is reported, never replaced, until startFresh() is called.
 */
export class LocalStore {
  constructor(
    private storage: Storage,
    readonly key: string = STORAGE_KEY,
  ) {}

  read(): LoadResult {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (e) {
      return { status: 'corrupt', raw: null, reason: `Browser storage is unavailable (${String(e)}).` };
    }
    if (raw === null) return { status: 'empty' };
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: 'corrupt', raw, reason: 'The stored data is not valid JSON.' };
    }
    const result = parseAppData(parsed);
    return result.ok ? { status: 'ok', data: result.data } : { status: 'corrupt', raw, reason: result.reason };
  }

  /** Current data for mutation; empty storage yields an empty document, corrupt storage throws. */
  load(): AppData {
    const result = this.read();
    if (result.status === 'corrupt') throw new CorruptDataError(result.reason);
    return result.status === 'ok' ? result.data : emptyData();
  }

  write(data: AppData): void {
    this.storage.setItem(this.key, JSON.stringify(data));
  }

  rawText(): string | null {
    try {
      return this.storage.getItem(this.key);
    } catch {
      return null;
    }
  }

  /** Copies the current raw text to a backup key, then clears the main key. Returns the backup key. */
  startFresh(now: Date = new Date()): string | null {
    const raw = this.rawText();
    let backupKey: string | null = null;
    if (raw !== null) {
      backupKey = `${BACKUP_KEY_PREFIX}${now.toISOString()}`;
      this.storage.setItem(backupKey, raw);
    }
    this.storage.removeItem(this.key);
    return backupKey;
  }
}
