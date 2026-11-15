import { useRef } from 'react';

/** Vertical drag handle that resizes the pane to its left (same look and keys as the hierarchy's). */
export function Splitter({ width, min, max, label, onChange, onCommit }: { width: number; min: number; max: number; label: string; onChange: (w: number) => void; onCommit: (w: number) => void }) {
  const dragging = useRef(false);
  const clamp = (w: number) => Math.min(max, Math.max(min, Math.round(w)));
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const left = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().left;
        onChange(clamp(e.clientX - left));
      }}
      onPointerUp={() => {
        dragging.current = false;
        onCommit(width);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const w = clamp(width + (e.key === 'ArrowRight' ? 16 : -16));
          onChange(w);
          onCommit(w);
        }
      }}
    />
  );
}
