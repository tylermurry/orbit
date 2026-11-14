import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Accessible modal built on the native <dialog>: showModal() makes the rest of the page inert (focus trap),
 * Escape requests close, and focus returns to the opener (or the page heading if the opener is gone).
 * An element with data-autofocus receives initial focus; otherwise the first focusable control does.
 */
export function Modal({ title, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => {
      if (dialog.open) dialog.close();
      if (opener && opener.isConnected) opener.focus();
      else document.getElementById('main-heading')?.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        // Native modals let Tab escape to the browser chrome; wrap focus inside the dialog instead.
        if (e.key !== 'Tab') return;
        const focusable = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === e.currentTarget)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
    >
      <h2 id={titleId} className="modal-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
