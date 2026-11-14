import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Dialog, Flex, IconButton, SegmentedControl, Select, Text, TextField, Tooltip } from '@radix-ui/themes';
import { ArrowRightIcon, ExclamationTriangleIcon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { allIds, focusedRelations, generateId } from '@orbit/contract';
import type { Entity, EntityDiffState, OrbitContract, Relationship, RelationshipType } from '@orbit/contract';
import { REL_INFO } from '../lib/model';
import { useCtrl, useDispatch, useEdit } from '../state/context';
import { Confirm, EntityLink } from './common';
import { Field } from './Dialogs';
import { EntityPicker } from './EntityPicker';
import { RelationshipGraph } from './RelationshipGraph';

const TYPES: RelationshipType[] = ['dependsOn', 'uses', 'implementedBy'];

export function RelationshipDialog({ open, onOpenChange, contract, entity, relationship }: { open: boolean; onOpenChange: (o: boolean) => void; contract: OrbitContract; entity: Entity; relationship: Relationship | null }) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const [direction, setDirection] = useState<'source' | 'target'>('source');
  const [type, setType] = useState<RelationshipType>('dependsOn');
  const [otherId, setOtherId] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  useEffect(() => {
    if (!open) return;
    if (relationship) {
      const isSource = relationship.sourceId === entity.id;
      setDirection(isSource ? 'source' : 'target');
      setType(relationship.type);
      setOtherId(isSource ? relationship.targetId : relationship.sourceId);
      setDescription(relationship.description ?? '');
    } else {
      setDirection('source');
      setType('dependsOn');
      setOtherId(null);
      setDescription('');
    }
  }, [open, relationship, entity.id]);
  const other = otherId ? contract.entities.find((e) => e.id === otherId) : undefined;
  const sourceId = direction === 'source' ? entity.id : otherId;
  const targetId = direction === 'source' ? otherId : entity.id;
  const sourceName = direction === 'source' ? entity.name : (other?.name ?? '…');
  const targetName = direction === 'source' ? (other?.name ?? '…') : entity.name;
  const duplicate = !!(sourceId && targetId && contract.relationships.some((r) => r.id !== relationship?.id && r.type === type && r.sourceId === sourceId && r.targetId === targetId));
  const allow = useMemo(() => (e: Entity) => e.id !== entity.id, [entity.id]);
  const submit = () => {
    if (!sourceId || !targetId || sourceId === targetId) return;
    const desc = description.trim();
    edit((c) => {
      if (relationship) {
        return { ...c, relationships: c.relationships.map((r) => (r.id === relationship.id ? { id: r.id, type, sourceId, targetId, ...(desc ? { description: desc } : {}) } : r)) };
      }
      const srcN = c.entities.find((e) => e.id === sourceId)?.name ?? '';
      const tgtN = c.entities.find((e) => e.id === targetId)?.name ?? '';
      const id = generateId('rel', allIds(c).relationships, `${srcN} ${type} ${tgtN}`);
      return { ...c, relationships: [...c.relationships, { id, type, sourceId, targetId, ...(desc ? { description: desc } : {}) }] };
    });
    onOpenChange(false);
    ctrl.toast(relationship ? 'Relationship updated' : 'Relationship added', 'success');
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>{relationship ? 'Edit relationship' : 'Add relationship'}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Relationships point from a source to a target. Impact flows backwards: if the target changes, the source is potentially affected.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="3">
            <div>
              <Text as="div" size="2" weight="medium" mb="1">
                Direction
              </Text>
              <SegmentedControl.Root value={direction} onValueChange={(v) => setDirection(v as 'source' | 'target')} aria-label="Direction">
                <SegmentedControl.Item value="source">This entity is the source</SegmentedControl.Item>
                <SegmentedControl.Item value="target">This entity is the target</SegmentedControl.Item>
              </SegmentedControl.Root>
            </div>
            <Field label="Type">
              <Select.Root value={type} onValueChange={(v) => setType(v as RelationshipType)}>
                <Select.Trigger aria-label="Relationship type" style={{ width: '100%' }} />
                <Select.Content>
                  {TYPES.map((t) => (
                    <Select.Item key={t} value={t}>
                      {t} — {REL_INFO[t].verb}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Text as="div" size="1" color="gray" mt="1">
                {REL_INFO[type].meaning}
              </Text>
            </Field>
            <div>
              <Text as="div" size="2" weight="medium" mb="1">
                {direction === 'source' ? 'Target entity' : 'Source entity'}
              </Text>
              <EntityPicker contract={contract} value={otherId} onChange={setOtherId} allow={allow} label={direction === 'source' ? 'Target entity' : 'Source entity'} showKind triggerWidth="100%" />
            </div>
            <Field label="Description (optional)">
              <TextField.Root aria-label="Relationship description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Why does this relationship exist?" />
            </Field>
            <div className="preview-sentence" aria-live="polite" data-testid="rel-preview">
              <Text size="1" color="gray" as="div" mb="1">
                Preview
              </Text>
              <Text size="3">
                {sourceName} <strong>{REL_INFO[type].verb}</strong> {targetName}
              </Text>
            </div>
            {duplicate && (
              <Callout.Root color="amber" size="1" variant="surface">
                <Callout.Icon>
                  <ExclamationTriangleIcon />
                </Callout.Icon>
                <Callout.Text>An identical relationship already exists. Adding it again creates a duplicate edge.</Callout.Text>
              </Callout.Root>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!otherId}>
              {relationship ? 'Save relationship' : 'Add relationship'}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function RelationshipsSection({ contract, entity, readOnly, states }: { contract: OrbitContract; entity: Entity; readOnly: boolean; states?: Record<string, EntityDiffState> }) {
  const d = useDispatch();
  const edit = useEdit();
  const ctrl = useCtrl();
  const { incoming, outgoing } = useMemo(() => focusedRelations(contract, entity.id), [contract, entity.id]);
  const [dialog, setDialog] = useState<{ rel: Relationship | null } | null>(null);
  const [del, setDel] = useState<Relationship | null>(null);
  const name = (id: string) => contract.entities.find((e) => e.id === id)?.name ?? id;

  const Row = ({ r, dir }: { r: Relationship; dir: 'out' | 'in' }) => (
    <li className="rel-row" data-testid="rel-row" data-rel-id={r.id}>
      <div style={{ minWidth: 0 }}>
        <Flex align="center" gap="2" wrap="wrap" className="rel-sentence">
          {dir === 'out' ? <Text size="2" weight="medium">{entity.name}</Text> : <EntityLink id={r.sourceId} />}
          <ArrowRightIcon aria-hidden />
          <Text size="2" color="gray">{REL_INFO[r.type].verb}</Text>
          <ArrowRightIcon aria-hidden />
          {dir === 'out' ? <EntityLink id={r.targetId} /> : <Text size="2" weight="medium">{entity.name}</Text>}
        </Flex>
        {r.description && (
          <Text as="div" size="1" color="gray" mt="1">
            {r.description}
          </Text>
        )}
        <span className="sr-only">{`${name(r.sourceId)} ${REL_INFO[r.type].verb} ${name(r.targetId)}`}</span>
      </div>
      {!readOnly && (
        <Flex gap="1" flexShrink="0">
          <Tooltip content="Edit relationship">
            <IconButton size="1" variant="ghost" color="gray" aria-label={`Edit relationship: ${name(r.sourceId)} ${REL_INFO[r.type].verb} ${name(r.targetId)}`} onClick={() => setDialog({ rel: r })}>
              <Pencil1Icon />
            </IconButton>
          </Tooltip>
          <Tooltip content="Delete relationship">
            <IconButton size="1" variant="ghost" color="red" aria-label={`Delete relationship: ${name(r.sourceId)} ${REL_INFO[r.type].verb} ${name(r.targetId)}`} onClick={() => setDel(r)}>
              <TrashIcon />
            </IconButton>
          </Tooltip>
        </Flex>
      )}
    </li>
  );

  const group = (rels: Relationship[], dir: 'out' | 'in', title: string) => (
    <div className="rel-group" data-testid={`rel-${dir}`}>
      <Text as="div" size="2" weight="bold" mb="1">
        {title} <Text color="gray" weight="regular">({rels.length})</Text>
      </Text>
      {rels.length === 0 ? (
        <Text size="2" color="gray" as="div">
          None.
        </Text>
      ) : (
        TYPES.map((t) => {
          const sub = rels.filter((r) => r.type === t);
          if (!sub.length) return null;
          return (
            <div key={t} className="rel-type-group">
              <Text size="1" color="gray" as="div" className="rel-type-heading">
                {dir === 'out' ? `This entity ${REL_INFO[t].verb}` : t === 'dependsOn' ? 'Depends on this entity' : t === 'uses' ? 'Uses this entity' : 'Implemented by this entity'}
              </Text>
              <ul className="rel-list">
                {sub.map((r) => (
                  <Row key={r.id} r={r} dir={dir} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </div>
  );

  return (
    <section aria-labelledby="sec-rels" className="section">
      <Flex justify="between" align="center" mb="2">
        <h3 id="sec-rels" className="section-title">
          Relationships <Text size="2" color="gray" weight="regular">({incoming.length + outgoing.length})</Text>
        </h3>
        {!readOnly && (
          <Button size="2" variant="soft" onClick={() => setDialog({ rel: null })}>
            <PlusIcon aria-hidden /> Add relationship
          </Button>
        )}
      </Flex>
      <RelationshipGraph contract={contract} entityId={entity.id} states={states} onNavigate={(e) => d({ type: 'selectEntity', id: e.id, kind: e.kind })} />
      <div className="rel-lists">
        {group(outgoing, 'out', 'Outgoing')}
        {group(incoming, 'in', 'Incoming')}
      </div>
      {dialog && <RelationshipDialog open onOpenChange={(o) => !o && setDialog(null)} contract={contract} entity={entity} relationship={dialog.rel} />}
      <Confirm
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete relationship?"
        confirmLabel="Delete relationship"
        danger
        onConfirm={() => {
          if (!del) return;
          const id = del.id;
          edit((c) => ({ ...c, relationships: c.relationships.filter((r) => r.id !== id) }));
          ctrl.toast('Relationship deleted', 'info');
          setDel(null);
        }}
      >
        {del ? `${name(del.sourceId)} ${REL_INFO[del.type].verb} ${name(del.targetId)}` : ''}
      </Confirm>
    </section>
  );
}
