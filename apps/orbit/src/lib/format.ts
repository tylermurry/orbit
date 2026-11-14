export function shortSha(sha: string | undefined | null): string {
  return sha ? sha.slice(0, 7) : '';
}

export function fileName(path: string | null): string {
  if (!path) return '';
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diff = Math.round((now - t) / 1000);
  const abs = Math.abs(diff);
  const fut = diff < 0;
  const wrap = (n: number, unit: string) => {
    const s = `${n} ${unit}${n === 1 ? '' : 's'}`;
    return fut ? `in ${s}` : `${s} ago`;
  };
  if (abs < 45) return fut ? 'in a moment' : 'just now';
  if (abs < 3600) return wrap(Math.max(1, Math.round(abs / 60)), 'minute');
  if (abs < 86400) return wrap(Math.round(abs / 3600), 'hour');
  if (abs < 86400 * 30) return wrap(Math.round(abs / 86400), 'day');
  if (abs < 86400 * 365) return wrap(Math.round(abs / (86400 * 30)), 'month');
  return wrap(Math.round(abs / (86400 * 365)), 'year');
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** `datetime-local` value (local time, seconds precision) -> RFC3339 UTC with 'Z'. Returns null if invalid. */
export function localInputToRfc3339(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function rfc3339ToLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function slugify(s: string): string {
  return (
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'new'
  );
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? one + 's')}`;
}

export const FULL_SHA = /^[0-9a-f]{40}$/;

/** Word-level diff using LCS; tokens keep their trailing whitespace. */
export interface DiffPart {
  type: 'same' | 'add' | 'del';
  text: string;
}
export function wordDiff(a: string, b: string): DiffPart[] {
  const tok = (s: string) => s.match(/\s+|[^\s]+/g) ?? [];
  const x = tok(a);
  const y = tok(b);
  const n = x.length;
  const m = y.length;
  if (n * m > 250_000) return [{ type: 'del', text: a }, { type: 'add', text: b }];
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      push('same', x[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('del', x[i++]);
    } else {
      push('add', y[j++]);
    }
  }
  while (i < n) push('del', x[i++]);
  while (j < m) push('add', y[j++]);
  return out;
}
