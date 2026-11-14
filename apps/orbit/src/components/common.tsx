import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertDialog, Badge, Button, Code, Dialog, Flex, IconButton, Text, TextArea, TextField, Tooltip } from '@radix-ui/themes';
import {
  CheckCircledIcon,
  CheckIcon,
  CircleIcon,
  ClockIcon,
  Cross2Icon,
  CrossCircledIcon,
  CopyIcon,
  MinusCircledIcon,
} from '@radix-ui/react-icons';
import type { BehaviorStatus, Entity, EntityChangeStatus, EntityKind, EvidenceStatus, Freshness } from '@orbit/contract';
import { EVIDENCE_LABEL, KIND_LABEL, STATUS_LABEL } from '../lib/model';
import { useApp, useDispatch } from '../state/context';

export function KindBadge({ kind }: { kind: EntityKind }) {
  return (
    <Badge color={kind === 'capability' ? 'indigo' : 'cyan'} variant="soft" radius="small">
      {KIND_LABEL[kind]}
    </Badge>
  );
}

const STATUS_COLOR: Record<BehaviorStatus, 'red' | 'green' | 'amber' | 'gray'> = {
  failing: 'red',
  passing: 'green',
  'no-current-evidence': 'amber',
  untested: 'gray',
};

export function StatusIcon({ status, size = 14 }: { status: BehaviorStatus; size?: number }) {
  const p = { width: size, height: size, 'aria-hidden': true } as const;
  switch (status) {
    case 'failing':
      return <CrossCircledIcon {...p} />;
    case 'passing':
      return <CheckCircledIcon {...p} />;
    case 'no-current-evidence':
      return <MinusCircledIcon {...p} />;
    default:
      return <CircleIcon {...p} />;
  }
}

export function StatusPill({ status }: { status: BehaviorStatus }) {
  return (
    <Badge color={STATUS_COLOR[status]} variant="soft" radius="full" data-status={status}>
      <StatusIcon status={status} size={12} />
      {STATUS_LABEL[status]}
    </Badge>
  );
}

const EV_COLOR: Record<EvidenceStatus, 'green' | 'red' | 'gray' | 'orange'> = { passed: 'green', failed: 'red', skipped: 'gray', error: 'orange' };

export function EvidenceStatusBadge({ status }: { status: EvidenceStatus }) {
  const icon = status === 'passed' ? <CheckIcon aria-hidden /> : status === 'skipped' ? <MinusCircledIcon aria-hidden /> : <Cross2Icon aria-hidden />;
  return (
    <Badge color={EV_COLOR[status]} variant="soft" radius="full">
      {icon}
      {EVIDENCE_LABEL[status]}
    </Badge>
  );
}

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const label = freshness === 'current' ? 'Current' : freshness === 'stale' ? 'Potentially outdated' : 'Freshness unknown';
  const color = freshness === 'current' ? 'green' : freshness === 'stale' ? 'amber' : 'gray';
  return (
    <Badge color={color} variant="outline" radius="full">
      <ClockIcon aria-hidden />
      {label}
    </Badge>
  );
}

export const CHANGE_INFO: Record<EntityChangeStatus, { symbol: string; letter: string; label: string; color: 'green' | 'amber' | 'red' | 'violet' | 'gray' }> = {
  added: { symbol: '＋', letter: 'A', label: 'Added', color: 'green' },
  modified: { symbol: '●', letter: 'M', label: 'Modified', color: 'amber' },
  removed: { symbol: '−', letter: 'R', label: 'Removed', color: 'red' },
  affected: { symbol: '◇', letter: 'P', label: 'Potentially affected', color: 'violet' },
  unchanged: { symbol: '', letter: '', label: 'Unchanged', color: 'gray' },
};

export function ChangeMarker({ status, long }: { status: EntityChangeStatus; long?: boolean }) {
  if (status === 'unchanged') return null;
  const i = CHANGE_INFO[status];
  return (
    <Tooltip content={i.label}>
      <span className={`marker marker-${status}`} role="img" aria-label={i.label} data-change={status}>
        <span aria-hidden>{i.symbol}</span>
        <span aria-hidden>{long ? i.label : i.letter}</span>
      </span>
    </Tooltip>
  );
}

export function Legend() {
  const items: EntityChangeStatus[] = ['added', 'modified', 'removed', 'affected'];
  return (
    <Flex gap="3" wrap="wrap" align="center" aria-label="Legend" role="group">
      {items.map((s) => (
        <Flex key={s} gap="1" align="center">
          <span className={`marker marker-${s}`}>
            <span aria-hidden>{CHANGE_INFO[s].symbol}</span>
            <span aria-hidden>{CHANGE_INFO[s].letter}</span>
          </span>
          <Text size="1" color="gray">
            {CHANGE_INFO[s].label}
          </Text>
        </Flex>
      ))}
    </Flex>
  );
}

/** Text input that commits on blur / Enter and reverts on Escape (keeps undo history clean). */
export function DraftField({ value, onCommit, label, placeholder, size = '2', mono, disabled, validate, className }: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  size?: '1' | '2' | '3';
  mono?: boolean;
  disabled?: boolean;
  validate?: (v: string) => boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    const v = draft.trim() === draft ? draft : draft.trim();
    if (v === value) return setDraft(value);
    if (validate && !validate(v)) return setDraft(value);
    onCommit(v);
  };
  return (
    <TextField.Root
      className={className}
      size={size}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      style={mono ? { fontFamily: 'var(--code-font-family)' } : undefined}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

export function DraftArea({ value, onCommit, label, placeholder, rows = 3, disabled }: { value: string; onCommit: (v: string) => void; label: string; placeholder?: string; rows?: number; disabled?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextArea
      aria-label={label}
      placeholder={placeholder}
      rows={rows}
      value={draft}
      disabled={disabled}
      resize="vertical"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          setDraft(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

export function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip content={copied ? 'Copied' : 'Copy id'}>
      <Button
        variant="ghost"
        size="1"
        color="gray"
        className="copy-id"
        aria-label={`Copy id ${id}`}
        onClick={() => {
          void navigator.clipboard?.writeText(id).catch(() => undefined);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
      >
        <Code variant="ghost" size="1">
          {id}
        </Code>
        <CopyIcon aria-hidden />
      </Button>
    </Tooltip>
  );
}

export function Sheet({ open, onOpenChange, title, description, children, width = 460 }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; width?: number }) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content className="orbit-sheet" style={{ width, maxWidth: '100vw' }} aria-describedby={undefined}>
        <Flex justify="between" align="start" mb="3">
          <div>
            <Dialog.Title size="4" mb="1">
              {title}
            </Dialog.Title>
            {description && (
              <Text size="2" color="gray">
                {description}
              </Text>
            )}
          </div>
          <Dialog.Close>
            <IconButton variant="ghost" color="gray" aria-label="Close">
              <Cross2Icon />
            </IconButton>
          </Dialog.Close>
        </Flex>
        {children}
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function Confirm({ open, onOpenChange, title, children, confirmLabel, cancelLabel = 'Cancel', onConfirm, danger, maxWidth = '480px' }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  danger?: boolean;
  maxWidth?: string;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Content maxWidth={maxWidth}>
        <AlertDialog.Title>{title}</AlertDialog.Title>
        <AlertDialog.Description size="2" {...({ as: 'div' } as Record<string, unknown>)}>
          {children}
        </AlertDialog.Description>
        <Flex gap="3" mt="4" justify="end">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              {cancelLabel}
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button color={danger ? 'red' : undefined} onClick={onConfirm}>
              {confirmLabel}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}

/** Looks up an entity by id in the working contract, falling back to comparison snapshots (ghosts). */
export function useEntityLookup(): (id: string) => Entity | undefined {
  const contract = useApp((s) => s.contract);
  const result = useApp((s) => s.compareResult);
  const diff = result && result.status === 'ready' ? result.diff : null;
  return useMemo(() => {
    const m = new Map<string, Entity>();
    diff?.base?.entities.forEach((e) => m.set(e.id, e));
    diff?.target?.entities.forEach((e) => m.set(e.id, e));
    contract?.entities.forEach((e) => m.set(e.id, e));
    return (id: string) => m.get(id);
  }, [contract, diff]);
}

export function EntityLink({ id, name, behaviorId }: { id: string; name?: string; behaviorId?: string }) {
  const lookup = useEntityLookup();
  const d = useDispatch();
  const e = lookup(id);
  if (!e) return <Text size="2">{name ?? id}</Text>;
  return (
    <Button
      variant="ghost"
      size="1"
      className="entity-link"
      onClick={() => d({ type: 'selectEntity', id, kind: e.kind, behaviorId })}
      aria-label={`Go to ${e.name}`}
    >
      {name ?? e.name}
    </Button>
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const d = useDispatch();
  return (
    <div className="toasts" role="status" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.tone}`} data-testid="toast">
          <span>{t.message}</span>
          <IconButton size="1" variant="ghost" color="gray" aria-label="Dismiss notification" onClick={() => d({ type: 'dismissToast', id: t.id })}>
            <Cross2Icon />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

