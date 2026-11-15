import { useMemo } from 'react';
import { Button, Flex, Text } from '@radix-ui/themes';
import { ancestorsOf, potentialImpact } from '@orbit/contract';
import type { Entity, EntityChangeStatus, OrbitContract, Relationship, SemanticDiff } from '@orbit/contract';
import { ChangeDetail, diffLookups } from './Changes';
import { EntityDetail } from './EntityDetail';
import { ImpactChain } from './ImpactChain';
import { Badge } from '@radix-ui/themes';
import type { EntityKind } from '@orbit/contract';
import { ChangePill } from './common';

/** Which view an entity lives in: capabilities → Product, systems → Engineering. */
export function AreaBadge({ kind }: { kind: EntityKind }) {
  return (
    <Badge color={kind === 'capability' ? 'indigo' : 'cyan'} variant="soft" radius="full">
      {kind === 'capability' ? 'Product' : 'Engineering'}
    </Badge>
  );
}

/** Pill text shared with the legend: plan labels win, then "Planned" for additions in a plan. */
export function pillLabel(status: EntityChangeStatus, key: string, labels?: Record<string, string>, planned?: boolean) {
  return labels?.[key] ?? (status === 'added' && planned ? 'Planned' : undefined);
}

/** Selection keys for the Impact list are `entity:<id>` (same shape as an entity Change key). */
export const entityKey = (id: string) => `entity:${id}`;
export const entityIdFromKey = (key: string | null) => (key?.startsWith('entity:') ? key.slice('entity:'.length) : null);

export interface ChangedEntity {
  entity: Entity;
  status: EntityChangeStatus;
  /** Contract the entity lives in (target, or base when removed). */
  contract: OrbitContract;
  crumbs: Entity[];
}

/** Directly changed capabilities and systems, in contract order, with their ancestor path. */
export function changedEntities(diff: SemanticDiff): ChangedEntity[] {
  const direct = new Set(diff.directlyChangedEntityIds);
  const out: ChangedEntity[] = [];
  const seen = new Set<string>();
  const push = (c: OrbitContract | null) => {
    c?.entities.forEach((e) => {
      if (!direct.has(e.id) || seen.has(e.id)) return;
      seen.add(e.id);
      const status = diff.entityStates[e.id]?.status ?? 'modified';
      out.push({
        entity: e,
        status,
        contract: c,
        crumbs: ancestorsOf(c, e.id).reverse(),
      });
    });
  };
  push(diff.target);
  push(diff.base);
  return out;
}

export function Crumbs({ crumbs }: { crumbs: Entity[] }) {
  if (!crumbs.length) return null;
  return (
    <span className="entity-crumbs" aria-label="Location">
      {crumbs.map((a) => a.name).join(' › ')}
    </span>
  );
}

export function ChangedEntityList({ items, selectedKey, onSelect, labels, planned }: { items: ChangedEntity[]; labels?: Record<string, string>; planned?: boolean; selectedKey: string | null; onSelect: (key: string) => void }) {
  if (items.length === 0) {
    return (
      <div className="empty-inline" data-testid="no-change-rows">
        <Text size="2" color="gray">
          No capabilities or systems changed.
        </Text>
      </div>
    );
  }
  return (
    <ul className="change-list flat" aria-label="Changed capabilities and systems">
      {items.map(({ entity, status, crumbs }) => {
        const key = entityKey(entity.id);
        return (
          <li key={key}>
            <button type="button" className={`change-row${selectedKey === key ? ' selected' : ''}`} onClick={() => onSelect(key)} aria-pressed={selectedKey === key} data-testid="change-row" data-change-key={key} data-entity-id={entity.id}>
              <ChangePill status={status} long label={pillLabel(status, key, labels, planned)} />
              <span className="change-label">
                <span className="truncate" style={{ display: 'block' }}>
                  {entity.name}
                </span>
                {crumbs.length > 0 && (
                  <span className="change-sub truncate" style={{ display: 'block' }}>
                    <Crumbs crumbs={crumbs} />
                  </span>
                )}
              </span>
              <AreaBadge kind={entity.kind} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function EntityChangeDetail({ diff, item, labels, proposed, onShowIn, canShowIn }: { diff: SemanticDiff; item: ChangedEntity; labels?: Record<string, string>; proposed: boolean; onShowIn: (id: string) => void; canShowIn: (id: string) => boolean }) {
  const { entity, status, contract, crumbs } = item;
  const { nameOf } = useMemo(() => diffLookups(diff), [diff]);
  const related = useMemo(() => {
    const own = diff.changes.filter((c) => c.category === 'entity' && c.id === entity.id);
    const rest = diff.changes.filter((c) => !(c.category === 'entity' && c.id === entity.id) && c.entityIds.includes(entity.id));
    return [...own, ...rest];
  }, [diff, entity.id]);
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
    return potentialImpact(rels, [entity.id]);
  }, [diff, entity.id]);
  const reasons = diff.entityStates[entity.id]?.reasons ?? [];

  const consumers = (
    <div className="consumers" data-testid="consumers">
      <h4>Potential upstream consumers</h4>
      <Text as="p" size="1" color="gray" mb="2">
        Inferred by following relationships backwards from this {entity.kind}. Potential impact only — not observed breakage.
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
  );

  if (status === 'added') {
    return (
      <div className="change-detail" data-testid="change-detail" data-entity-id={entity.id}>
        <Flex align="center" gap="2" mb="3">
          <ChangePill status="added" long label={pillLabel('added', entityKey(entity.id), labels, proposed)} />
        </Flex>
        <EntityDetail key={entity.id} entity={entity} contract={contract} readOnly />
        {consumers}
      </div>
    );
  }

  return (
    <div className="change-detail" data-testid="change-detail" data-entity-id={entity.id}>
      {crumbs.length > 0 && (
        <div className="breadcrumb">
          <Crumbs crumbs={crumbs} />
        </div>
      )}
      <Flex align="center" gap="2" mb="1" wrap="wrap">
        <ChangePill status={status} long label={pillLabel(status, entityKey(entity.id), labels, proposed)} />
        <AreaBadge kind={entity.kind} />
      </Flex>
      <h1 className="doc-title impact-entity-title">{entity.name}</h1>
      {reasons.length > 0 && (
        <ul className="entity-reasons">
          {reasons.map((r, i) => (
            <li key={i}>
              <Text size="2">{r}</Text>
            </li>
          ))}
        </ul>
      )}
      {related.map((c) => (
        <div key={c.key} className="nested-change">
          <ChangeDetail diff={diff} change={c} label={labels?.[c.key]} proposed={proposed} compact />
        </div>
      ))}
      {consumers}
      {status !== 'removed' && canShowIn(entity.id) && (
        <Flex gap="2" mt="4">
          <Button onClick={() => onShowIn(entity.id)}>Show in {entity.kind === 'capability' ? 'Product' : 'Engineering'}</Button>
        </Flex>
      )}
    </div>
  );
}
