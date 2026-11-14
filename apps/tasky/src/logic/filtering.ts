import { INBOX_ID, type Task, type View } from '../domain/types';
import { isDueTodayOrOverdue } from './localDate';

/**
 * Ordering: incomplete first, then due date ascending (missing last), then createdAt, then id.
 * The id tie-break makes the order fully deterministic.
 */
export function compareTasks(a: Task, b: Task): number {
  if (a.completed !== b.completed) return a.completed ? 1 : -1;
  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    return a.dueDate < b.dueDate ? -1 : 1;
  }
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortTasks(tasks: readonly Task[]): Task[] {
  return [...tasks].sort(compareTasks);
}

export interface FilterOptions {
  /** Local calendar date, YYYY-MM-DD. */
  today: string;
  showCompleted: boolean;
}

function inView(task: Task, view: View, today: string): boolean {
  switch (view.type) {
    case 'inbox':
      return task.listId === INBOX_ID;
    case 'list':
      return task.listId === view.listId;
    case 'today':
      return isDueTodayOrOverdue(task.dueDate, today);
    case 'all':
      return true;
  }
}

/**
 * Tasks to display for a view, ordered. All Tasks always includes completed tasks (after incomplete ones);
 * every other view hides completed tasks unless `showCompleted` is set.
 */
export function filterTasks(tasks: readonly Task[], view: View, { today, showCompleted }: FilterOptions): Task[] {
  const includeCompleted = view.type === 'all' || showCompleted;
  return sortTasks(tasks.filter((t) => inView(t, view, today) && (includeCompleted || !t.completed)));
}

/** Number of incomplete tasks in a view, shown as the sidebar count. */
export function countIncomplete(tasks: readonly Task[], view: View, today: string): number {
  return tasks.filter((t) => !t.completed && inView(t, view, today)).length;
}
