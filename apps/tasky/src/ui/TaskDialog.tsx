import { useState, type FormEvent } from 'react';
import { INBOX_ID, INBOX_NAME, type Task, type TaskList } from '../domain/types';
import { dueDateError, titleError } from '../domain/validation';
import { Modal } from './Modal';

export interface TaskFormValues {
  title: string;
  notes: string;
  dueDate: string | null;
  listId: string;
}

interface TaskDialogProps {
  mode: 'create' | 'edit';
  task?: Task;
  defaultListId: string;
  lists: TaskList[];
  onSubmit: (values: TaskFormValues) => void;
  onClose: () => void;
}

export function TaskDialog({ mode, task, defaultListId, lists, onSubmit, onClose }: TaskDialogProps) {
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [listId, setListId] = useState(task?.listId ?? defaultListId);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const tError = titleError(title);
    const dError = dueDateError(dueDate || null);
    setError(tError);
    setDateError(dError);
    if (tError || dError) return;
    onSubmit({ title: title.trim(), notes, dueDate: dueDate || null, listId });
  };

  return (
    <Modal title={mode === 'create' ? 'New task' : 'Edit task'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form">
        <label className="field">
          <span>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'title-error' : undefined}
            data-autofocus
          />
          {error && (
            <span id="title-error" role="alert" className="field-error">
              {error}
            </span>
          )}
        </label>
        <label className="field">
          <span>Notes</span>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Due date</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              aria-invalid={dateError ? true : undefined}
            />
            {dateError && (
              <span role="alert" className="field-error">
                {dateError}
              </span>
            )}
          </label>
          <label className="field">
            <span>List</span>
            <select value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value={INBOX_ID}>{INBOX_NAME}</option>
              {lists.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {mode === 'create' ? 'Add task' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
