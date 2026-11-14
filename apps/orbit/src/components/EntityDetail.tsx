import { useMemo, useState } from 'react';
import { Button, Callout, Code, Flex, Text } from '@radix-ui/themes';
import { InfoCircledIcon, TrashIcon } from '@radix-ui/react-icons';
import { ancestorsOf, descendantIdsOf, wouldCreateCycle } from '@orbit/contract';
import type { Behavior, Entity, EntityDiffState, OrbitContract } from '@orbit/contract';
import { useApp, useAssurance, useCtrl, useDispatch, useEdit, useInspected } from '../state/context';
import { AssuranceSection } from './AssuranceSection';
import type { Bucket } from './AssuranceSection';
import { BehaviorsSection } from './BehaviorsSection';
import { EntityDeleteDialog } from './EntityDialogs';
import { EntityPicker } from './EntityPicker';
import { ImpactChain } from './ImpactChain';
import { RelationshipsSection } from './RelationshipsSection';
import { ChangeMarker, CopyId, DraftArea, DraftField, KindBadge } from './common';

export function EntityDetail({ entity, contract, readOnly, ghostNote, state, states }: { entity: Entity; contract: OrbitContract; readOnly: boolean; ghostNote?: string; state?: EntityDiffState; states?: Record<string, EntityDiffState> }) {
  const edit = useEdit();
  const d = useDispatch();
  const ctrl = useCtrl();
  const commit = useInspected();
  const expanded = useApp((s) => s.expanded);
  const assurance = useAssurance(contract);
  const summary = assurance.get(entity.id);
  const [bucket, setBucket] = useState<Bucket>('all');
  const [deleting, setDeleting] = useState(false);
  const ancestors = useMemo(() => ancestorsOf(contract, entity.id).reverse(), [contract, entity.id]);
  const descendantBehaviors = useMemo(() => {
    const byId = new Map(contract.entities.map((e) => [e.id, e]));
    const out: { behavior: Behavior; owner: Entity }[] = [];
    for (const id of descendantIdsOf(contract, entity.id)) {
      const e = byId.get(id);
      e?.behaviors.forEach((b) => out.push({ behavior: b, owner: e }));
    }
    return out;
  }, [contract, entity.id]);
  const nameOf = (id: string) => contract.entities.find((e) => e.id === id)?.name ?? id;
  const set = (patch: Partial<Entity>) => edit((c) => ({ ...c, entities: c.entities.map((e) => (e.id === entity.id ? { ...e, ...patch } : e)) }));
  const allow = useMemo(() => (e: Entity) => e.kind === entity.kind && e.id !== entity.id && !wouldCreateCycle(contract, entity.id, e.id), [contract, entity.id, entity.kind]);

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
        <Flex align="center" gap="2">
          <KindBadge kind={entity.kind} />
          {state && state.status !== 'unchanged' && <ChangeMarker status={state.status} long />}
        </Flex>
        {!readOnly && (
          <Button size="2" variant="soft" color="red" onClick={() => setDeleting(true)} aria-label={`Delete ${entity.name}`}>
            <TrashIcon aria-hidden /> Delete
          </Button>
        )}
      </Flex>

      {ghostNote && (
        <Callout.Root color="red" variant="surface" size="1" mb="3" data-testid="ghost-note">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>{ghostNote}</Callout.Text>
        </Callout.Root>
      )}

      <div className="name-field">
        <DraftField value={entity.name} label="Entity name" size="3" disabled={readOnly} validate={(v) => v.trim().length > 0} onCommit={(v) => set({ name: v })} className="name-input" />
      </div>
      <div className="meta-row">
        <Flex align="center" gap="2">
          <Text size="1" color="gray">
            Id
          </Text>
          <CopyId id={entity.id} />
        </Flex>
        <Flex align="center" gap="2">
          <Text size="1" color="gray">
            Parent
          </Text>
          {readOnly ? (
            <Text size="2">{entity.parentId ? nameOf(entity.parentId) : 'No parent (top level)'}</Text>
          ) : (
            <EntityPicker
              contract={contract}
              value={entity.parentId}
              noneLabel="No parent (top level)"
              label="Parent"
              allow={allow}
              onChange={(pid) => {
                set({ parentId: pid });
                if (pid) ctrl.setExpanded({ ...expanded, [pid]: true });
              }}
            />
          )}
        </Flex>
      </div>
      <div className="text-fields">
        <Text as="div" size="1" color="gray" mb="1">
          Summary
        </Text>
        <DraftField value={entity.summary} label="Summary" disabled={readOnly} validate={(v) => v.trim().length > 0} onCommit={(v) => set({ summary: v })} />
        <Text as="div" size="1" color="gray" mt="3" mb="1">
          Description
        </Text>
        <DraftArea value={entity.description} label="Description" rows={3} disabled={readOnly} placeholder="Optional longer description" onCommit={(v) => set({ description: v })} />
      </div>

      {state && state.status !== 'unchanged' && (
        <Callout.Root color={state.status === 'affected' ? 'violet' : state.status === 'removed' ? 'red' : state.status === 'added' ? 'green' : 'amber'} variant="surface" size="1" mt="3" data-testid="state-note">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            {state.status === 'affected' && state.impact ? (
              <>
                <strong>Potentially affected</strong> (inferred from relationships, not observed): <ImpactChain path={state.impact} nameOf={nameOf} />
              </>
            ) : state.reasons.length ? (
              <>
                <strong>{state.status === 'added' ? 'Added' : state.status === 'removed' ? 'Removed' : 'Modified'} in this comparison:</strong> {state.reasons.join('; ')}
              </>
            ) : (
              <strong>{state.status}</strong>
            )}
          </Callout.Text>
        </Callout.Root>
      )}

      {summary && <AssuranceSection summary={summary} bucket={bucket} onBucket={setBucket} hasCommit={!!commit} contract={contract} />}
      {summary && <BehaviorsSection contract={contract} entity={entity} summary={summary} bucket={bucket} onBucket={setBucket} readOnly={readOnly} descendantBehaviors={descendantBehaviors} />}
      <RelationshipsSection contract={contract} entity={entity} readOnly={readOnly} states={states} />

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
