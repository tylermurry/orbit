import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Callout } from '@radix-ui/themes';
import { ExclamationTriangleIcon } from '@radix-ui/react-icons';
import type { Flow, OrbitContract } from '@orbit/contract';
import { flowScene } from '../lib/flows';
import { loadPref, savePref } from '../lib/prefs';
import { FlowDiagram } from './FlowDiagram';
import { useMemo } from 'react';

const PANEL_KEY = 'orbit.layout.flowPanelWidth';
const PANEL_MIN = 220;
const PANEL_MAX = 560;

/** Drag handle for a pane to its right: width grows as the handle moves left. */
function PanelSplitter({ width, onChange, onCommit }: { width: number; onChange: (w: number) => void; onCommit: (w: number) => void }) {
  const dragging = useRef(false);
  const clamp = (w: number) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.round(w)));
  return (
    <div
      className="splitter flow-panel-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize step panel"
      aria-valuenow={width}
      aria-valuemin={PANEL_MIN}
      aria-valuemax={PANEL_MAX}
      tabIndex={0}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const right = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().right;
        onChange(clamp(right - e.clientX));
      }}
      onPointerUp={() => {
        dragging.current = false;
        onCommit(width);
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const w = clamp(width + (e.key === 'ArrowLeft' ? 16 : -16));
          onChange(w);
          onCommit(w);
        }
      }}
    />
  );
}

/** Heading, sequence diagram and resizable step panel for one flow; shared by the Flows screen and the plan view. */
export function FlowStage({ contract, flow, step, onStep, actions, onShowInTopology }: {
  contract: OrbitContract;
  flow: Flow;
  step: number;
  onStep: (i: number) => void;
  /** Extra controls on the heading's right (delete, before/after). */
  actions?: ReactNode;
  /** Omit to hide the Topology buttons (they would show the working tree, not this version). */
  onShowInTopology?: (relationshipIds: string[]) => void;
}) {
  const [panelWidth, setPanelWidth] = useState(() => loadPref<number>(PANEL_KEY, 320));
  const scene = useMemo(() => flowScene(contract, flow), [contract, flow]);
  const selected = Math.min(step, scene.messages.length - 1);
  const message = scene.messages[selected];
  return (
    <>
      <main className="flow-stage" aria-label="Sequence diagram">
        <div className="flow-heading">
          <strong>{flow.name}</strong>
          <span>{flow.summary}</span>
          {actions}
        </div>
        {flow.steps.length === 0 && <p className="flow-empty">This flow has no steps yet.</p>}
        <div className="flow-scroll">
          <FlowDiagram scene={scene} selected={selected} onSelect={onStep} />
        </div>
      </main>
      {message && (
        <>
          <PanelSplitter width={panelWidth} onChange={setPanelWidth} onCommit={(w) => savePref(PANEL_KEY, w)} />
          <aside className="flow-panel" style={{ width: panelWidth }} aria-label="Step details">
            <strong className="flow-step-title">{selected === 0 ? 'Trigger' : `Step ${selected}`}</strong>
            <p className="flow-step-description" data-testid="flow-step-description">{message.description}</p>
            {message.broken ? (
              <Callout.Root size="1" color="amber" role="alert">
                <Callout.Icon><ExclamationTriangleIcon /></Callout.Icon>
                <Callout.Text>{message.sentence}. Remove this step or restore the link.</Callout.Text>
              </Callout.Root>
            ) : (
              <p className="flow-step-link">{message.reply ? 'Reply along: ' : ''}{message.sentence}</p>
            )}
            {message.relationship?.description && <p className="flow-step-link-description">{message.relationship.description}</p>}
            {onShowInTopology && (
              <div className="flow-panel-actions">
                <Button size="1" variant="soft" disabled={!message.relationship} onClick={() => onShowInTopology(message.relationship ? [message.relationship.id] : [])}>Show step in Topology</Button>
                <Button size="1" variant="soft" onClick={() => onShowInTopology(flow.steps.map((s) => s.relationshipId))}>Show in Topology</Button>
              </div>
            )}
          </aside>
        </>
      )}
    </>
  );
}
