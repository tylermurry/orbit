import { useMemo, useState } from 'react';
import { Button, Code, Flex, Text } from '@radix-ui/themes';
import { TrashIcon } from '@radix-ui/react-icons';
import { ancestorsOf, focusedRelations } from '@orbit/contract';
import type { Entity, OrbitContract } from '@orbit/contract';
import { useAssurance, useDispatch, useEdit } from '../state/context';
import type { Bucket } from './AssuranceSection';
import { BehaviorsSection } from './BehaviorsSection';
import { EntityDeleteDialog } from './EntityDialogs';
import { RelationshipsSection } from './RelationshipsSection';
import { InlineText, KindBadge, summaryFrom } from './common';

export function EntityDetail({ entity, contract, readOnly }: { entity: Entity; contract: OrbitContract; readOnly: boolean }) {
  const edit = useEdit();
  const d = useDispatch();
  const assurance = useAssurance(contract);
  const summary = assurance.get(entity.id);
  const [bucket, setBucket] = useState<Bucket>('all');
  const [deleting, setDeleting] = useState(false);
  const ancestors = useMemo(() => ancestorsOf(contract, entity.id).reverse(), [contract, entity.id]);
  const noBehaviors = entity.behaviors.length === 0;
  const noRels = (() => {
    const { incoming, outgoing } = focusedRelations(contract, entity.id);
    return incoming.length + outgoing.length === 0;
  })();
  const set = (patch: Partial<Entity>) => edit((c) => ({ ...c, entities: c.entities.map((e) => (e.id === entity.id ? { ...e, ...patch } : e)) }));

  return (
    <div className="detail-inner" data-testid="entity-detail" data-entity-id={entity.id}>
      {ancestors.length > 0 && (
        <nav aria-label="Ancestors" className="breadcrumb">
          {ancestors.map((a, i) => (
            <span key={a.id}>
              <button type="button" className="crumb" onClick={() => d({ type: 'selectEntity', id: a.id, kind: a.kind })}>
                {a.name}
              </button>
              {i < ancestors.length && <span aria-hidden> › </span>}
            </span>
          ))}
        </nav>
      )}
      <Flex justify="between" align="center" mb="2" gap="3">
        <KindBadge kind={entity.kind} />
        <Flex gap="3" align="center">
          {entity.kind === 'system' && (
            <Button size="1" variant="ghost" onClick={() => d({ type: 'showArchitecture', id: entity.id })}>Show in Overview</Button>
          )}
          {!readOnly && (
            <Button size="1" variant="ghost" color="red" onClick={() => setDeleting(true)} aria-label={`Delete ${entity.name}`}>
              <TrashIcon aria-hidden /> Delete
            </Button>
          )}
        </Flex>
      </Flex>
      <InlineText value={entity.name} label="Entity name" disabled={readOnly} singleLine placeholder="Untitled" validate={(v) => v.trim().length > 0} onCommit={(v) => set({ name: v })} className="doc-title" />

      <InlineText
        value={entity.description || entity.summary}
        label="Description"
        disabled={readOnly}
        placeholder="Describe this…"
        onCommit={(v) => set({ description: v, summary: summaryFrom(v, entity.summary) })}
        className="doc-body"
      />

      <div className={noBehaviors && noRels ? 'empty-actions' : undefined}>
        {summary && <BehaviorsSection contract={contract} entity={entity} summary={summary} bucket={bucket} onBucket={setBucket} readOnly={readOnly} />}
        <RelationshipsSection contract={contract} entity={entity} readOnly={readOnly} />
      </div>

      {deleting && (
        <EntityDeleteDialog
          open
          onOpenChange={(o) => !o && setDeleting(false)}
          contract={contract}
          entity={entity}
          onDeleted={(next) => {
            setDeleting(false);
            if (next) d({ type: 'selectEntity', id: next, kind: entity.kind });
            else d({ type: 'selectEntity', id: '', kind: entity.kind });
          }}
        />
      )}
      <Text size="1" color="gray" as="p" mt="6" className="footnote">
        <Code size="1" variant="ghost">
          {entity.id}
        </Code>
      </Text>
    </div>
  );
}
