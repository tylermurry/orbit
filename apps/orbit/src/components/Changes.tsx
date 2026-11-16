import { useMemo } from 'react';
import { Badge, Button, Code, Flex, Table, Text } from '@radix-ui/themes';
import { behaviorAssurance, potentialImpact } from '@orbit/contract';
import type { Change, ChangeCategory, ChangeKind, Entity, EntityChangeStatus, Relationship, SemanticDiff } from '@orbit/contract';
import { KIND_LABEL, REL_INFO } from '../lib/model';
import { wordDiff } from '../lib/format';
import { useAssuranceCtx } from '../state/context';
import { ChangePill, StatusPill, TestStatusBadge, testStatusReason } from './common';
import { ImpactChain } from './ImpactChain';

export const CATEGORY_LABEL: Record<ChangeCategory, string> = {
  product: 'Product',
  entity: 'Capabilities & systems',
  behavior: 'Behaviors',
  relationship: 'Relationships',
  test: 'Tests',
};
export const CATEGORY_ORDER: ChangeCategory[] = ['product', 'entity', 'behavior', 'relationship', 'test'];
export const KIND_SYMBOL: Record<ChangeKind, { symbol: string; label: string; cls: string }> = {
  added: { symbol: '＋', label: 'Added', cls: 'added' },
  modified: { symbol: '●', label: 'Modified', cls: 'modified' },
  removed: { symbol: '−', label: 'Removed', cls: 'removed' },
};

export function diffLookups(diff: SemanticDiff) {
  const entities = new Map<string, Entity>();
  diff.base?.entities.forEach((e) => entities.set(e.id, e));
  diff.target?.entities.forEach((e) => entities.set(e.id, e));
  const nameOf = (id: string) => entities.get(id)?.name ?? id;
  return { entities, nameOf };
}

function singular(c: Change, entities: Map<string, Entity>): string {
  if (c.category === 'entity') {
    const e = entities.get(c.id);
    return e ? KIND_LABEL[e.kind].toLowerCase() : 'entity';
  }
  return c.category;
}

function relOf(c: Change, side: 'before' | 'after'): Relationship | undefined {
  const v = side === 'before' ? c.before : c.after;
  if (v && typeof v === 'object') return v as Relationship;
  return undefined;
}

export function changeLabel(c: Change, nameOf: (id: string) => string, diff: SemanticDiff): string {
  if (c.category === 'relationship') {
    const r = relOf(c, 'after') ?? relOf(c, 'before');
    if (r) return `${nameOf(r.sourceId)} ${REL_INFO[r.type].verb} ${nameOf(r.targetId)}`;
    const t = diff.target?.relationships.find((x) => x.id === c.id) ?? diff.base?.relationships.find((x) => x.id === c.id);
    if (t) return `${nameOf(t.sourceId)} ${REL_INFO[t.type].verb} ${nameOf(t.targetId)}`;
  }
  return c.label || c.id;
}

export function ChangeList({ diff, selectedKey, onSelect, group, query, category, labels }: { diff: SemanticDiff; labels?: Record<string, string>; selectedKey: string | null; onSelect: (key: string) => void; group: 'all' | 'guarantee' | 'verification'; query: string; category: string | null }) {
  const actx = useAssuranceCtx();
  const { entities, nameOf } = useMemo(() => diffLookups(diff), [diff]);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () =>
      diff.changes.filter((c) => {
        if (group !== 'all' && c.group !== group) return false;
        if (category) {
          if (category === 'capability' || category === 'system') {
            if (c.category !== 'entity' || entities.get(c.id)?.kind !== category) return false;
          } else if (c.category !== category) return false;
        }
        if (q && !`${changeLabel(c, nameOf, diff)} ${c.id} ${c.fields.map((f) => f.field).join(' ')}`.toLowerCase().includes(q)) return false;
        return true;
      }),
    [diff, group, category, q, entities, nameOf],
  );
  if (rows.length === 0) {
    return (
      <div className="empty-inline" data-testid="no-change-rows">
        <Text size="2" color="gray">
          {diff.changes.length === 0 ? 'No changes.' : 'No changes match the current filters.'}
        </Text>
      </div>
    );
  }
  return (
    <div className="change-list" role="list" aria-label="Semantic changes">
      {CATEGORY_ORDER.map((cat) => {
        const items = rows.filter((c) => c.category === cat);
        if (!items.length) return null;
        return (
          <div key={cat} role="listitem">
            <div className="change-group-header" role="heading" aria-level={4}>
              {CATEGORY_LABEL[cat]} <span>{items.length}</span>
            </div>
            <ul>
              {items.map((c) => {
                const k = KIND_SYMBOL[c.kind];
                const verified = c.category === 'behavior' && c.kind !== 'removed' && diff.target ? behaviorAssurance(diff.target, c.id, actx) : undefined;
                return (
                  <li key={c.key}>
                    <button type="button" className={`change-row${selectedKey === c.key ? ' selected' : ''}${c.group === 'verification' ? ' secondary' : ''}`} onClick={() => onSelect(c.key)} aria-pressed={selectedKey === c.key} data-testid="change-row" data-change-key={c.key}>
                      <ChangePill status={k.cls as EntityChangeStatus} label={labels?.[c.key]} />
                      <span className="change-label">
                        <span className="truncate" style={{ display: 'block' }}>
                          {changeLabel(c, nameOf, diff)}
                        </span>
                        <span className="change-sub">
                          {k.label} {singular(c, entities)}
                          {c.group === 'verification' ? ' · verification metadata' : ''}
                        </span>
                      </span>
                      {verified && <StatusPill status={verified.status} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Words({ a, b, side }: { a: string; b: string; side: 'before' | 'after' }) {
  const parts = useMemo(() => wordDiff(a, b), [a, b]);
  return (
    <span className="worddiff">
      {parts.map((p, i) => {
        if (p.type === 'same') return <span key={i}>{p.text}</span>;
        if (p.type === 'del') return side === 'before' ? <del key={i}>{p.text}</del> : null;
        return side === 'after' ? <ins key={i}>{p.text}</ins> : null;
      })}
    </span>
  );
}

const LONG = new Set(['description', 'expected', 'summary', 'details', 'name']);

function show(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

/** onShowIn jumps to the entity in Product/System; canShowIn says whether it exists in the working copy. */
export function ChangeDetail({ diff, change, onShowIn, canShowIn, label, proposed, compact }: { diff: SemanticDiff; label?: string; proposed?: boolean; change: Change; onShowIn?: (entityId: string) => void; canShowIn?: (entityId: string) => boolean; /** Nested under an entity: hide id, consumers and Show-in buttons. */ compact?: boolean }) {
  const { entities, nameOf } = useMemo(() => diffLookups(diff), [diff]);
  const k = KIND_SYMBOL[change.kind];
  // Consumers of *this* change: reverse reachability over the union of base and target relationships.
  const affected = useMemo(() => {
    const seen = new Set<string>();
    const rels: Relationship[] = [];
    for (const r of [...(diff.base?.relationships ?? []), ...(diff.target?.relationships ?? [])]) {
      const k = `${r.id}|${r.type}|${r.sourceId}|${r.targetId}`;
      if (!seen.has(k)) {
        seen.add(k);
        rels.push(r);
      }
    }
    return potentialImpact(rels, change.entityIds);
  }, [diff, change]);
  const targetEntityId = change.entityIds[0];
  const targetEntity = targetEntityId ? entities.get(targetEntityId) : undefined;
  const rb = relOf(change, 'before') ?? (change.category === 'relationship' ? diff.base?.relationships.find((r) => r.id === change.id) : undefined);
  const ra = relOf(change, 'after') ?? (change.category === 'relationship' ? diff.target?.relationships.find((r) => r.id === change.id) : undefined);
  const relText = (r?: Relationship) => (r ? `${nameOf(r.sourceId)} ${REL_INFO[r.type].verb} ${nameOf(r.targetId)}` : '—');
  const objFields: [string, unknown][] = useMemo(() => {
    const o = (change.kind === 'removed' ? change.before : change.after) as Record<string, unknown> | undefined;
    if (!o || typeof o !== 'object') return [];
    return Object.entries(o).filter(([key]) => key !== 'behaviors');
  }, [change]);
  const moved = change.fields.find((f) => f.field === 'parentId');
  const actx = useAssuranceCtx();
  // For a behavior that exists after the change: is it covered by tests, and are they passing?
  const verified = !proposed && change.category === 'behavior' && change.kind !== 'removed' && diff.target ? behaviorAssurance(diff.target, change.id, actx) : undefined;
  const ownerMove = change.ownerBefore !== undefined && change.ownerAfter !== undefined && change.ownerBefore !== change.ownerAfter;

  return (
    <div className="change-detail" data-testid="change-detail">
      <Flex align="center" gap="2" mb="1" wrap="wrap">
        <ChangePill status={k.cls as EntityChangeStatus} long label={label} />
        <Text size="1" color="gray" style={{ textTransform: 'capitalize' }}>
          {singular(change, entities)}
        </Text>
        <Badge color={change.group === 'guarantee' ? 'indigo' : 'gray'} variant="soft" radius="full">
          {change.group === 'guarantee' ? 'Product guarantee' : 'Verification metadata'}
        </Badge>
      </Flex>
      <h3 className="change-title">{changeLabel(change, nameOf, diff)}</h3>
      {!compact && (
        <Code size="1" variant="ghost" color="gray">
          {change.id}
        </Code>
      )}

      {change.category === 'relationship' && (
        <div className="rel-before-after">
          {change.kind !== 'added' && (
            <div>
              <Text size="1" color="gray" as="div">
                Before
              </Text>
              <Text size="3" data-testid="rel-before">{relText(rb)}</Text>
            </div>
          )}
          {change.kind !== 'removed' && (
            <div>
              <Text size="1" color="gray" as="div">
                After
              </Text>
              <Text size="3" data-testid="rel-after">{relText(ra)}</Text>
            </div>
          )}
        </div>
      )}

      {(moved || ownerMove) && (
        <Text as="p" size="2" mt="3" data-testid="moved-note">
          Moved from <strong>{ownerMove ? nameOf(change.ownerBefore!) : moved && moved.before ? nameOf(String(moved.before)) : 'top level'}</strong> to{' '}
          <strong>{ownerMove ? nameOf(change.ownerAfter!) : moved && moved.after ? nameOf(String(moved.after)) : 'top level'}</strong>
        </Text>
      )}

      {change.kind === 'modified' && (
        <Table.Root variant="surface" size="1" mt="3" className="field-table" aria-label="Field changes">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell style={{ width: '18%' }}>Field</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Before</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>After</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {change.fields.map((f) => {
              const isText = LONG.has(f.field) && typeof f.before === 'string' && typeof f.after === 'string';
              return (
                <Table.Row key={f.field} data-testid="field-row" data-field={f.field}>
                  <Table.RowHeaderCell>
                    <Code size="1" variant="ghost">
                      {f.field}
                    </Code>
                  </Table.RowHeaderCell>
                  {f.field === 'testIds' ? (
                    <Table.Cell colSpan={2}>
                      <Flex gap="1" wrap="wrap">
                        {(f.addedItems ?? []).map((t) => (
                          <Badge key={'a' + t} color="green" variant="soft" radius="full">
                            + {t}
                          </Badge>
                        ))}
                        {(f.removedItems ?? []).map((t) => (
                          <Badge key={'r' + t} color="red" variant="soft" radius="full">
                            − {t}
                          </Badge>
                        ))}
                        {(f.addedItems ?? []).length + (f.removedItems ?? []).length === 0 && <Text size="1">order only</Text>}
                      </Flex>
                    </Table.Cell>
                  ) : (
                    <>
                      <Table.Cell className="before-cell">{isText ? <Words a={f.before as string} b={f.after as string} side="before" /> : <Value field={f.field} v={f.before} nameOf={nameOf} />}</Table.Cell>
                      <Table.Cell className="after-cell">{isText ? <Words a={f.before as string} b={f.after as string} side="after" /> : <Value field={f.field} v={f.after} nameOf={nameOf} />}</Table.Cell>
                    </>
                  )}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}

      {change.kind !== 'modified' && change.category !== 'relationship' && objFields.length > 0 && (
        <Table.Root variant="surface" size="1" mt="3" className="field-table" aria-label={change.kind === 'added' ? 'Added values' : 'Removed values'}>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell style={{ width: '18%' }}>Field</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>{change.kind === 'added' ? 'Value' : 'Value (before)'}</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {objFields.map(([key, v]) => (
              <Table.Row key={key}>
                <Table.RowHeaderCell>
                  <Code size="1" variant="ghost">
                    {key}
                  </Code>
                </Table.RowHeaderCell>
                <Table.Cell>
                  <Value field={key} v={v} nameOf={nameOf} />
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}

      {change.group === 'verification' && (
        <Text as="p" size="1" color="gray" mt="3">
          This is verification metadata. It does not change what the product guarantees and never marks an entity as changed.
        </Text>
      )}

      {!compact && change.entityIds.length > 0 && (
        <div className="consumers" data-testid="consumers">
          <h4>Potential upstream consumers</h4>
          <Text as="p" size="1" color="gray" mb="2">
            Inferred by following relationships backwards from the changed {targetEntity ? KIND_LABEL[targetEntity.kind].toLowerCase() : 'entity'}. Potential impact only — not observed breakage.
          </Text>
          {affected.length === 0 ? (
            <Text size="2" color="gray">
              No other entity depends on this change.
            </Text>
          ) : (
            <ul>
              {affected.map((p) => (
                <li key={p.entityId + p.changedEntityId}>
                  <ImpactChain path={p} nameOf={nameOf} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {verified && (
        <div className="consumers" data-testid="behavior-verification">
          <Flex align="center" gap="2" mb="2">
            <Text size="2" weight="bold">
              Verification
            </Text>
            <StatusPill status={verified.status} />
          </Flex>
          {verified.tests.length === 0 ? (
            <Text size="2" color="gray">
              No tests verify this behavior yet.
            </Text>
          ) : (
            <ul className="verify-list">
              {verified.tests.map((t) => (
                <li key={t.testId}>
                  <TestStatusBadge status={t.status} reason={testStatusReason(t.status, t.result, actx.since)} /> <Text size="2">{t.test?.name ?? t.testId}</Text>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!compact && onShowIn && targetEntityId && targetEntity && (canShowIn?.(targetEntityId) ?? true) && (
        <Flex gap="2" mt="4">
          <Button variant={targetEntity.kind === 'capability' ? 'solid' : 'soft'} disabled={targetEntity.kind !== 'capability'} onClick={() => onShowIn(targetEntityId)}>
            Show in Product
          </Button>
          <Button variant={targetEntity.kind === 'system' ? 'solid' : 'soft'} disabled={targetEntity.kind !== 'system'} onClick={() => onShowIn(targetEntityId)}>
            Show in System
          </Button>
        </Flex>
      )}
    </div>
  );
}

function Value({ field, v, nameOf }: { field: string; v: unknown; nameOf: (id: string) => string }) {
  if (v === undefined || v === null || v === '') return <Text color="gray">—</Text>;
  if (field === 'parentId' || field === 'owner' || field === 'sourceId' || field === 'targetId') return <span>{nameOf(String(v))}</span>;
  if (field === 'id' || field === 'testId' || field === 'location' || field === 'type') return <Code size="1">{show(v)}</Code>;
  return <span className="wrap">{show(v)}</span>;
}

