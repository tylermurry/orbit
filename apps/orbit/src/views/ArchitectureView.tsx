import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { Button, IconButton } from '@radix-ui/themes';
import { Cross2Icon } from '@radix-ui/react-icons';
import { ArchitectureGraph } from '../components/ArchitectureGraph';
import type { ArchitectureSelection } from '../components/ArchitectureGraph';
import { KindBadge } from '../components/common';
import { architectureScene, DEFAULT_CAMERA, indexArchitecture } from '../lib/architecture';
import { REL_INFO } from '../lib/model';
import { loadPref, savePref } from '../lib/prefs';
import { useApp, useDispatch } from '../state/context';

interface ZoomTransition {
  destinationId: string | null;
  progress: number;
  target: number;
  automatic: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const INSPECTOR_WIDTH_KEY = 'orbit.layout.architectureInspectorWidth';

export function ArchitectureView({ active }: { active: boolean }) {
  const contract = useApp((state) => state.contract)!;
  const requestedFocus = useApp((state) => state.architectureFocusId);
  const dispatch = useDispatch();
  const index = useMemo(() => indexArchitecture(contract), [contract]);
  const scene = useMemo(() => architectureScene(index, requestedFocus), [index, requestedFocus]);
  const trail = scene.focusId ? index.chains.get(scene.focusId) ?? [] : [];
  const parentId = trail.at(-2) ?? null;
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [workspaceWidth, setWorkspaceWidth] = useState(0);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    const width = loadPref<unknown>(INSPECTOR_WIDTH_KEY, null);
    return typeof width === 'number' && Number.isFinite(width) ? width : null;
  });
  const [selection, setSelection] = useState<ArchitectureSelection>(null);
  const [camera, setCamera] = useState(DEFAULT_CAMERA);
  const [transition, setTransition] = useState<ZoomTransition | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const inspectorId = useId();
  const resize = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const motion = useRef<ZoomTransition | null>(null);
  const animation = useRef<number | null>(null);
  const drag = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const destinationId = transition?.destinationId ?? null;
  const transitioning = !!transition;
  const destination = useMemo(() => transitioning ? architectureScene(index, destinationId) : undefined,
    [index, transitioning, destinationId]);
  const maxWidth = Math.min(720, Math.floor(workspaceWidth * 0.62));
  const defaultWidth = Math.min(340, Math.round(workspaceWidth * 0.36));
  const minWidth = Math.min(175, defaultWidth, maxWidth);
  const inspectorWidth = clamp(preferredWidth ?? defaultWidth, minWidth, maxWidth);

  function saveInspectorWidth(width: number | null) {
    setPreferredWidth(width);
    savePref(INSPECTOR_WIDTH_KEY, width);
  }

  useEffect(() => {
    const element = stage.current!;
    const workspaceElement = workspace.current!;
    const observer = new ResizeObserver((entries) => {
      for (const { target, contentRect: { width, height } } of entries) {
        if (target === workspaceElement && width) setWorkspaceWidth(width);
        if (target === element && width && height) setSize({ width, height });
      }
    });
    observer.observe(element);
    observer.observe(workspaceElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    motion.current = null;
    setTransition(null);
    setSelection(null);
    setCamera(DEFAULT_CAMERA);
    return () => {
      if (animation.current !== null) cancelAnimationFrame(animation.current);
      animation.current = null;
    };
  }, [requestedFocus]);

  function updateZoom(next: ZoomTransition) {
    motion.current = next;
    if (animation.current !== null) return;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let previousTime: number | null = null;
    function tick(time: number) {
      const zoom = motion.current;
      if (!zoom) {
        animation.current = null;
        return;
      }
      const elapsed = previousTime === null ? 16 : time - previousTime;
      previousTime = time;
      const fraction = reduceMotion ? 1 : 1 - Math.exp(-elapsed / (zoom.automatic ? 85 : 45));
      zoom.progress += (zoom.target - zoom.progress) * fraction;
      if (Math.abs(zoom.progress - zoom.target) < 0.005) zoom.progress = zoom.target;
      if (zoom.progress === 0 || zoom.progress === 1) {
        motion.current = null;
        animation.current = null;
        setTransition(null);
        if (zoom.progress === 1) {
          setCamera(DEFAULT_CAMERA);
          dispatch({ type: 'setArchitectureFocus', id: zoom.destinationId });
        }
      } else {
        setTransition({ ...zoom });
        animation.current = zoom.progress === zoom.target ? null : requestAnimationFrame(tick);
      }
    }
    animation.current = requestAnimationFrame(tick);
  }

  function open(id: string | null) {
    if (id === scene.focusId) return;
    const current = motion.current;
    updateZoom({ destinationId: id, progress: current?.destinationId === id ? current.progress : 0, target: 1, automatic: true });
    setSelection(null);
  }

  const wheel = useRef<(event: WheelEvent) => void>();
  wheel.current = (event) => {
    if (!active || !event.deltaY) return;
    event.preventDefault();
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1);
    const step = clamp(-delta / 360, -0.34, 0.34);
    const current = motion.current;
    if (current) {
      const baseline = current.automatic ? current.progress : current.target;
      const goingDeeper = current.destinationId !== parentId || !scene.focusId;
      updateZoom({ ...current, automatic: false, target: clamp(baseline + (goingDeeper ? step : -step), 0, 1) });
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('[data-architecture-system]') : null;
    const systemId = target?.getAttribute('data-architecture-system');
    const zoomingIn = step > 0 && !!systemId;
    const zoomingOut = step < 0 && !!scene.focusId && camera.scale <= 1.03;
    if (zoomingIn || zoomingOut) {
      updateZoom({ destinationId: zoomingIn ? systemId : parentId, progress: 0, target: Math.abs(step), automatic: false });
      setSelection(null);
      return;
    }
    const bounds = stage.current!.getBoundingClientRect();
    const x = event.clientX - bounds.left - bounds.width / 2;
    const y = event.clientY - bounds.top - bounds.height / 2;
    setCamera((previous) => {
      const scale = clamp(previous.scale * Math.exp(step * 0.42), scene.focusId ? 1 : 0.55, 4);
      const ratio = scale / previous.scale;
      return { scale, x: x + (previous.x - x) * ratio, y: y + (previous.y - y) * ratio };
    });
  };

  useEffect(() => {
    const element = stage.current!;
    const handleWheel = (event: WheelEvent) => wheel.current?.(event);
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  function startPan(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || motion.current || (event.target instanceof Element && event.target.closest('[role="button"]'))) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, offsetX: camera.x, offsetY: camera.y };
    setSelection(null);
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    const position = drag.current;
    if (!position) return;
    setCamera((previous) => ({ ...previous, x: position.offsetX + event.clientX - position.x, y: position.offsetY + event.clientY - position.y }));
  }

  const selectedNode = selection?.type === 'node' ? scene.nodes.get(selection.id)?.entity : undefined;
  const selectedDescription = selectedNode?.description || selectedNode?.summary;
  const selectedEdge = selection?.type === 'edge' ? scene.edges.find(({ id }) => id === selection.id) : undefined;

  return (
    <section className="architecture-view" aria-label="Architecture">
      <div className="architecture-toolbar">
        <nav className="architecture-breadcrumb" aria-label="Architecture hierarchy">
          <Button size="1" variant="ghost" disabled={!trail.length && camera === DEFAULT_CAMERA} onClick={() => {
            if (trail.length) open(null);
            else setCamera(DEFAULT_CAMERA);
          }}>Overview</Button>
          {trail.map((id, i) => (
            <span key={id} className="architecture-crumb">
              <span aria-hidden="true">›</span>
              {i === trail.length - 1
                ? <span aria-current="page">{index.entities.get(id)?.name}</span>
                : <Button size="1" variant="ghost" onClick={() => open(id)}>{index.entities.get(id)?.name}</Button>}
            </span>
          ))}
        </nav>
        <span className="architecture-hint">Scroll to zoom · Double-click a system to open</span>
      </div>
      <div className="architecture-workspace" ref={workspace}>
        <div className="architecture-stage" ref={stage} onPointerDown={startPan} onPointerMove={pan} onLostPointerCapture={() => { drag.current = null; }}>
          {scene.nodes.size > 0 && size.width > 0 && (
            <ArchitectureGraph scene={scene} destination={destination} progress={transition?.progress ?? 0} size={size} camera={camera}
              selection={selection} parents={index.parents} onSelect={setSelection} onOpen={open} />
          )}
          {scene.nodes.size === 0 && <p className="architecture-empty">Add a system to start mapping your architecture.</p>}
        </div>
        <div
          className="architecture-splitter"
          role="separator"
          aria-label="Resize Architecture sidebar"
          aria-orientation="vertical"
          aria-controls={inspectorId}
          aria-valuemin={minWidth}
          aria-valuemax={maxWidth}
          aria-valuenow={inspectorWidth}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            resize.current = { startX: event.clientX, startWidth: inspectorWidth, width: inspectorWidth };
          }}
          onPointerMove={(event) => {
            const drag = resize.current;
            if (!drag) return;
            drag.width = clamp(drag.startWidth + drag.startX - event.clientX, minWidth, maxWidth);
            setPreferredWidth(drag.width);
          }}
          onLostPointerCapture={() => {
            const drag = resize.current;
            resize.current = null;
            if (drag && drag.width !== drag.startWidth) saveInspectorWidth(drag.width);
          }}
          onDoubleClick={() => saveInspectorWidth(null)}
          onKeyDown={(event) => {
            const { key } = event;
            if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'Home' && key !== 'End') return;
            const width = { ArrowLeft: inspectorWidth + 24, ArrowRight: inspectorWidth - 24, Home: minWidth, End: maxWidth }[key];
            event.preventDefault();
            saveInspectorWidth(clamp(width, minWidth, maxWidth));
          }}
        />
        <aside
          id={inspectorId}
          className="architecture-inspector"
          aria-label="Architecture selection"
          style={workspaceWidth ? { flexBasis: inspectorWidth } : undefined}
        >
          <div className="architecture-inspector-heading">
            <strong>{selectedNode?.name ?? (selectedEdge ? 'Relationships' : 'Details')}</strong>
            {(selectedNode || selectedEdge) && (
              <IconButton variant="ghost" size="1" color="gray" onClick={() => setSelection(null)} aria-label="Close architecture selection"><Cross2Icon /></IconButton>
            )}
          </div>
          <div className="architecture-inspector-content">
            {!selectedNode && !selectedEdge && <p>Select a node or a relationship to see its details.</p>}
            {selectedNode && (
              <>
                {selectedDescription && <p className="architecture-node-description">{selectedDescription}</p>}
                <div className="architecture-inspector-actions">
                  {selectedNode.kind === 'system' && selectedNode.id !== scene.focusId && (
                    <Button size="1" variant="soft" onClick={() => open(selectedNode.id)}>Open on map</Button>
                  )}
                  <Button size="1" variant="soft" onClick={() => dispatch({ type: 'selectEntity', id: selectedNode.id, kind: selectedNode.kind })}>
                    {selectedNode.kind === 'system' ? 'Open in Systems' : 'Open in Product'}
                  </Button>
                </div>
              </>
            )}
            {selectedEdge && (
              <ul className="architecture-relationships" role="list">
                {selectedEdge.relationships.map((relationship) => {
                  const source = index.entities.get(relationship.sourceId);
                  const target = index.entities.get(relationship.targetId);
                  if (!source || !target) return null;
                  return (
                    <li key={relationship.id}>
                      <div className="architecture-relationship-title">
                        <KindBadge kind={source.kind} label={source.name} />{' '}
                        <span>{REL_INFO[relationship.type].verb}</span>{' '}
                        <KindBadge kind={target.kind} label={target.name} />
                      </div>
                      {relationship.description && <p>{relationship.description}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}
