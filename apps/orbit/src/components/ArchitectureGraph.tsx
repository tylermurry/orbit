import { useId } from 'react';
import type { KeyboardEvent } from 'react';
import { architectureEdgeCurve, DEFAULT_CAMERA, drawArchitectureCurve, mixBoxes, projectArchitecture } from '../lib/architecture';
import type { ArchitectureEdge, ArchitectureScene, Box, Camera } from '../lib/architecture';
import { REL_INFO } from '../lib/model';

export type ArchitectureSelection =
  | { type: 'node' | 'edge'; id: string }
  | { type: 'edges'; ids: string[]; relationshipIds: string[] }
  | null;

const isSelectedEdge = (selection: ArchitectureSelection, id: string) =>
  selection?.type === 'edge' ? selection.id === id : selection?.type === 'edges' ? selection.ids.includes(id) : false;

interface Frame {
  scene: ArchitectureScene;
  project: (box: Box) => Box;
}

function nodeBox(frame: Frame, id: string) {
  return frame.scene.nodes.get(id)?.box ?? frame.scene.groups.find((group) => group.id === `focus:${id}`)?.box;
}

function nearbyBox(frame: Frame, id: string, counterpart: Frame, origin: Box): Box {
  const representative = frame.scene.representatives.get(id) ?? id;
  const exact = nodeBox(frame, representative);
  if (exact) return frame.project(exact);
  const counterpartFocus = counterpart.scene.focusId;
  const related = counterpartFocus ? nodeBox(frame, counterpartFocus) : undefined;
  if (related) return frame.project(related);
  const focus = frame.scene.focusId ? nodeBox(frame, frame.scene.focusId) : undefined;
  return focus ? frame.project(focus) : origin;
}

const shorten = (name: string, width: number, fontSize: number) => {
  const limit = Math.max(1, Math.floor((width - 18) / (fontSize * 0.58)));
  return name.length <= limit ? name : `${name.slice(0, limit - 1)}…`;
};

interface Props {
  scene: ArchitectureScene;
  camera: Camera;
  destination?: ArchitectureScene | undefined;
  progress: number;
  size: { width: number; height: number };
  selection: ArchitectureSelection;
  parents: ReadonlySet<string>;
  onSelect: (selection: ArchitectureSelection) => void;
  onOpen: (id: string) => void;
  onOpenEdge: (id: string) => void;
}

export function ArchitectureGraph({ scene, camera, destination, progress, size, selection, parents, onSelect, onOpen, onOpenEdge }: Props) {
  const arrow = useId();
  const before = { scene, project: projectArchitecture(scene, size, camera) };
  const after = destination ? { scene: destination, project: projectArchitecture(destination, size, DEFAULT_CAMERA) } : null;

  function keyAction(event: KeyboardEvent<SVGGElement>, activate: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  }

  function renderFrame(frame: Frame, other: Frame | null, entering: boolean) {
    const amount = entering ? 1 - progress : progress;
    const interactive = !other;
    const ownPositions = new Map([...frame.scene.nodes].map(([id, node]) => [id, frame.project(node.box)]));
    const otherPositions = other ? new Map([...ownPositions].map(([id, box]) => [id, nearbyBox(other, id, frame, box)])) : undefined;
    const edgeIds = new Set(frame.scene.edges.map(({ id }) => id));
    const otherEdgeIds = new Set(other?.scene.edges.map(({ id }) => id));
    const groupByNode = new Map(frame.scene.groups.flatMap((group) => group.nodeIds.map((id) => [id, group.id] as const)));
    const relatedEdges = selection?.type === 'node'
      ? frame.scene.edges.filter((edge) => edge.sourceId === selection.id || edge.targetId === selection.id)
      : frame.scene.edges.filter((edge) => isSelectedEdge(selection, edge.id));
    const activeNodes = new Set(relatedEdges.flatMap((edge) => [edge.sourceId, edge.targetId]));
    if (selection?.type === 'node') activeNodes.add(selection.id);
    const activeEdges = new Set(relatedEdges.map((edge) => edge.id));

    function drawEdge(edge: ArchitectureEdge) {
      const shared = otherEdgeIds.has(edge.id);
      if (shared && entering) return null;
      const reverseId = JSON.stringify([edge.targetId, edge.sourceId]);
      const curve = architectureEdgeCurve(ownPositions.get(edge.sourceId)!, ownPositions.get(edge.targetId)!, edgeIds.has(reverseId));
      const otherCurve = otherPositions && architectureEdgeCurve(otherPositions.get(edge.sourceId)!, otherPositions.get(edge.targetId)!, otherEdgeIds.has(reverseId));
      const { path, labelX, labelY } = drawArchitectureCurve(curve, otherCurve, amount);
      const source = frame.scene.nodes.get(edge.sourceId)!.entity;
      const target = frame.scene.nodes.get(edge.targetId)!.entity;
      const types = new Set(edge.relationships.map(({ type }) => type));
      const verb = types.size === 1 ? REL_INFO[edge.relationships[0].type].verb : 'connects to';
      const label = `${source.name} ${verb} ${target.name}${types.size > 1 ? ` (${types.size} links)` : ''}`;
      const selected = isSelectedEdge(selection, edge.id);
      const external = groupByNode.get(edge.sourceId) !== groupByNode.get(edge.targetId);
      const edgeLabel = types.size > 1 ? `${types.size} links` : verb;
      const select = () => onSelect({ type: 'edge', id: edge.id });
      return (
        <g
          key={edge.id}
          className={`architecture-edge${selected ? ' selected' : ''}${selection && !activeEdges.has(edge.id) ? ' muted' : ''}`}
          opacity={shared ? 1 : 1 - amount}
          role={interactive ? 'button' : undefined}
          tabIndex={interactive ? 0 : undefined}
          aria-label={interactive ? label : undefined}
          aria-pressed={interactive ? selected : undefined}
          onClick={interactive ? select : undefined}
          onDoubleClick={interactive ? () => onOpenEdge(edge.id) : undefined}
          onKeyDown={interactive ? (event) => keyAction(event, select) : undefined}
        >
          <title>{label}</title>
          <path d={path} className="architecture-edge-hit" />
          <path d={path} className="architecture-edge-line"
            strokeDasharray={external ? '6 5' : undefined} markerEnd={`url(#${arrow})`} />
          <text className="architecture-edge-label" x={labelX + (external ? 0 : 9)} y={labelY - (external ? 7 : 0)}
            textAnchor={external ? 'middle' : 'start'} dominantBaseline="central">{edgeLabel}</text>
        </g>
      );
    }

    return {
      groups: frame.scene.groups.map((group) => {
        const ownBox = frame.project(group.box);
        const peer = other?.scene.groups.find(({ id }) => id === group.id);
        if (peer && entering) return null;
        const origin = other && (peer
          ? other.project(peer.box)
          : nearbyBox(other, group.id === `focus:${frame.scene.focusId}` ? frame.scene.focusId! : group.nodeIds[0], frame, ownBox));
        const box = origin ? mixBoxes(ownBox, origin, amount) : ownBox;
        const fontSize = Math.min(15, Math.max(11, box.width * 0.065));
        return (
          <g key={group.id} className={`architecture-group ${group.kind}`} opacity={peer ? 1 : 1 - amount}>
            <rect {...box} rx={12} />
            <text x={box.x + 12} y={box.y + 20} fontSize={fontSize}>{shorten(group.name, box.width, fontSize)}</text>
          </g>
        );
      }),
      edges: frame.scene.edges.map(drawEdge),
      nodes: [...frame.scene.nodes].map(([id, { entity }]) => {
        const shared = other?.scene.nodes.has(id);
        if (shared && entering) return null;
        const ownBox = ownPositions.get(id)!;
        const otherBox = otherPositions?.get(id);
        const box = otherBox ? mixBoxes(ownBox, otherBox, amount) : ownBox;
        const selected = selection?.type === 'node' && selection.id === id;
        const canOpen = entity.kind === 'system' && frame.scene.focusId !== id;
        const hasChildren = canOpen && parents.has(id);
        const fontSize = Math.min(15, Math.max(11, box.width * 0.073));
        const showLabel = box.height >= 18 && box.width >= 40;
        const choose = () => onSelect({ type: 'node', id });
        return (
          <g
            key={id}
            className={`architecture-node ${entity.kind}${selected ? ' selected' : ''}${selection && !activeNodes.has(id) ? ' muted' : ''}`}
            opacity={shared ? 1 : 1 - amount}
            data-architecture-system={interactive && canOpen ? id : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            aria-label={interactive ? entity.name : undefined}
            aria-pressed={interactive ? selected : undefined}
            onClick={interactive ? choose : undefined}
            onDoubleClick={interactive && canOpen ? () => onOpen(id) : undefined}
            onKeyDown={interactive ? (event) => keyAction(event, event.key === 'Enter' && canOpen ? () => onOpen(id) : choose) : undefined}
          >
            <title>{entity.name}</title>
            <rect {...box} rx={entity.kind === 'capability' ? box.height / 2 : 8} />
            {showLabel && (
              <text x={box.x + box.width / 2} y={box.y + box.height / 2} textAnchor="middle" dominantBaseline="central" fontSize={fontSize}>
                {shorten(entity.name, box.width - (hasChildren ? 17 : 0), fontSize)}
              </text>
            )}
            {hasChildren && box.width > 90 && (
              <text x={box.x + box.width - 12} y={box.y + box.height / 2} textAnchor="end" dominantBaseline="central" fontSize={fontSize}>›</text>
            )}
          </g>
        );
      }),
    };
  }

  const outgoing = renderFrame(before, after, false);
  const incoming = after ? renderFrame(after, before, true) : undefined;
  return (
    <svg className="architecture-graph" viewBox={`0 0 ${size.width} ${size.height}`} role="group" aria-label="Architecture dependency map">
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className="architecture-arrow" />
        </marker>
      </defs>
      <g aria-hidden={!!after || undefined} pointerEvents={after ? 'none' : undefined}>
        {outgoing.groups}{incoming?.groups}
        {outgoing.edges}{incoming?.edges}
        {outgoing.nodes}{incoming?.nodes}
      </g>
    </svg>
  );
}
