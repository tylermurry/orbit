import { useId } from 'react';
import type { KeyboardEvent } from 'react';
import type { FlowScene } from '../lib/flows';

const LANE_WIDTH = 190;
const PAD_X = 20;
const HEADER_TOP = 20;
const HEADER_HEIGHT = 40;
const MESSAGES_TOP = HEADER_TOP + HEADER_HEIGHT + 22;
const ROW_HEIGHT = 44;
const BADGE_RADIUS = 10;

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

interface Props {
  scene: FlowScene;
  /** Index of the selected message (0 = trigger). */
  selected: number;
  onSelect: (index: number) => void;
}

/** Sequence diagram: one lane per participant, one arrow per message. Plain SVG, styled by `flow-*` classes. */
export function FlowDiagram({ scene, selected, onSelect }: Props) {
  const arrow = useId();
  const clipId = useId();
  const { lanes, messages } = scene;
  const width = PAD_X * 2 + lanes.length * LANE_WIDTH;
  const height = MESSAGES_TOP + messages.length * ROW_HEIGHT + 12;
  const laneX = new Map(lanes.map((lane, i) => [lane.id, PAD_X + i * LANE_WIDTH + LANE_WIDTH / 2]));
  const cy = HEADER_TOP + HEADER_HEIGHT / 2;

  function keyAction(event: KeyboardEvent<SVGGElement>, activate: () => void) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  }

  return (
    <svg className="flow-diagram" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Sequence diagram">
      <defs>
        <marker id={arrow} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" className="flow-arrow" />
        </marker>
        <clipPath id={clipId}><circle cx="0" cy="0" r={HEADER_HEIGHT / 2} /></clipPath>
      </defs>
      {lanes.map((lane) => {
        const x = laneX.get(lane.id)!;
        return (
          <g key={lane.id} className={`flow-lane ${lane.kind}${lane.known ? '' : ' unknown'}`}>
            <line className="flow-lifeline" x1={x} x2={x} y1={HEADER_TOP + HEADER_HEIGHT} y2={height - 8} />
            {lane.kind === 'user' ? (
              <g transform={`translate(${x} ${cy})`} role="img" aria-label="User">
                <circle className="flow-avatar-bg" r={HEADER_HEIGHT / 2} />
                <g clipPath={`url(#${clipId})`}>
                  <circle className="flow-avatar-figure" cx="0" cy="-5" r="7" />
                  <ellipse className="flow-avatar-figure" cx="0" cy="19" rx="13" ry="12" />
                </g>
                <circle className="flow-avatar-ring" r={HEADER_HEIGHT / 2} />
              </g>
            ) : (
              <>
                <rect className="flow-lane-box" x={x - (LANE_WIDTH - 24) / 2} y={HEADER_TOP} width={LANE_WIDTH - 24} height={HEADER_HEIGHT} rx={lane.kind === 'system' ? 8 : HEADER_HEIGHT / 2} />
                <text className="flow-lane-name" x={x} y={cy} textAnchor="middle" dominantBaseline="central">{clip(lane.name, 20)}</text>
              </>
            )}
            <title>{lane.name}</title>
          </g>
        );
      })}
      {messages.map((m) => {
        const y = MESSAGES_TOP + m.index * ROW_HEIGHT + ROW_HEIGHT / 2;
        const x1 = laneX.get(m.from) ?? PAD_X;
        const x2 = laneX.get(m.to) ?? PAD_X;
        const self = x1 === x2;
        const dir = Math.sign(x2 - x1) || 1;
        const label = `${m.index === 0 ? 'Trigger' : `Step ${m.index}`}: ${m.description}`;
        const select = () => onSelect(m.index);
        const text = m.broken ? 'missing link' : clip(m.verb, 26);
        const mid = self ? x1 + 52 : (x1 + x2) / 2;
        const badgeX = self ? x1 + 24 : x1 + dir * (BADGE_RADIUS + 10);
        return (
          <g
            key={m.index}
            className={`flow-message${m.index === selected ? ' selected' : ''}${m.reply ? ' reply' : ''}${m.broken ? ' broken' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={m.index === selected}
            data-step={m.index}
            onClick={select}
            onKeyDown={(event) => keyAction(event, select)}
          >
            <title>{m.sentence}</title>
            <rect className="flow-message-hit" x={PAD_X} y={y - ROW_HEIGHT / 2 + 2} width={width - 2 * PAD_X} height={ROW_HEIGHT - 4} rx={8} />
            {self ? (
              <path className="flow-message-line" d={`M ${x1} ${y - 8} h 36 v 16 h -36`} markerEnd={`url(#${arrow})`} fill="none" strokeDasharray={m.reply ? '6 4' : undefined} />
            ) : (
              <line className="flow-message-line" x1={x1} x2={x2 - dir * 2} y1={y} y2={y} markerEnd={`url(#${arrow})`} strokeDasharray={m.reply ? '6 4' : undefined} />
            )}
            <text className="flow-message-label" x={mid} y={self ? y : y - 7} textAnchor={self ? 'start' : 'middle'} dominantBaseline={self ? 'central' : 'auto'}>
              {text}{m.broken ? ` · ${clip(m.sentence, 30)}` : ''}
            </text>
            {m.index > 0 && (
              <g className="flow-badge" transform={`translate(${badgeX} ${y})`}>
                <circle r={BADGE_RADIUS} />
                <text textAnchor="middle" dominantBaseline="central">{m.index}</text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}
