import { INBOX_ID, type AppData, type Task } from '../domain/types';
import { addDays, localDateString } from '../logic/localDate';

/**
 * Demo-only sample data. Due dates are computed relative to `now` so the demo always shows
 * overdue, today and future tasks. Only ever written when the user explicitly asks for it.
 */
export function buildDemoSeed(now: Date): AppData {
  const today = localDateString(now);
  const base = now.getTime();
  const lists = [
    { id: 'demo-list-personal', name: 'Personal', createdAt: new Date(base - 9000).toISOString() },
    { id: 'demo-list-work', name: 'Work', createdAt: new Date(base - 8000).toISOString() },
    { id: 'demo-list-errands', name: 'Errands', createdAt: new Date(base - 7000).toISOString() },
  ];
  let n = 0;
  const task = (
    title: string,
    listId: string,
    dueOffset: number | null,
    completed = false,
    notes = '',
  ): Task => {
    n += 1;
    const stamp = new Date(base - 6000 + n * 100).toISOString();
    return {
      id: `demo-task-${n}`,
      title,
      notes,
      dueDate: dueOffset === null ? null : addDays(today, dueOffset),
      completed,
      listId,
      createdAt: stamp,
      updatedAt: stamp,
    };
  };
  const tasks: Task[] = [
    task('Pay the electric bill', INBOX_ID, 0, false, 'Account number is on the paper statement.'),
    task('Book an appointment at the embassy', INBOX_ID, -3),
    task('Call Mark about the fishing trip', INBOX_ID, null),
    task('Order tissues', INBOX_ID, -1, true),
    task('Plan weekend hike', 'demo-list-personal', 4),
    task('Renew library card', 'demo-list-personal', -2),
    task('Write thank-you notes', 'demo-list-personal', null, true),
    task('Send project update', 'demo-list-work', 0, false, 'Summarize progress and next steps.'),
    task('Review pull requests', 'demo-list-work', 1),
    task('Prepare quarterly report', 'demo-list-work', 10),
    task('Archive old files', 'demo-list-work', null, true),
    task('Buy milk', 'demo-list-errands', 0),
    task('Pick up dry cleaning', 'demo-list-errands', -1),
    task('Return library books', 'demo-list-errands', 2),
  ];
  return { version: 1, lists, tasks };
}
