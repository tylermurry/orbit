import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Dialog, Flex, SegmentedControl, Text, TextField } from '@radix-ui/themes';
import { allIds, generateId, referencesTo, removeEntity } from '@orbit/contract';
import type { Entity, EntityKind, OrbitContract } from '@orbit/contract';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import { KIND_LABEL } from '../lib/model';
import { useApp, useCtrl, useDispatch, useEdit } from '../state/context';
import { Confirm, summaryFrom } from './common';
import { Field } from './Dialogs';

const ID_PREFIX: Record<EntityKind, string> = { capability: 'cap', system: 'sys' };

export function EntityCreateDialog({ open, onOpenChange, contract, kind, selectedId }: { open: boolean; onOpenChange: (o: boolean) => void; contract: OrbitContract; kind: EntityKind; selectedId: string | null }) {
  const edit = useEdit();
  const d = useDispatch();
  const ctrl = useCtrl();
  const expanded = useApp((s) => s.expanded);
  const selected = selectedId ? contract.entities.find((e) => e.id === selectedId && e.kind === kind) : null;
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'child'>('top');
  useEffect(() => {
    if (open) {
      setName('');
      setSummary('');
      setId('');
      setIdTouched(false);
      setPlacement(selected ? 'child' : 'top');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const ids = useMemo(() => allIds(contract).entities, [contract]);
  const autoId = useMemo(() => generateId(ID_PREFIX[kind], ids, name || 'new'), [ids, kind, name]);
  const effectiveId = idTouched ? id : autoId;
  const idTaken = ids.has(effectiveId.trim());
  const valid = name.trim() && effectiveId.trim() && !idTaken;
  const submit = () => {
    if (!valid) return;
    const entity: Entity = { id: effectiveId.trim(), kind, parentId: placement === 'child' && selected ? selected.id : null, name: name.trim(), summary: summaryFrom(summary, name.trim()), description: summary.trim(), behaviors: [] };
    edit((c) => ({ ...c, entities: [...c.entities, entity] }));
    if (entity.parentId) ctrl.setExpanded({ ...expanded, [entity.parentId]: true });
    d({ type: 'selectEntity', id: entity.id, kind });
    onOpenChange(false);
    ctrl.toast(`Added ${KIND_LABEL[kind].toLowerCase()} “${entity.name}”`, 'success');
  };
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Add {KIND_LABEL[kind].toLowerCase()}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          {kind === 'capability' ? 'A capability is something a user of the product can do.' : 'A system is an internal component that supports capabilities.'}
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="3">
            <Field label="Name">
              <TextField.Root aria-label="Name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Description">
              <TextField.Root aria-label="Description" value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Optional: what is it?" />
            </Field>
            <Field label="Id" hint="Stable identifier; cannot be changed later." error={idTaken ? 'This id is already used.' : undefined}>
              <TextField.Root
                aria-label="Id"
                value={effectiveId}
                style={{ fontFamily: 'var(--code-font-family)' }}
                onChange={(e) => {
                  setId(e.target.value);
                  setIdTouched(true);
                }}
              />
            </Field>
            {selected && (
              <div>
                <Text as="div" size="2" weight="medium" mb="1">
                  Where
                </Text>
                <SegmentedControl.Root value={placement} onValueChange={(v) => setPlacement(v as 'top' | 'child')} aria-label="Placement">
                  <SegmentedControl.Item value="child">Inside “{selected.name.length > 22 ? selected.name.slice(0, 21) + '…' : selected.name}”</SegmentedControl.Item>
                  <SegmentedControl.Item value="top">Top level</SegmentedControl.Item>
                </SegmentedControl.Root>
              </div>
            )}
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!valid}>
              Add {KIND_LABEL[kind].toLowerCase()}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function EntityDeleteDialog({ open, onOpenChange, contract, entity, onDeleted }: { open: boolean; onOpenChange: (o: boolean) => void; contract: OrbitContract; entity: Entity; onDeleted: (nextSelect: string | null) => void }) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const refs = referencesTo(contract, 'entity', entity.id);
  const children = contract.entities.filter((e) => e.parentId === entity.id);
  const rels = contract.relationships.filter((r) => r.sourceId === entity.id || r.targetId === entity.id);
  const grand = entity.parentId ? contract.entities.find((e) => e.id === entity.parentId) : null;
  return (
    <Confirm
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${entity.name}”?`}
      confirmLabel="Delete"
      danger
      onConfirm={() => {
        edit((c) => removeEntity(c, entity.id, { children: 'reparent-to-grandparent' }));
        onDeleted(entity.parentId);
        ctrl.toast(`Deleted “${entity.name}”. Undo with ${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}Z.`, 'info');
      }}
    >
      <Flex direction="column" gap="2">
        <Text size="2">This will:</Text>
        <ul className="impl-list">
          <li>
            Delete <strong>{entity.behaviors.length}</strong> behavior{entity.behaviors.length === 1 ? '' : 's'} owned by this {entity.kind}.
          </li>
          <li>
            Remove <strong>{rels.length}</strong> relationship{rels.length === 1 ? '' : 's'} that point to or from it.
          </li>
          <li>
            {children.length === 0 ? 'It has no children.' : (
              <>
                Move its <strong>{children.length}</strong> child{children.length === 1 ? '' : 'ren'} up to {grand ? <>“{grand.name}”</> : 'the top level'}.
              </>
            )}
          </li>
          <li>Test definitions are not affected.</li>
        </ul>
        {refs.length > 0 && (
          <Callout.Root size="1" variant="surface">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              {refs.slice(0, 5).map((r, i) => (
                <span key={i} style={{ display: 'block' }}>
                  {r}
                </span>
              ))}
              {refs.length > 5 && `…and ${refs.length - 5} more`}
            </Callout.Text>
          </Callout.Root>
        )}
      </Flex>
    </Confirm>
  );
}
