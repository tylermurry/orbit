import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertDialog, Badge, Button, Code, Dialog, Flex, IconButton, Text, TextArea, TextField, Tooltip } from '@radix-ui/themes';
import { CheckCircledIcon, CheckIcon, CircleIcon, Cross2Icon, CrossCircledIcon, CopyIcon, ExclamationTriangleIcon, MinusCircledIcon, ClockIcon } from '@radix-ui/react-icons';
import type { BehaviorStatus, Entity, EntityChangeStatus, EntityKind, TestResult, TestStatus } from '@orbit/contract';
import { KIND_LABEL, STATUS_LABEL } from '../lib/model';
import { relativeTime } from '../lib/format';
import { wordDiff } from '../lib/format';
import { useApp, useDispatch } from '../state/context';

export function KindBadge({ kind }: { kind: EntityKind }) {
  return (
    <Badge color={kind === 'capability' ? 'indigo' : 'cyan'} variant="soft" radius="full">
      {KIND_LABEL[kind]}
    </Badge>
  );
}

const STATUS_COLOR: Record<BehaviorStatus, 'red' | 'green' | 'amber' | 'violet' | 'gray'> = {
  failing: 'red',
  passing: 'green',
  unconfirmed: 'amber',
  planned: 'violet',
  untested: 'gray',
};

export function StatusIcon({ status, size = 14 }: { status: BehaviorStatus; size?: number }) {
  const p = { width: size, height: size, 'aria-hidden': true } as const;
  switch (status) {
    case 'failing':
      return <CrossCircledIcon {...p} />;
    case 'passing':
      return <CheckCircledIcon {...p} />;
    case 'unconfirmed':
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

const TEST_BADGE: Record<TestStatus, { label: string; color: 'green' | 'red' | 'amber' | 'violet'; icon: ReactNode }> = {
  passing: { label: 'Passing', color: 'green', icon: <CheckIcon aria-hidden /> },
  failing: { label: 'Failing', color: 'red', icon: <Cross2Icon aria-hidden /> },
  unconfirmed: { label: 'Unconfirmed', color: 'amber', icon: <MinusCircledIcon aria-hidden /> },
  planned: { label: 'Planned', color: 'violet', icon: <ClockIcon aria-hidden /> },
  undefined: { label: 'Undefined', color: 'amber', icon: <ExclamationTriangleIcon aria-hidden /> },
};

/** Why a test has its status, in plain words (shown on hover). */
export function testStatusReason(status: TestStatus, result: TestResult | undefined, since: string | null): string {
  const when = result ? relativeTime(result.at) : '';
  switch (status) {
    case 'passing':
      return `Passed in the last test run (${when}).`;
    case 'failing':
      return `Failed in the last test run (${when})${result?.message ? `: ${result.message}` : '.'}`;
    case 'planned':
      return 'Placeholder: this test is planned but not written yet. It does not count as coverage.';
    case 'undefined':
      return 'This test id is not defined in the contract.';
    case 'unconfirmed':
      if (!result) return 'No result yet: this test was not found in the latest test results. Run Validate.';
      if (result.status === 'skipped') return `Skipped in the last test run (${when}).`;
      return since ? `The last result (${when}) is older than the proposal. Run Validate to confirm it.` : 'No current result.';
  }
}

/** A test's status: Passing (green), Failing (red), Unconfirmed (yellow) or Planned (violet). */
export function TestStatusBadge({ status, reason }: { status: TestStatus; reason?: string }) {
  const b = TEST_BADGE[status];
  const badge = (
    <Badge color={b.color} variant="soft" radius="full" data-testid="test-status" data-test-status={status}>
      {b.icon}
      {b.label}
    </Badge>
  );
  return reason ? <Tooltip content={reason}>{badge}</Tooltip> : badge;
}

/** Marks a placeholder test: planned by a proposal, not implemented yet. */
export function PlannedBadge() {
  return <TestStatusBadge status="planned" reason={testStatusReason('planned', undefined, null)} />;
}

export const CHANGE_INFO: Record<EntityChangeStatus, { symbol: string; letter: string; label: string; color: 'green' | 'amber' | 'red' | 'violet' | 'gray' }> = {
  added: { symbol: '＋', letter: 'A', label: 'Added', color: 'green' },
  modified: { symbol: '●', letter: 'M', label: 'Modified', color: 'amber' },
  removed: { symbol: '−', letter: 'R', label: 'Removed', color: 'red' },
  affected: { symbol: '◇', letter: 'P', label: 'Potentially affected', color: 'violet' },
  unchanged: { symbol: '', letter: '', label: 'Unchanged', color: 'gray' },
};

/** The one badge used everywhere for a change status; same shape and size as every other Badge in the app. */
export function ChangePill({ status, long, label }: { status: EntityChangeStatus; long?: boolean; label?: string }) {
  if (status === 'unchanged') return null;
  const i = CHANGE_INFO[status];
  return (
    <Badge color={i.color === 'gray' ? 'gray' : i.color} variant="soft" radius="full" role="img" aria-label={label ?? i.label} data-change={status}>
      <span aria-hidden>{i.symbol}</span>
      <span aria-hidden>{label ?? (long ? i.label : i.letter)}</span>
    </Badge>
  );
}

export function ChangeMarker({ status, long }: { status: EntityChangeStatus; long?: boolean }) {
  if (status === 'unchanged') return null;
  return (
    <Tooltip content={CHANGE_INFO[status].label}>
      <span className="pill-wrap">
        <ChangePill status={status} long={long} />
      </span>
    </Tooltip>
  );
}

export function Legend({ planned }: { planned?: boolean }) {
  const items: EntityChangeStatus[] = ['added', 'modified', 'removed', 'affected'];
  return (
    <Flex gap="3" wrap="wrap" align="center" aria-label="Legend" role="group">
      {items.map((s) => (
        <Flex key={s} gap="1" align="center">
          <ChangePill status={s} long label={s === 'added' && planned ? 'Planned' : undefined} />
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


/**
 * A borderless, auto-growing text editor that reads like a plain document. Commits on blur
 * (and on Enter when `singleLine`); Escape reverts.
 */
export function InlineText({ value, onCommit, label, placeholder, disabled, singleLine, validate, className, autoFocusSelect, onDone }: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  singleLine?: boolean;
  validate?: (v: string) => boolean;
  className?: string;
  /** Focus and select the text on mount (used for freshly created items). */
  autoFocusSelect?: boolean;
  /** Called when editing ends (blur, Enter or Escape). Escape discards the draft. */
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (autoFocusSelect) {
      ref.current?.focus();
      ref.current?.select();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => setDraft(value), [value]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);
  const commit = () => {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(value);
      return;
    }
    const v = singleLine ? draft.trim() : draft.replace(/\s+$/, '');
    if (v === value) return setDraft(value);
    if (validate && !validate(v)) return setDraft(value);
    onCommit(v);
  };
  return (
    <textarea
      ref={ref}
      rows={1}
      className={`inline-text ${className ?? ''}`}
      aria-label={label}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      spellCheck
      onChange={(e) => setDraft(singleLine ? e.target.value.replace(/\n/g, ' ') : e.target.value)}
      onBlur={() => {
        commit();
        onDone?.();
      }}
      onKeyDown={(e) => {
        if (singleLine && e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (onDone) {
            cancelled.current = true;
            e.currentTarget.blur();
          } else setDraft(value);
        }
      }}
    />
  );
}

/** One-line summary kept in sync with the description (the schema still requires a non-empty summary). */
export function summaryFrom(description: string, fallback: string): string {
  const first = description.split('\n').map((l) => l.trim()).find(Boolean);
  return first ? (first.length > 200 ? `${first.slice(0, 197)}…` : first) : fallback;
}

/** Read-only word diff of a text field, deletions struck through and additions highlighted. */
export function TextDiff({ before, after, label, className }: { before: string; after: string; label: string; className: string }) {
  const parts = useMemo(() => wordDiff(before, after), [before, after]);
  return (
    <div className={`text-diff ${className}`} role="group" aria-label={label} data-testid="text-diff">
      {parts.map((p, i) => (p.type === 'same' ? <span key={i}>{p.text}</span> : p.type === 'del' ? <del key={i}>{p.text}</del> : <ins key={i}>{p.text}</ins>))}
    </div>
  );
}
