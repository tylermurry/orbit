import type { AppData, View } from '../domain/types';
import { countIncomplete } from '../logic/filtering';

interface SidebarProps {
  data: AppData;
  view: View;
  today: string;
  disabled: boolean;
  open: boolean;
  onSelect: (view: View) => void;
  onNewList: () => void;
  onResetDemo: () => void;
}

const sameView = (a: View, b: View) => a.type === b.type && (a.type !== 'list' || (b.type === 'list' && a.listId === b.listId));

export function Sidebar({ data, view, today, disabled, open, onSelect, onNewList, onResetDemo }: SidebarProps) {
  const item = (label: string, target: View) => (
    <li key={label}>
      <button
        type="button"
        className="nav-item"
        aria-current={sameView(view, target) ? 'page' : undefined}
        onClick={() => onSelect(target)}
      >
        <span className="nav-label">{label}</span>
        <span className="count">{countIncomplete(data.tasks, target, today)}</span>
      </button>
    </li>
  );
  return (
    <aside id="sidebar" className={open ? 'sidebar is-open' : 'sidebar'}>
      <nav aria-label="Lists">
        <ul className="nav-list">
          {item('Inbox', { type: 'inbox' })}
          {item('Today', { type: 'today' })}
          {item('All Tasks', { type: 'all' })}
        </ul>
        <div className="nav-heading">
          <h2>My lists</h2>
          <button type="button" className="icon-btn" aria-label="New list" onClick={onNewList} disabled={disabled}>
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ul className="nav-list">
          {data.lists.map((l) => item(l.name, { type: 'list', listId: l.id }))}
        </ul>
        {data.lists.length === 0 && <p className="nav-hint">No lists yet. Create one to group related tasks.</p>}
      </nav>
      <div className="sidebar-footer">
        <button type="button" className="link-btn" onClick={onResetDemo} disabled={disabled}>
          Reset demo data
        </button>
      </div>
    </aside>
  );
}
