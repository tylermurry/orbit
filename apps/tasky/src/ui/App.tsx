import { useCallback, useMemo, useState } from 'react';
import { buildDemoSeed } from '../data/demoSeed';
import { ListRepository } from '../data/listRepository';
import { LocalStore, emptyData, type LoadResult } from '../data/storage';
import { TaskRepository } from '../data/taskRepository';
import { INBOX_ID, INBOX_NAME, type AppData, type Task, type View } from '../domain/types';
import { ValidationError } from '../domain/validation';
import { filterTasks } from '../logic/filtering';
import { ConfirmDialog } from './ConfirmDialog';
import { ListDialog } from './ListDialog';
import { Sidebar } from './Sidebar';
import { TaskDialog, type TaskFormValues } from './TaskDialog';
import { TaskRow } from './TaskRow';
import { useToday } from './useToday';

type DialogState =
  | { kind: 'task-create' }
  | { kind: 'task-edit'; taskId: string }
  | { kind: 'task-delete'; taskId: string }
  | { kind: 'list-create' }
  | { kind: 'list-rename'; listId: string }
  | { kind: 'list-delete'; listId: string }
  | { kind: 'reset-demo' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function App() {
  const store = useMemo(() => new LocalStore(window.localStorage), []);
  const taskRepo = useMemo(() => new TaskRepository(store), [store]);
  const listRepo = useMemo(() => new ListRepository(store), [store]);

  const [load, setLoad] = useState<LoadResult>(() => store.read());
  const [view, setView] = useState<View>({ type: 'inbox' });
  const [showCompleted, setShowCompleted] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const today = useToday();

  const refresh = useCallback(() => setLoad(store.read()), [store]);
  const data: AppData = load.status === 'ok' ? load.data : emptyData();
  const corrupt = load.status === 'corrupt';

  /** Runs a mutation, then re-reads storage. Validation problems surface as a notice instead of crashing. */
  const run = (action: () => void) => {
    try {
      action();
      setNotice(null);
    } catch (e) {
      setNotice(e instanceof ValidationError ? e.message : 'Something went wrong saving your change.');
    }
    refresh();
  };

  const select = (next: View) => {
    setView(next);
    setMenuOpen(false);
    setShowCompleted(false);
  };

  const currentList = view.type === 'list' ? data.lists.find((l) => l.id === view.listId) : undefined;
  const effectiveView: View = view.type === 'list' && !currentList ? { type: 'inbox' } : view;
  const listName = (id: string) => (id === INBOX_ID ? INBOX_NAME : (data.lists.find((l) => l.id === id)?.name ?? INBOX_NAME));
  const heading =
    effectiveView.type === 'inbox'
      ? INBOX_NAME
      : effectiveView.type === 'today'
        ? 'Today'
        : effectiveView.type === 'all'
          ? 'All Tasks'
          : (currentList?.name ?? INBOX_NAME);

  const visible = filterTasks(data.tasks, effectiveView, { today, showCompleted });
  const withCompleted = filterTasks(data.tasks, effectiveView, { today, showCompleted: true });
  const hiddenCompleted = withCompleted.length - visible.length;
  const defaultListId = effectiveView.type === 'list' ? effectiveView.listId : INBOX_ID;
  const showList = effectiveView.type === 'today' || effectiveView.type === 'all';

  const downloadRaw = () => {
    const raw = load.status === 'corrupt' ? (load.raw ?? store.rawText() ?? '') : '';
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tasky-raw-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const startFresh = () => {
    store.startFresh();
    setNotice(null);
    refresh();
  };

  const editingTask = dialog?.kind === 'task-edit' ? data.tasks.find((t) => t.id === dialog.taskId) : undefined;
  const deletingTask = dialog?.kind === 'task-delete' ? data.tasks.find((t) => t.id === dialog.taskId) : undefined;
  const renamingList = dialog?.kind === 'list-rename' ? data.lists.find((l) => l.id === dialog.listId) : undefined;
  const deletingList = dialog?.kind === 'list-delete' ? data.lists.find((l) => l.id === dialog.listId) : undefined;
  const closeDialog = () => setDialog(null);

  const loadDemo = () => {
    store.write(buildDemoSeed(new Date()));
    setView({ type: 'inbox' });
    refresh();
  };

  const emptyState = () => {
    if (load.status === 'empty') {
      return (
        <div className="empty" data-testid="welcome">
          <h2>Welcome to Tasky</h2>
          <p>Your tasks are stored only in this browser. Add your first task, or explore with sample data.</p>
          <button type="button" className="btn btn-primary" onClick={loadDemo}>
            Load demo data
          </button>
        </div>
      );
    }
    if (hiddenCompleted > 0) {
      return (
        <div className="empty">
          <h2>All done here</h2>
          <p>Completed tasks are hidden. Turn on Show completed to see them.</p>
        </div>
      );
    }
    const copy = {
      inbox: ['Inbox is empty', 'Tasks you add without choosing a list land here.'],
      today: ['Nothing due today', 'Tasks due today or overdue will show up here.'],
      all: ['No tasks yet', 'Use New task to add your first one.'],
      list: [`No tasks in ${heading}`, 'Use New task to add one to this list.'],
    }[effectiveView.type];
    return (
      <div className="empty">
        <h2>{copy[0]}</h2>
        <p>{copy[1]}</p>
      </div>
    );
  };

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="menu-toggle btn"
          aria-expanded={menuOpen}
          aria-controls="sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          Menu
        </button>
        <div className="brand" aria-hidden="true">
          <svg viewBox="0 0 32 24" width="32" height="24">
            <path d="M2 3h20l8 9-8 9H2z" fill="#5f6368" />
            <path d="M9 12l3 3 6-6" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </div>
        <span className="brand-name">Tasky</span>
        <button type="button" className="btn btn-primary new-task" disabled={corrupt} onClick={() => setDialog({ kind: 'task-create' })}>
          New task
        </button>
      </header>
      <div className="layout">
        <Sidebar
          data={data}
          view={effectiveView}
          today={today}
          disabled={corrupt}
          open={menuOpen}
          onSelect={select}
          onNewList={() => setDialog({ kind: 'list-create' })}
          onResetDemo={() => setDialog({ kind: 'reset-demo' })}
        />
        <main className="main">
          {load.status === 'corrupt' && (
            <div className="banner" role="alert">
              <strong>Tasky could not read your saved data.</strong>
              <p>
                {load.reason} Nothing has been changed or deleted. You can download the raw data to inspect or repair it, or start
                fresh. Starting fresh keeps a backup copy of the unreadable data under another storage key.
              </p>
              <div className="banner-actions">
                <button type="button" className="btn" onClick={downloadRaw}>
                  Download raw data
                </button>
                <button type="button" className="btn btn-primary" onClick={startFresh}>
                  Start fresh (keeps a backup copy under another key)
                </button>
              </div>
            </div>
          )}
          {notice && (
            <p className="notice" role="alert">
              {notice}
            </p>
          )}
          <div className="main-header">
            <h1 id="main-heading" tabIndex={-1}>
              {heading}
            </h1>
            <div className="main-actions">
              {currentList && (
                <>
                  <button type="button" className="btn" onClick={() => setDialog({ kind: 'list-rename', listId: currentList.id })}>
                    Rename list
                  </button>
                  <button type="button" className="btn" onClick={() => setDialog({ kind: 'list-delete', listId: currentList.id })}>
                    Delete list
                  </button>
                </>
              )}
              {effectiveView.type !== 'all' && (
                <label className="toggle">
                  <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
                  Show completed
                </label>
              )}
            </div>
          </div>
          {corrupt ? null : visible.length === 0 ? (
            emptyState()
          ) : (
            <ul className="task-list" aria-label={`${heading} tasks`}>
              {visible.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  today={today}
                  listName={showList ? listName(t.listId) : null}
                  onToggle={(task) => run(() => taskRepo.setCompleted(task.id, !task.completed))}
                  onEdit={(task) => setDialog({ kind: 'task-edit', taskId: task.id })}
                  onDelete={(task: Task) => setDialog({ kind: 'task-delete', taskId: task.id })}
                />
              ))}
            </ul>
          )}
        </main>
      </div>

      {dialog?.kind === 'task-create' && (
        <TaskDialog
          mode="create"
          defaultListId={defaultListId}
          lists={data.lists}
          onClose={closeDialog}
          onSubmit={(v: TaskFormValues) => {
            run(() => taskRepo.create(v));
            closeDialog();
          }}
        />
      )}
      {editingTask && (
        <TaskDialog
          mode="edit"
          task={editingTask}
          defaultListId={editingTask.listId}
          lists={data.lists}
          onClose={closeDialog}
          onSubmit={(v) => {
            run(() => taskRepo.update(editingTask.id, v));
            closeDialog();
          }}
        />
      )}
      {deletingTask && (
        <ConfirmDialog
          title="Delete task?"
          message={`"${deletingTask.title}" will be permanently deleted.`}
          confirmLabel="Delete task"
          onCancel={closeDialog}
          onConfirm={() => {
            run(() => taskRepo.remove(deletingTask.id));
            closeDialog();
          }}
        />
      )}
      {dialog?.kind === 'list-create' && (
        <ListDialog
          mode="create"
          otherNames={data.lists.map((l) => l.name)}
          onClose={closeDialog}
          onSubmit={(name) => {
            let created: string | null = null;
            run(() => {
              created = listRepo.create(name).id;
            });
            closeDialog();
            if (created) select({ type: 'list', listId: created });
          }}
        />
      )}
      {renamingList && (
        <ListDialog
          mode="rename"
          initialName={renamingList.name}
          otherNames={data.lists.filter((l) => l.id !== renamingList.id).map((l) => l.name)}
          onClose={closeDialog}
          onSubmit={(name) => {
            run(() => listRepo.rename(renamingList.id, name));
            closeDialog();
          }}
        />
      )}
      {deletingList && (
        <ConfirmDialog
          title={`Delete list "${deletingList.name}"?`}
          message={`The list will be deleted. Its ${plural(
            data.tasks.filter((t) => t.listId === deletingList.id).length,
            'task',
            'tasks',
          )} will be moved to Inbox, not deleted.`}
          confirmLabel="Delete list"
          onCancel={closeDialog}
          onConfirm={() => {
            run(() => listRepo.remove(deletingList.id));
            closeDialog();
            setView({ type: 'inbox' });
          }}
        />
      )}
      {dialog?.kind === 'reset-demo' && (
        <ConfirmDialog
          title="Reset demo data?"
          message="This replaces ALL of your current lists and tasks with the sample demo data. This cannot be undone."
          confirmLabel="Replace with demo data"
          onCancel={closeDialog}
          onConfirm={() => {
            loadDemo();
            closeDialog();
          }}
        />
      )}
    </div>
  );
}
