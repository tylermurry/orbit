// Per-viewer conveniences stored in localStorage. Every access is guarded: storage may be blocked.

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

const RECENT_KEY = 'orbit.recent';

export function loadRecent(): string[] {
  const v = loadPref<unknown>(RECENT_KEY, []);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function pushRecent(path: string): string[] {
  const next = [path, ...loadRecent().filter((p) => p !== path)].slice(0, 8);
  savePref(RECENT_KEY, next);
  return next;
}

export function removeRecent(path: string): string[] {
  const next = loadRecent().filter((p) => p !== path);
  savePref(RECENT_KEY, next);
  return next;
}

export const filePrefKey = (path: string, name: string) => `orbit.file.${path}.${name}`;
