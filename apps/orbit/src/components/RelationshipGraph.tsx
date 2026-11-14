import { useMemo } from 'react';
import { focusedRelations } from '@orbit/contract';
import type { Entity, OrbitContract, Relationship } from '@orbit/contract';
import { REL_INFO } from '../lib/model';

// Layout: things that point here on the left, this entity in the middle, things it points to on the right.
const NW = 170;
const NH = 34;
const GAP = 120;
const ROW = 48;
const PAD = 14;
const TOP = 22; // room for the Incoming / Outgoing column labels
const W = PAD * 2 + NW * 3 + GAP * 2;

const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

interface Placed {
  e: Entity;
  x: number;
  y: number;
  col: 'left' | 'center' | 'right';
}

export function RelationshipGraph({ contract, entityId, onNavigate }: { contract: OrbitContract; entityId: string; onNavigate: (e: Entity) => void }) {
  const model = useMemo(() => {
    const byId = new Map(contract.entities.map((e) => [e.id, e]));
    const { incoming, outgoing } = focusedRelations(contract, entityId);
    const rels: Relationship[] = [...incoming, ...outgoing.filter((r) => !incoming.some((i) => i.id === r.id))];
    const leftIds = [...new Set(incoming.map((r) => r.sourceId))].filter((id) => id !== entityId && byId.has(id));
    const rightIds = [...new Set(outgoing.map((r) => r.targetId))].filter((id) => id !== entityId && !leftIds.includes(id) && byId.has(id));
    const rows = Math.max(leftIds.length, rightIds.length, 1);
    const H = rows * ROW - (ROW - NH) + PAD * 2 + TOP;
    const place = (ids: string[], col: 'left' | 'right'): Placed[] => {
      const total = ids.length * ROW - (ROW - NH);
      const top = TOP + (H - TOP - total) / 2;
      return ids.map((id, i) => ({ e: byId.get(id)!, x: col === 'left' ? PAD : PAD + (NW + GAP) * 2, y: top + i * ROW, col }));
    };
    const placed = new Map<string, Placed>();
    const center = byId.get(entityId);
    if (center) placed.set(entityId, { e: center, x: PAD + NW + GAP, y: TOP + (H - TOP - NH) / 2, col: 'center' });
    [...place(leftIds, 'left'), ...place(rightIds, 'right')].forEach((p) => placed.set(p.e.id, p));
    const edges = rels
      .map((r) => {
        const a = placed.get(r.sourceId);
        const b = placed.get(r.targetId);
        if (!a || !b) return null;
        const goingRight = a.col === 'left' || (a.col === 'center' && b.col === 'right');
        const x1 = goingRight ? a.x + NW : a.x;
        const x2 = goingRight ? b.x : b.x + NW;
        const y1 = a.y + NH / 2;
        const y2 = b.y + NH / 2;
        const dx = (x2 - x1) * 0.45;
        return { r, a, b, path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    return { placed, edges, H };
  }, [contract, entityId]);

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${W} ${model.H}`} width="100%" style={{ maxWidth: W, display: 'block' }} role="group" aria-label="Relationship graph" data-testid="graph">
        <defs>
          <marker id="arrowhead" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--gray-10)" />
          </marker>
        </defs>
        <text x={PAD} y={15} fontSize={10.5} fontWeight={700} letterSpacing={0.6} className="g-col-title">
          INCOMING
        </text>
        <text x={W - PAD} y={15} textAnchor="end" fontSize={10.5} fontWeight={700} letterSpacing={0.6} className="g-col-title">
          OUTGOING
        </text>
        {model.edges.map(({ r, path, mx, my, a, b }) => {
          const label = REL_INFO[r.type].verb;
          const w = label.length * 5.6 + 12;
          return (
            <g key={r.id} data-testid="graph-edge" data-rel-id={r.id} data-rel-type={r.type}>
              <title>{`${a.e.name} ${label} ${b.e.name}`}</title>
              <path d={path} fill="none" stroke="var(--gray-9)" strokeWidth={1.4} strokeDasharray={REL_INFO[r.type].dash || undefined} markerEnd="url(#arrowhead)" />
              <rect x={mx - w / 2} y={my - 9} width={w} height={18} rx={9} fill="var(--color-panel-solid)" stroke="var(--gray-a5)" />
              <text x={mx} y={my + 4} textAnchor="middle" fontSize={10.5} fill="var(--gray-11)" data-testid="graph-edge-label">
                {label}
              </text>
            </g>
          );
        })}
        {[...model.placed.values()].map((p) => {
          const isCenter = p.col === 'center';
          const props = isCenter
            ? { role: 'img', 'aria-label': `${p.e.name}, selected entity` }
            : {
                role: 'button',
                tabIndex: 0,
                'aria-label': `Go to ${p.e.name}`,
                onClick: () => onNavigate(p.e),
                onKeyDown: (ev: React.KeyboardEvent) => {
                  if (ev.key === 'Enter' || ev.key === ' ') {
                    ev.preventDefault();
                    onNavigate(p.e);
                  }
                },
              };
          return (
            <g key={p.e.id} transform={`translate(${p.x} ${p.y})`} className={`g-node${isCenter ? ' g-node-center' : ' g-node-link'}`} data-testid="graph-node" data-kind={p.e.kind} data-entity-id={p.e.id} data-col={p.col} {...props}>
              <rect width={NW} height={NH} rx={p.e.kind === 'capability' ? NH / 2 : 6} className="g-node-rect" />
              <text x={NW / 2} y={NH / 2 + 4.5} textAnchor="middle" fontSize={13} fontWeight={isCenter ? 600 : 500} className="g-node-name">
                {trunc(p.e.name, 24)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
