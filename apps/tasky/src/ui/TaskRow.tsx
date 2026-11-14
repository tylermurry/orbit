import type { Task } from '../domain/types';
import { formatDueDate, isOverdue } from '../logic/localDate';

interface TaskRowProps {
  task: Task;
  today: string;
  listName: string | null;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export function TaskRow({ task, today, listName, onToggle, onEdit, onDelete }: TaskRowProps) {
  const overdue = !task.completed && isOverdue(task.dueDate, today);
  return (
    <li className={task.completed ? 'task is-complete' : 'task'}>
      <button
        type="button"
        role="checkbox"
        aria-checked={task.completed}
        aria-label={task.completed ? `Mark '${task.title}' incomplete` : `Mark '${task.title}' complete`}
        className="check"
        onClick={() => onToggle(task)}
      >
        {task.completed && (
          <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
            <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </button>
      <div className="task-body">
        <button type="button" className="task-title" aria-label={`Edit '${task.title}'`} onClick={() => onEdit(task)}>
          {task.title}
        </button>
        <div className="task-meta">
          {overdue && <span className="badge badge-overdue">Overdue</span>}
          {task.dueDate && <span>{formatDueDate(task.dueDate, today)}</span>}
          {listName && <span>{listName}</span>}
          {task.notes && <span className="task-notes">{task.notes}</span>}
        </div>
      </div>
      <button type="button" className="icon-btn" aria-label={`Delete '${task.title}'`} onClick={() => onDelete(task)}>
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
    </li>
  );
}
