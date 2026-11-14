import { describe, expect, it } from 'vitest';
import { countIncomplete, filterTasks, sortTasks } from '../../src/logic/filtering';
import { task } from './helpers';

const TODAY = '2026-06-15';

describe('task ordering', () => {
  it('orders incomplete first, then due date ascending with missing last, then createdAt, then id [test.tasky.filtering.ordering]', () => {
    const tasks = [
      task({ id: 'e', completed: true, dueDate: '2026-06-01' }),
      task({ id: 'd', dueDate: null, createdAt: '2026-06-15T12:00:05.000Z' }),
      task({ id: 'c', dueDate: '2026-06-20' }),
      task({ id: 'b2', dueDate: '2026-06-10', createdAt: '2026-06-15T12:00:00.000Z' }),
      task({ id: 'b1', dueDate: '2026-06-10', createdAt: '2026-06-15T12:00:00.000Z' }),
      task({ id: 'a', dueDate: '2026-06-10', createdAt: '2026-06-14T12:00:00.000Z' }),
      task({ id: 'f', dueDate: null, createdAt: '2026-06-15T12:00:01.000Z' }),
    ];
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['a', 'b1', 'b2', 'c', 'f', 'd', 'e']);
    // sorting does not mutate its input and is order independent
    expect(sortTasks([...tasks].reverse()).map((t) => t.id)).toEqual(['a', 'b1', 'b2', 'c', 'f', 'd', 'e']);
  });
});

describe('view filtering', () => {
  const tasks = [
    task({ id: 'inbox-open' }),
    task({ id: 'inbox-done', completed: true }),
    task({ id: 'work-overdue', listId: 'work', dueDate: '2026-06-10' }),
    task({ id: 'work-today', listId: 'work', dueDate: TODAY }),
    task({ id: 'work-future', listId: 'work', dueDate: '2026-06-16' }),
    task({ id: 'work-today-done', listId: 'work', dueDate: TODAY, completed: true }),
  ];

  it('Today includes incomplete tasks due today or earlier from every list [test.tasky.filtering.today-view]', () => {
    const ids = filterTasks(tasks, { type: 'today' }, { today: TODAY, showCompleted: false }).map((t) => t.id);
    expect(ids).toEqual(['work-overdue', 'work-today']);
  });

  it('shows completed tasks in Today only when requested [test.tasky.filtering.completed-toggle]', () => {
    const ids = filterTasks(tasks, { type: 'today' }, { today: TODAY, showCompleted: true }).map((t) => t.id);
    expect(ids).toEqual(['work-overdue', 'work-today', 'work-today-done']);
  });

  it('Inbox and custom lists only show their own tasks and hide completed by default [test.tasky.filtering.list-views]', () => {
    const opts = { today: TODAY, showCompleted: false };
    expect(filterTasks(tasks, { type: 'inbox' }, opts).map((t) => t.id)).toEqual(['inbox-open']);
    expect(filterTasks(tasks, { type: 'inbox' }, { ...opts, showCompleted: true }).map((t) => t.id)).toEqual([
      'inbox-open',
      'inbox-done',
    ]);
    expect(filterTasks(tasks, { type: 'list', listId: 'work' }, opts).map((t) => t.id)).toEqual([
      'work-overdue',
      'work-today',
      'work-future',
    ]);
  });

  it('All Tasks always includes completed tasks after incomplete ones [test.tasky.filtering.all-tasks]', () => {
    const ids = filterTasks(tasks, { type: 'all' }, { today: TODAY, showCompleted: false }).map((t) => t.id);
    expect(ids).toEqual(['work-overdue', 'work-today', 'work-future', 'inbox-open', 'work-today-done', 'inbox-done']);
  });

  it('counts only incomplete tasks for sidebar badges', () => {
    expect(countIncomplete(tasks, { type: 'all' }, TODAY)).toBe(4);
    expect(countIncomplete(tasks, { type: 'today' }, TODAY)).toBe(2);
  });
});
