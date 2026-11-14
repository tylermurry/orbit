import { useMemo, useState } from 'react';
import { Button, Flex, Popover, Text, TextField } from '@radix-ui/themes';
import { CheckIcon, ChevronDownIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import type { Entity, OrbitContract } from '@orbit/contract';
import { ancestorsOf } from '@orbit/contract';
import { KindBadge } from './common';

export function EntityPicker({ contract, value, onChange, allow, noneLabel, label, showKind, disabled, triggerWidth }: {
  contract: OrbitContract;
  value: string | null;
  onChange: (id: string | null) => void;
  /** Return false to exclude an entity from the list. */
  allow: (e: Entity) => boolean;
  /** When set, a "none" option is offered (e.g. "No parent (top level)"). */
  noneLabel?: string;
  label: string;
  showKind?: boolean;
  disabled?: boolean;
  triggerWidth?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = value ? contract.entities.find((e) => e.id === value) : null;
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return contract.entities
      .filter(allow)
      .filter((e) => !needle || e.name.toLowerCase().includes(needle) || e.id.toLowerCase().includes(needle))
      .map((e) => ({ e, path: ancestorsOf(contract, e.id).reverse().map((a) => a.name).join(' › ') }))
      .sort((a, b) => (a.path ? a.path + ' › ' : '').concat(a.e.name).localeCompare((b.path ? b.path + ' › ' : '').concat(b.e.name)));
  }, [contract, allow, q]);

  const pick = (id: string | null) => {
    onChange(id);
    setOpen(false);
    setQ('');
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQ('');
      }}
    >
      <Popover.Trigger>
        <Button variant="surface" color="gray" size="2" disabled={disabled} aria-label={`${label}: ${current?.name ?? noneLabel ?? 'none selected'}`} aria-haspopup="listbox" style={{ justifyContent: 'space-between', width: triggerWidth }}>
          <span className="truncate">{current ? current.name : (noneLabel ?? 'Select…')}</span>
          <ChevronDownIcon aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Content width="340px" style={{ padding: 8 }} onOpenAutoFocus={(e) => e.preventDefault()}>
        <TextField.Root autoFocus size="2" placeholder="Search by name or id…" aria-label={`Search ${label}`} value={q} onChange={(e) => setQ(e.target.value)}>
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
        </TextField.Root>
        <div className="picker-list" role="listbox" aria-label={label}>
          {noneLabel && !q && (
            <button type="button" role="option" aria-selected={value === null} className="picker-option" onClick={() => pick(null)}>
              <span>{noneLabel}</span>
              {value === null && <CheckIcon />}
            </button>
          )}
          {options.map(({ e, path }) => (
            <button key={e.id} type="button" role="option" aria-selected={e.id === value} className="picker-option" onClick={() => pick(e.id)}>
              <span style={{ minWidth: 0 }}>
                <span className="truncate" style={{ display: 'block' }}>
                  {e.name}
                </span>
                {path && (
                  <Text size="1" color="gray" className="truncate" style={{ display: 'block' }}>
                    {path}
                  </Text>
                )}
              </span>
              <Flex gap="2" align="center">
                {showKind && <KindBadge kind={e.kind} />}
                {e.id === value && <CheckIcon />}
              </Flex>
            </button>
          ))}
          {options.length === 0 && (
            <Text size="2" color="gray" as="div" style={{ padding: 8 }}>
              No matching entities.
            </Text>
          )}
        </div>
      </Popover.Content>
    </Popover.Root>
  );
}
