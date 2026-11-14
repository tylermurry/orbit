import { INBOX_ID, type Task } from '../domain/types';
import { ValidationError, dueDateError, titleError } from '../domain/validation';
import { newId } from './ids';
import type { LocalStore } from './storage';

export interface TaskInput {
  title: string;
  notes?: string;
  dueDate?: string | null;
  listId?: string;
}

export type TaskPatch = Partial<TaskInput>;

export interface RepositoryClock {
  now: () => Date;
  newId?: (prefix: string) => string;
}

export class TaskRepository {
  private now: () => Date;
  private newId: (prefix: string) => string;

  constructor(
    private store: LocalStore,
    clock: RepositoryClock = { now: () => new Date() },
  ) {
    this.now = clock.now;
    this.newId = clock.newId ?? newId;
  }

  list(): Task[] {
    return this.store.load().tasks;
  }

  get(id: string): Task | undefined {
    return this.list().find((t) => t.id === id);
  }

  create(input: TaskInput): Task {
    const error = titleError(input.title);
    if (error) throw new ValidationError(error);
    const dueError = dueDateError(input.dueDate ?? null);
    if (dueError) throw new ValidationError(dueError);
    const data = this.store.load();
    const listId = input.listId ?? INBOX_ID;
    if (listId !== INBOX_ID && !data.lists.some((l) => l.id === listId)) {
      throw new ValidationError('That list no longer exists.');
    }
    const stamp = this.now().toISOString();
    const task: Task = {
      id: this.newId('task'),
      title: input.title.trim(),
      notes: input.notes ?? '',
      dueDate: input.dueDate ? input.dueDate : null,
      completed: false,
      listId,
      createdAt: stamp,
      updatedAt: stamp,
    };
    this.store.write({ ...data, tasks: [...data.tasks, task] });
    return task;
  }

  update(id: string, patch: TaskPatch): Task {
    const data = this.store.load();
    const existing = data.tasks.find((t) => t.id === id);
    if (!existing) throw new ValidationError('That task no longer exists.');
    if (patch.title !== undefined) {
      const error = titleError(patch.title);
      if (error) throw new ValidationError(error);
    }
    if (patch.dueDate !== undefined) {
      const error = dueDateError(patch.dueDate);
      if (error) throw new ValidationError(error);
    }
    if (patch.listId !== undefined && patch.listId !== INBOX_ID && !data.lists.some((l) => l.id === patch.listId)) {
      throw new ValidationError('That list no longer exists.');
    }
    const updated: Task = {
      ...existing,
      title: patch.title !== undefined ? patch.title.trim() : existing.title,
      notes: patch.notes ?? existing.notes,
      dueDate: patch.dueDate !== undefined ? patch.dueDate || null : existing.dueDate,
      listId: patch.listId ?? existing.listId,
      updatedAt: this.now().toISOString(),
    };
    this.store.write({ ...data, tasks: data.tasks.map((t) => (t.id === id ? updated : t)) });
    return updated;
  }

  setCompleted(id: string, completed: boolean): Task {
    const data = this.store.load();
    const existing = data.tasks.find((t) => t.id === id);
    if (!existing) throw new ValidationError('That task no longer exists.');
    const updated = { ...existing, completed, updatedAt: this.now().toISOString() };
    this.store.write({ ...data, tasks: data.tasks.map((t) => (t.id === id ? updated : t)) });
    return updated;
  }

  remove(id: string): void {
    const data = this.store.load();
    this.store.write({ ...data, tasks: data.tasks.filter((t) => t.id !== id) });
  }
}
