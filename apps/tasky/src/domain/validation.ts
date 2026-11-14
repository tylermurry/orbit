import { INBOX_ID, INBOX_NAME, type AppData, type Task, type TaskList } from './types';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export const MAX_TITLE_LENGTH = 200;
export const MAX_LIST_NAME_LENGTH = 60;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d;
}

/** Returns an error message, or null when the title is acceptable. */
export function titleError(title: string): string | null {
  if (title.trim() === '') return 'Enter a title for the task.';
  if (title.trim().length > MAX_TITLE_LENGTH) return `Keep the title under ${MAX_TITLE_LENGTH} characters.`;
  return null;
}

export function dueDateError(value: string | null): string | null {
  if (value === null || value === '') return null;
  return isValidDateString(value) ? null : 'Enter a valid due date.';
}

/** Returns an error message, or null when the list name is acceptable. */
export function listNameError(name: string, otherNames: string[]): string | null {
  const trimmed = name.trim();
  if (trimmed === '') return 'Enter a name for the list.';
  if (trimmed.length > MAX_LIST_NAME_LENGTH) return `Keep the name under ${MAX_LIST_NAME_LENGTH} characters.`;
  const lower = trimmed.toLowerCase();
  if (lower === INBOX_NAME.toLowerCase() || otherNames.some((n) => n.trim().toLowerCase() === lower)) {
    return 'A list with that name already exists.';
  }
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isTimestamp = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));

export function parseTask(value: unknown): Task | null {
  if (!isObject(value)) return null;
  const { id, title, notes, dueDate, completed, listId, createdAt, updatedAt } = value;
  if (typeof id !== 'string' || id === '') return null;
  if (typeof title !== 'string' || title.trim() === '') return null;
  if (typeof notes !== 'string') return null;
  if (dueDate !== null && !isValidDateString(dueDate)) return null;
  if (typeof completed !== 'boolean') return null;
  if (typeof listId !== 'string' || listId === '') return null;
  if (!isTimestamp(createdAt) || !isTimestamp(updatedAt)) return null;
  return { id, title, notes, dueDate: dueDate as string | null, completed, listId, createdAt, updatedAt };
}

export function parseList(value: unknown): TaskList | null {
  if (!isObject(value)) return null;
  const { id, name, createdAt } = value;
  if (typeof id !== 'string' || id === '' || id === INBOX_ID) return null;
  if (typeof name !== 'string' || name.trim() === '') return null;
  if (!isTimestamp(createdAt)) return null;
  return { id, name, createdAt };
}

export type ParseResult = { ok: true; data: AppData } | { ok: false; reason: string };

/** Strictly validates a stored document. Any invalid record makes the whole document invalid. */
export function parseAppData(value: unknown): ParseResult {
  if (!isObject(value)) return { ok: false, reason: 'The stored data is not an object.' };
  if (value.version !== 1) return { ok: false, reason: `Unsupported data version: ${JSON.stringify(value.version)}.` };
  if (!Array.isArray(value.lists) || !Array.isArray(value.tasks)) {
    return { ok: false, reason: 'The stored data is missing its lists or tasks.' };
  }
  const lists: TaskList[] = [];
  for (const [i, raw] of value.lists.entries()) {
    const list = parseList(raw);
    if (!list) return { ok: false, reason: `List #${i + 1} is invalid.` };
    lists.push(list);
  }
  const tasks: Task[] = [];
  for (const [i, raw] of value.tasks.entries()) {
    const task = parseTask(raw);
    if (!task) return { ok: false, reason: `Task #${i + 1} is invalid.` };
    tasks.push(task);
  }
  const listIds = new Set(lists.map((l) => l.id));
  if (listIds.size !== lists.length) return { ok: false, reason: 'Two lists share the same id.' };
  if (new Set(tasks.map((t) => t.id)).size !== tasks.length) return { ok: false, reason: 'Two tasks share the same id.' };
  for (const t of tasks) {
    if (t.listId !== INBOX_ID && !listIds.has(t.listId)) {
      return { ok: false, reason: `Task "${t.title}" belongs to a list that does not exist.` };
    }
  }
  return { ok: true, data: { version: 1, lists, tasks } };
}
