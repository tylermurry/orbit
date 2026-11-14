import { describe, expect, it } from 'vitest';
import { buildDemoSeed } from '../../src/data/demoSeed';
import { BACKUP_KEY_PREFIX, CorruptDataError, STORAGE_KEY } from '../../src/data/storage';
import { ValidationError } from '../../src/domain/validation';
import { filterTasks } from '../../src/logic/filtering';
import { localDateString } from '../../src/logic/localDate';
import { MemoryStorage, makeRepos } from './helpers';

describe('task repository', () => {
  it('creates tasks in Inbox by default and in a chosen list [test.tasky.task-repository.create]', () => {
    const { tasks, lists } = makeRepos();
    const work = lists.create('Work');
    const inbox = tasks.create({ title: '  Buy milk  ' });
    const inWork = tasks.create({ title: 'Ship it', listId: work.id, dueDate: '2026-06-20', notes: 'soon' });
    expect(inbox).toMatchObject({ title: 'Buy milk', listId: 'inbox', completed: false, dueDate: null, notes: '' });
    expect(inWork).toMatchObject({ listId: work.id, dueDate: '2026-06-20', notes: 'soon' });
    expect(tasks.list().map((t) => t.id)).toEqual([inbox.id, inWork.id]);
  });

  it('rejects empty titles, bad dates and unknown lists without writing [test.tasky.task-repository.validation]', () => {
    const { tasks, storage } = makeRepos();
    expect(() => tasks.create({ title: '' })).toThrow(ValidationError);
    expect(() => tasks.create({ title: '   \t ' })).toThrow(/title/i);
    expect(() => tasks.create({ title: 'x', dueDate: '2026-02-30' })).toThrow(ValidationError);
    expect(() => tasks.create({ title: 'x', listId: 'nope' })).toThrow(ValidationError);
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    const t = tasks.create({ title: 'ok' });
    expect(() => tasks.update(t.id, { title: '  ' })).toThrow(ValidationError);
    expect(tasks.get(t.id)?.title).toBe('ok');
  });

  it('updates, completes and deletes tasks, touching updatedAt [test.tasky.task-repository.update-complete-delete]', () => {
    const { tasks, lists } = makeRepos();
    const work = lists.create('Work');
    const t = tasks.create({ title: 'Draft' });
    const edited = tasks.update(t.id, { title: 'Draft v2', notes: 'n', dueDate: '2026-07-01', listId: work.id });
    expect(edited).toMatchObject({ title: 'Draft v2', notes: 'n', dueDate: '2026-07-01', listId: work.id, createdAt: t.createdAt });
    expect(edited.updatedAt > t.updatedAt).toBe(true);
    expect(tasks.update(t.id, { dueDate: null }).dueDate).toBeNull();
    expect(tasks.setCompleted(t.id, true).completed).toBe(true);
    expect(tasks.setCompleted(t.id, false).completed).toBe(false);
    tasks.remove(t.id);
    expect(tasks.list()).toEqual([]);
  });

  it('persists across repository instances on the same storage [test.tasky.task-repository.persist]', () => {
    const first = makeRepos();
    const list = first.lists.create('Errands');
    const t = first.tasks.create({ title: 'Stamps', listId: list.id });
    const second = makeRepos(first.storage);
    expect(second.lists.list()).toEqual([list]);
    expect(second.tasks.list()).toEqual([t]);
    expect(JSON.parse(first.storage.getItem(STORAGE_KEY) as string).version).toBe(1);
  });
});

describe('list repository', () => {
  it('creates and renames lists with validation [test.tasky.list-repository.create-rename]', () => {
    const { lists } = makeRepos();
    const a = lists.create('Personal');
    lists.create('Work');
    expect(() => lists.create('  ')).toThrow(ValidationError);
    expect(() => lists.create('personal')).toThrow(/already exists/);
    expect(() => lists.create('Inbox')).toThrow(/already exists/);
    expect(lists.rename(a.id, 'Home').name).toBe('Home');
    expect(() => lists.rename(a.id, 'Work')).toThrow(ValidationError);
    expect(lists.rename(a.id, 'Home').id).toBe(a.id);
  });

  it('never renames or deletes Inbox [test.tasky.list-repository.inbox-protected]', () => {
    const { lists } = makeRepos();
    expect(() => lists.rename('inbox', 'Mine')).toThrow(/Inbox/);
    expect(() => lists.remove('inbox')).toThrow(/Inbox/);
  });

  it('moves tasks to Inbox, not deletes them, when a list is deleted [test.tasky.list-repository.delete-moves-tasks]', () => {
    const { lists, tasks } = makeRepos();
    const work = lists.create('Work');
    const home = lists.create('Home');
    const a = tasks.create({ title: 'A', listId: work.id });
    const b = tasks.create({ title: 'B', listId: work.id });
    const c = tasks.create({ title: 'C', listId: home.id });
    expect(lists.remove(work.id)).toEqual({ movedTaskCount: 2 });
    expect(lists.list().map((l) => l.id)).toEqual([home.id]);
    const after = tasks.list();
    expect(after.map((t) => t.id).sort()).toEqual([a.id, b.id, c.id].sort());
    expect(after.find((t) => t.id === a.id)?.listId).toBe('inbox');
    expect(after.find((t) => t.id === b.id)?.listId).toBe('inbox');
    expect(after.find((t) => t.id === c.id)?.listId).toBe(home.id);
  });
});

describe('stored data safety', () => {
  const corruptSamples: Record<string, string> = {
    'invalid json': '{not json',
    'wrong version': JSON.stringify({ version: 2, lists: [], tasks: [] }),
    'bad task': JSON.stringify({ version: 1, lists: [], tasks: [{ id: 'x', title: '' }] }),
    'dangling list': JSON.stringify({
      version: 1,
      lists: [],
      tasks: [
        {
          id: 't',
          title: 'T',
          notes: '',
          dueDate: null,
          completed: false,
          listId: 'ghost',
          createdAt: '2026-06-15T12:00:00.000Z',
          updatedAt: '2026-06-15T12:00:00.000Z',
        },
      ],
    }),
  };

  it('reports corrupt data without modifying it and refuses to mutate it [test.tasky.storage.corrupt-data]', () => {
    for (const [name, raw] of Object.entries(corruptSamples)) {
      const { storage, store, tasks, lists } = makeRepos();
      storage.setItem(STORAGE_KEY, raw);
      const result = store.read();
      expect(result.status, name).toBe('corrupt');
      expect(() => tasks.create({ title: 'new' }), name).toThrow(CorruptDataError);
      expect(() => lists.create('New'), name).toThrow(CorruptDataError);
      expect(storage.getItem(STORAGE_KEY), name).toBe(raw);
      expect(storage.keys(), name).toEqual([STORAGE_KEY]);
    }
  });

  it('start fresh keeps a backup copy under another key and clears the main key [test.tasky.storage.start-fresh-backup]', () => {
    const { storage, store } = makeRepos();
    storage.setItem(STORAGE_KEY, '{broken');
    const backupKey = store.startFresh(new Date(Date.UTC(2026, 5, 15, 12)));
    expect(backupKey).toBe(`${BACKUP_KEY_PREFIX}2026-06-15T12:00:00.000Z`);
    expect(storage.getItem(backupKey as string)).toBe('{broken');
    expect(store.read()).toEqual({ status: 'empty' });
  });

  it('treats empty storage as empty, not corrupt', () => {
    expect(makeRepos().store.read()).toEqual({ status: 'empty' });
  });
});

describe('demo seed', () => {
  it('has at least 3 lists and 10 tasks covering every date state [test.tasky.demo.seed-coverage]', () => {
    const now = new Date(2026, 5, 15, 10, 0);
    const seed = buildDemoSeed(now);
    const today = localDateString(now);
    expect(seed.lists.length).toBeGreaterThanOrEqual(3);
    expect(seed.tasks.length).toBeGreaterThanOrEqual(10);
    expect(seed.tasks.some((t) => t.completed)).toBe(true);
    expect(seed.tasks.some((t) => !t.completed)).toBe(true);
    expect(seed.tasks.some((t) => t.dueDate === today)).toBe(true);
    expect(seed.tasks.some((t) => t.dueDate !== null && t.dueDate < today && !t.completed)).toBe(true);
    expect(seed.tasks.some((t) => t.dueDate !== null && t.dueDate > today)).toBe(true);
    expect(seed.tasks.some((t) => t.dueDate === null)).toBe(true);
    // round-trips through the strict validator
    const storage = new MemoryStorage();
    const { store } = makeRepos(storage);
    store.write(seed);
    expect(store.read().status).toBe('ok');
    expect(filterTasks(seed.tasks, { type: 'today' }, { today, showCompleted: false }).length).toBeGreaterThan(0);
  });
});
