import { ListRepository } from '../../src/data/listRepository';
import { LocalStore } from '../../src/data/storage';
import { TaskRepository } from '../../src/data/taskRepository';
import type { Task } from '../../src/domain/types';

/** Minimal in-memory Storage so repositories can be tested without a browser. */
export class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  keys() {
    return [...this.map.keys()];
  }
}

export function makeRepos(storage = new MemoryStorage()) {
  let tick = 0;
  let idCounter = 0;
  const clock = {
    now: () => new Date(Date.UTC(2026, 5, 15, 12, 0, tick++)),
    newId: (prefix: string) => `${prefix}-${++idCounter}`,
  };
  const store = new LocalStore(storage);
  return { storage, store, tasks: new TaskRepository(store, clock), lists: new ListRepository(store, clock) };
}

export function task(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: overrides.id,
    notes: '',
    dueDate: null,
    completed: false,
    listId: 'inbox',
    createdAt: '2026-06-15T12:00:00.000Z',
    updatedAt: '2026-06-15T12:00:00.000Z',
    ...overrides,
  };
}
