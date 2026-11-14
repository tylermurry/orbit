import { useState, type FormEvent } from 'react';
import { listNameError } from '../domain/validation';
import { Modal } from './Modal';

interface ListDialogProps {
  mode: 'create' | 'rename';
  initialName?: string;
  /** Names of the other custom lists, for duplicate detection. */
  otherNames: string[];
  onSubmit: (name: string) => void;
  onClose: () => void;
}

export function ListDialog({ mode, initialName = '', otherNames, onSubmit, onClose }: ListDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const err = listNameError(name, otherNames);
    setError(err);
    if (!err) onSubmit(name.trim());
  };

  return (
    <Modal title={mode === 'create' ? 'New list' : 'Rename list'} onClose={onClose}>
      <form onSubmit={submit} noValidate className="form">
        <label className="field">
          <span>List name</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'list-error' : undefined}
            data-autofocus
          />
          {error && (
            <span id="list-error" role="alert" className="field-error">
              {error}
            </span>
          )}
        </label>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            {mode === 'create' ? 'Create list' : 'Save name'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
