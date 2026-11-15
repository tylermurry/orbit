import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { loadPref, savePref } from '../lib/prefs';

const KEY = 'orbit.layout.workspaceSplit';
const MIN_LEFT = 480;
const MIN_RIGHT = 560;

/**
 * Capabilities | Impact side by side with a draggable divider. The left share is published as the
 * --orbit-split CSS variable so the top bar's halves stay lined up with the panes.
 */
export function WorkspaceSplit({ left, right }: { left: ReactNode; right: ReactNode }) {
  const [frac, setFrac] = useState(() => {
    const v = loadPref<number>(KEY, 0.5);
    return typeof v === 'number' && v > 0 && v < 1 ? v : 0.5;
  });
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const clamp = (f: number) => {
    const w = ref.current?.getBoundingClientRect().width ?? window.innerWidth;
    if (w <= MIN_LEFT + MIN_RIGHT) return 0.5;
    return Math.min(1 - MIN_RIGHT / w, Math.max(MIN_LEFT / w, f));
  };

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--orbit-split', `${(clamp(frac) * 100).toFixed(3)}%`);
  }, [frac]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = document.documentElement;
    const onResize = () => root.style.setProperty('--orbit-split', `${(clamp(frac) * 100).toFixed(3)}%`);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      root.style.removeProperty('--orbit-split');
    };
  }, [frac]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = Math.round(clamp(frac) * 100);
  return (
    <div className="workspace-split" ref={ref} data-testid="workspace-split">
      <section className="workspace-pane" aria-label="Capabilities">
        {left}
      </section>
      <section className="workspace-pane impact-pane" aria-label="Impact pane">
        {right}
      </section>
      <div
        className="workspace-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Capabilities and Impact"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current || !ref.current) return;
          const r = ref.current.getBoundingClientRect();
          setFrac(clamp((e.clientX - r.left) / r.width));
        }}
        onPointerUp={() => {
          dragging.current = false;
          savePref(KEY, frac);
        }}
        onDoubleClick={() => {
          setFrac(0.5);
          savePref(KEY, 0.5);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const f = clamp(frac + (e.key === 'ArrowRight' ? 0.02 : -0.02));
            setFrac(f);
            savePref(KEY, f);
          }
        }}
      />
    </div>
  );
}
