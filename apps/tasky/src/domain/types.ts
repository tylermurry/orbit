/** Built-in list that always exists and is never stored in the list repository. */
export const INBOX_ID = 'inbox';
export const INBOX_NAME = 'Inbox';

export interface Task {
  id: string;
  title: string;
  notes: string;
  /** Local calendar date, YYYY-MM-DD, or null when there is no due date. */
  dueDate: string | null;
  completed: boolean;
  /** INBOX_ID or the id of a custom list. */
  listId: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskList {
  id: string;
  name: string;
  createdAt: string;
}

export interface AppData {
  version: 1;
  lists: TaskList[];
  tasks: Task[];
}

export type View =
  | { type: 'inbox' }
  | { type: 'today' }
  | { type: 'all' }
  | { type: 'list'; listId: string };
