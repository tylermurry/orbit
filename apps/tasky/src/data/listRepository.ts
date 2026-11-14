import { INBOX_ID, type TaskList } from '../domain/types';
import { ValidationError, listNameError } from '../domain/validation';
import { newId } from './ids';
import type { RepositoryClock } from './taskRepository';
import type { LocalStore } from './storage';

export class ListRepository {
  private now: () => Date;
  private newId: (prefix: string) => string;

  constructor(
    private store: LocalStore,
    clock: RepositoryClock = { now: () => new Date() },
  ) {
    this.now = clock.now;
    this.newId = clock.newId ?? newId;
  }

  list(): TaskList[] {
    return this.store.load().lists;
  }

  create(name: string): TaskList {
    const data = this.store.load();
    const error = listNameError(name, data.lists.map((l) => l.name));
    if (error) throw new ValidationError(error);
    const list: TaskList = { id: this.newId('list'), name: name.trim(), createdAt: this.now().toISOString() };
    this.store.write({ ...data, lists: [...data.lists, list] });
    return list;
  }

  rename(id: string, name: string): TaskList {
    if (id === INBOX_ID) throw new ValidationError('Inbox cannot be renamed.');
    const data = this.store.load();
    const existing = data.lists.find((l) => l.id === id);
    if (!existing) throw new ValidationError('That list no longer exists.');
    const error = listNameError(name, data.lists.filter((l) => l.id !== id).map((l) => l.name));
    if (error) throw new ValidationError(error);
    const updated = { ...existing, name: name.trim() };
    this.store.write({ ...data, lists: data.lists.map((l) => (l.id === id ? updated : l)) });
    return updated;
  }

  /** Deletes a custom list and moves its tasks to Inbox in one write. Returns how many tasks moved. */
  remove(id: string): { movedTaskCount: number } {
    if (id === INBOX_ID) throw new ValidationError('Inbox cannot be deleted.');
    const data = this.store.load();
    if (!data.lists.some((l) => l.id === id)) throw new ValidationError('That list no longer exists.');
    const stamp = this.now().toISOString();
    let movedTaskCount = 0;
    const tasks = data.tasks.map((t) => {
      if (t.listId !== id) return t;
      movedTaskCount += 1;
      return { ...t, listId: INBOX_ID, updatedAt: stamp };
    });
    this.store.write({ ...data, lists: data.lists.filter((l) => l.id !== id), tasks });
    return { movedTaskCount };
  }
}
