import { useMemo } from 'react';
import { focusedRelations } from '@orbit/contract';
import type { Entity, EntityDiffState, OrbitContract, Relationship } from '@orbit/contract';
import { CHANGE_INFO } from './common';
import { REL_INFO } from '../lib/model';

const NW = 196;
const NH = 52;
const GAP = 176;
const ROW = 74;
const PAD = 14;
const W = PAD * 2 + NW * 3 + GAP * 2;

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

interface Placed {
  e: Entity;
  x: number;
  y: number;
  col: 'left' | 'center' | 'right';
}

export function RelationshipGraph({ contract, entityId, states, onNavigate }: { contract: OrbitContract; entityId: string; states?: Record<string, EntityDiffState>; onNavigate: (e: Entity) => void }) {
  const model = useMemo(() => {
    const byId = new Map(contract.entities.map((e) => [e.id, e]));
    const { incoming, outgoing } = focusedRelations(contract, entityId);
    const rels: Relationship[] = [...incoming, ...outgoing.filter((r) => !incoming.some((i) => i.id === r.id))];
    const leftIds = [...new Set(incoming.map((r) => r.sourceId))].filter((id) => id !== entityId && byId.has(id));
    const rightIds = [...new Set(outgoing.map((r) => r.targetId))].filter((id) => id !== entityId && !leftIds.includes(id) && byId.has(id));
    const rows = Math.max(leftIds.length, rightIds.length, 1);
    const H = Math.max(rows * ROW + PAD * 2 - (ROW - NH), 150);
    const place = (ids: string[], col: 'left' | 'right'): Placed[] => {
      const total = ids.length * ROW - (ROW - NH);
      const top = (H - total) / 2;
      return ids.map((id, i) => ({ e: byId.get(id)!, x: col === 'left' ? PAD : PAD + (NW + GAP) * 2, y: top + i * ROW, col }));
    };
    const center = byId.get(entityId);
    const placed = new Map<string, Placed>();
    if (center) placed.set(entityId, { e: center, x: PAD + NW + GAP, y: (H - NH) / 2, col: 'center' });
    [...place(leftIds, 'left'), ...place(rightIds, 'right')].forEach((p) => placed.set(p.e.id, p));
    // group parallel edges by the other endpoint
    const groups = new Map<string, Relationship[]>();
    for (const r of rels) {
      const other = r.sourceId === entityId ? r.targetId : r.sourceId;
      groups.set(other, [...(groups.get(other) ?? []), r]);
    }
    const edges = rels
      .map((r) => {
        const other = r.sourceId === entityId ? r.targetId : r.sourceId;
        const g = groups.get(other)!;
        const k = g.indexOf(r);
        const n = g.length;
        const a = placed.get(r.sourceId);
        const b = placed.get(r.targetId);
        if (!a || !b) return null;
        const off = (k - (n - 1) / 2) * 34;
        // anchor sides
        let x1: number, x2: number;
        const y1 = a.y + NH / 2;
        const y2 = b.y + NH / 2;
        if (a.col === 'left' || (a.col === 'center' && b.col === 'right')) {
          x1 = a.x + NW;
          x2 = b.x;
        } else {
          // a is center going to left node, or a is right (cannot happen) -> leave via left side
          x1 = a.x;
          x2 = b.x + NW;
        }
        const dx = (x2 - x1) * 0.45;
        const path = `M ${x1} ${y1} C ${x1 + dx} ${y1 + off}, ${x2 - dx} ${y2 + off}, ${x2} ${y2}`;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2 + off * 0.75;
        return { r, path, mx, my, a, b };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { placed, edges, H, left: leftIds.length, right: rightIds.length };
  }, [contract, entityId]);

  const nodes = [...model.placed.values()];

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${W} ${model.H + 24}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="group" aria-label="Focused relationship graph. A text list with the same information follows." data-testid="graph">
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--gray-11)" />
          </marker>
        </defs>
        <text x={PAD} y={14} fontSize={10.5} fontWeight={700} letterSpacing={0.6} className="g-col-title">
          INCOMING
        </text>
        <text x={PAD + (NW + GAP) * 2 + NW} y={14} textAnchor="end" fontSize={10.5} fontWeight={700} letterSpacing={0.6} className="g-col-title">
          OUTGOING
        </text>
        {model.left === 0 && (
          <text x={PAD + NW / 2} y={24 + model.H / 2 + 4} textAnchor="middle" fontSize={12} className="g-col-title">
            nothing points here
          </text>
        )}
        {model.right === 0 && (
          <text x={PAD + (NW + GAP) * 2 + NW / 2} y={24 + model.H / 2 + 4} textAnchor="middle" fontSize={12} className="g-col-title">
            points to nothing
          </text>
        )}
        <g transform="translate(0 24)">
        {model.edges.map(({ r, path, mx, my, a, b }) => {
          const label = REL_INFO[r.type].verb;
          const w = label.length * 6.2 + 14;
          return (
            <g key={r.id} data-testid="graph-edge" data-rel-id={r.id} data-rel-type={r.type}>
              <title>{`${a.e.name} ${label} ${b.e.name}${r.description ? ' — ' + r.description : ''}`}</title>
              <path d={path} fill="none" stroke="var(--gray-10)" strokeWidth={1.6} strokeDasharray={REL_INFO[r.type].dash || undefined} strokeLinecap={r.type === 'implementedBy' ? 'round' : undefined} markerEnd="url(#arrowhead)" />
              <rect x={mx - w / 2} y={my - 10} width={w} height={20} rx={10} fill="var(--color-panel-solid)" stroke="var(--gray-a6)" />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize={11} fill="var(--gray-12)" data-testid="graph-edge-label">
                {label}
              </text>
            </g>
          );
        })}
        {nodes.map((p) => {
          const isCenter = p.col === 'center';
          const st = states?.[p.e.id]?.status;
          const info = st && st !== 'unchanged' ? CHANGE_INFO[st] : null;
          const interactive = !isCenter;
          const props = interactive
            ? {
                role: 'button',
                tabIndex: 0,
                'aria-label': `${p.e.name}, ${p.e.kind}. Go to ${p.e.name}`,
                onClick: () => onNavigate(p.e),
                onKeyDown: (ev: React.KeyboardEvent) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onNavigate(p.e);
                  }
                },
              }
            : { role: 'img', 'aria-label': `${p.e.name}, ${p.e.kind}, selected entity` };
          return (
            <g key={p.e.id} transform={`translate(${p.x} ${p.y})`} className={`g-node${interactive ? ' g-node-link' : ''}${isCenter ? ' g-node-center' : ''}`} data-testid="graph-node" data-kind={p.e.kind} data-entity-id={p.e.id} data-col={p.col} {...props}>
              <rect width={NW} height={NH} rx={p.e.kind === 'capability' ? 14 : 4} className="g-node-rect" strokeDasharray={p.e.kind === 'system' ? undefined : undefined} />
              {p.e.kind === 'system' && <rect x={3} y={3} width={NW - 6} height={NH - 6} rx={2} fill="none" className="g-node-inner" />}
              <text x={NW / 2} y={22} textAnchor="middle" fontSize={13} fontWeight={600} className="g-node-name">
                {trunc(p.e.name, 24)}
              </text>
              <text x={NW / 2} y={39} textAnchor="middle" fontSize={10.5} className="g-node-kind">
                {p.e.kind === 'capability' ? '◯ capability' : '▢ system'}
              </text>
              <title>{p.e.name}</title>
              {info && (
                <g transform={`translate(${NW - 8} -2)`} aria-label={info.label} role="img">
                  <rect x={-24} y={-9} width={34} height={17} rx={8.5} className={`g-marker g-marker-${st}`} />
                  <text x={-7} y={3.5} textAnchor="middle" fontSize={10} fontWeight={700} fill="white">
                    {info.symbol}
                    {info.letter}
                  </text>
                </g>
              )}
            </g>
          );
        })}
        </g>
      </svg>
      <div className="graph-legend" aria-label="Graph legend" role="group">
        {(['dependsOn', 'uses', 'implementedBy'] as const).map((t) => (
          <span key={t} className="legend-item">
            <svg width="38" height="10" aria-hidden>
              <line x1="1" y1="5" x2="30" y2="5" stroke="var(--gray-11)" strokeWidth="1.8" strokeDasharray={REL_INFO[t].dash || undefined} strokeLinecap={t === 'implementedBy' ? 'round' : undefined} />
              <path d="M28 1 L37 5 L28 9 z" fill="var(--gray-11)" />
            </svg>
            {t === 'dependsOn' ? 'depends on (solid)' : t === 'uses' ? 'uses (dashed)' : 'implemented by (dotted)'}
          </span>
        ))}
        <span className="legend-item">◯ capability</span>
        <span className="legend-item">▢ system</span>
      </div>
    </div>
  );
}
