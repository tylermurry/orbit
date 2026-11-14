import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Callout, Code, Dialog, Flex, Kbd, Text, TextArea, TextField } from '@radix-ui/themes';
import { CrossCircledIcon, ExclamationTriangleIcon } from '@radix-ui/react-icons';
import type { Diagnostic } from '@orbit/contract';
import { slugify } from '../lib/format';
import { requestRawJump } from '../lib/rawJump';
import { useApp, useAppState, useCtrl, useDiagnostics, useDispatch, useEdit } from '../state/context';
import { Sheet } from './common';

export function Field({ label, children, hint, error }: { label: string; children: React.ReactNode; hint?: string; error?: string }) {
  return (
    <label className="field">
      <Text as="div" size="2" weight="medium" mb="1">
        {label}
      </Text>
      {children}
      {error ? (
        <Text as="div" size="1" color="red" mt="1">
          {error}
        </Text>
      ) : hint ? (
        <Text as="div" size="1" color="gray" mt="1">
          {hint}
        </Text>
      ) : null}
    </label>
  );
}

export function ProductDialog() {
  const open = useApp((s) => s.productDialog);
  const product = useApp((s) => s.contract?.product);
  const readOnly = useApp((s) => s.loadedInvalid);
  const d = useDispatch();
  const edit = useEdit();
  const [draft, setDraft] = useState({ id: '', name: '', summary: '', description: '' });
  useEffect(() => {
    if (open && product) setDraft({ id: product.id, name: product.name, summary: product.summary, description: product.description ?? '' });
  }, [open, product]);
  const valid = draft.id.trim() && draft.name.trim() && draft.summary.trim();
  const close = (o: boolean) => d({ type: 'ui', patch: { productDialog: o } });
  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>Product settings</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Describes the product this contract models. {readOnly && 'The file has errors and is read-only.'}
        </Dialog.Description>
        <Flex direction="column" gap="3">
          <Field label="Name">
            <TextField.Root aria-label="Product name" value={draft.name} disabled={readOnly} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>
          <Field label="Id" hint="A stable identifier. Changing it does not affect entities.">
            <TextField.Root aria-label="Product id" value={draft.id} disabled={readOnly} style={{ fontFamily: 'var(--code-font-family)' }} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
          </Field>
          <Field label="Summary">
            <TextField.Root aria-label="Product summary" value={draft.summary} disabled={readOnly} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </Field>
          <Field label="Description (optional)">
            <TextArea aria-label="Product description" rows={4} value={draft.description} disabled={readOnly} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
          </Field>
        </Flex>
        <Flex gap="3" mt="4" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </Dialog.Close>
          <Button
            disabled={!valid || readOnly}
            onClick={() => {
              edit((c) => ({
                ...c,
                product: {
                  id: draft.id.trim(),
                  name: draft.name.trim(),
                  summary: draft.summary.trim(),
                  ...(draft.description.trim() ? { description: draft.description } : {}),
                },
              }));
              close(false);
            }}
          >
            Apply
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function NewContractDialog() {
  const open = useApp((s) => s.newDialog);
  const ctrl = useCtrl();
  const d = useDispatch();
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setName('');
      setId('');
      setIdTouched(false);
      setSummary('');
    }
  }, [open]);
  const valid = name.trim() && id.trim() && summary.trim();
  const close = (o: boolean) => d({ type: 'ui', patch: { newDialog: o } });
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const ok = await ctrl.createNew({ id: id.trim(), name: name.trim(), summary: summary.trim() });
      if (ok) close(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Create new contract</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Orbit writes a valid, empty contract to a file you choose, then opens it.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Flex direction="column" gap="3">
            <Field label="Product name">
              <TextField.Root
                aria-label="Product name"
                autoFocus
                placeholder="e.g. Tasky"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!idTouched) setId(e.target.value.trim() ? slugify(e.target.value) : '');
                }}
              />
            </Field>
            <Field label="Product id" hint="Stable identifier, suggested from the name.">
              <TextField.Root
                aria-label="Product id"
                value={id}
                style={{ fontFamily: 'var(--code-font-family)' }}
                onChange={(e) => {
                  setId(e.target.value);
                  setIdTouched(true);
                }}
              />
            </Field>
            <Field label="Summary">
              <TextField.Root aria-label="Product summary" placeholder="One sentence about what the product does" value={summary} onChange={(e) => setSummary(e.target.value)} />
            </Field>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!valid || busy}>
              Choose location &amp; create…
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Mod+O', 'Open contract'],
  ['Mod+S', 'Save'],
  ['Shift+Mod+S', 'Save As'],
  ['Mod+1 / 2 / 3', 'Product / Engineering / Impact'],
  ['Mod+F', 'Search the tree'],
  ['Mod+Z', 'Undo structured edit'],
  ['Shift+Mod+Z', 'Redo (also Ctrl+Y)'],
  ['↑ ↓', 'Move in the tree'],
  ['→ / ←', 'Expand or enter / collapse or go to parent'],
  ['Home / End', 'First / last tree item'],
  ['Enter', 'Select the focused tree item'],
  ['?', 'Show this help'],
];

export function ShortcutsDialog() {
  const open = useApp((s) => s.shortcutsOpen);
  const d = useDispatch();
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  return (
    <Dialog.Root open={open} onOpenChange={(o) => d({ type: 'ui', patch: { shortcutsOpen: o } })}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Keyboard shortcuts</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Orbit is fully keyboard accessible. Inside text fields, the native undo applies.
        </Dialog.Description>
        <div className="shortcut-grid">
          {SHORTCUTS.map(([k, label]) => (
            <div key={k} style={{ display: 'contents' }}>
              <span>
                {k.split(' / ').map((part, i) => (
                  <span key={i}>
                    {i > 0 && ' / '}
                    <Kbd>{part.replace(/Mod/g, isMac ? '⌘' : 'Ctrl')}</Kbd>
                  </span>
                ))}
              </span>
              <Text size="2">{label}</Text>
            </div>
          ))}
        </div>
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft">Close</Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** Try to map a JSON pointer to an entity (and behavior) so a diagnostic can jump to the field. */
function resolveTarget(text: string, path: string): { entityId: string; behaviorId?: string } | null {
  const m = /^\/entities\/(\d+)(?:\/behaviors\/(\d+))?/.exec(path);
  if (!m) return null;
  try {
    const raw = JSON.parse(text) as { entities?: { id?: string; behaviors?: { id?: string }[] }[] };
    const e = raw.entities?.[Number(m[1])];
    if (!e?.id) return null;
    const b = m[2] !== undefined ? e.behaviors?.[Number(m[2])]?.id : undefined;
    return { entityId: e.id, behaviorId: b };
  } catch {
    return null;
  }
}

export function DiagnosticsSheet() {
  const s = useAppState();
  const diagnostics = useDiagnostics();
  const d = useDispatch();
  const sorted = useMemo(() => [...diagnostics].sort((a, b) => (a.severity === b.severity ? (a.line ?? 0) - (b.line ?? 0) : a.severity === 'error' ? -1 : 1)), [diagnostics]);
  const errors = diagnostics.filter((x) => x.severity === 'error').length;
  const warnings = diagnostics.length - errors;

  const toRaw = (x: Diagnostic) => {
    d({ type: 'setRawMode', on: true });
    d({ type: 'ui', patch: { diagnosticsOpen: false } });
    requestRawJump({ line: x.line ?? 1, column: x.column ?? 1 });
  };
  const jump = (x: Diagnostic) => {
    const text = s.rawDraft ?? s.diskText;
    const t = !s.loadedInvalid || s.rawDraft === null ? resolveTarget(text, x.path) : null;
    const known = t && s.contract?.entities.find((e) => e.id === t.entityId);
    if (known && !s.rawMode && s.rawDraft === null) {
      d({ type: 'selectEntity', id: known.id, kind: known.kind, behaviorId: t.behaviorId ?? null });
      d({ type: 'ui', patch: { diagnosticsOpen: false } });
    } else toRaw(x);
  };

  return (
    <Sheet open={s.diagnosticsOpen} onOpenChange={(o) => d({ type: 'ui', patch: { diagnosticsOpen: o } })} title="Diagnostics" description={diagnostics.length === 0 ? 'No problems found.' : `${errors} error${errors === 1 ? '' : 's'}, ${warnings} warning${warnings === 1 ? '' : 's'}`}>
      {diagnostics.length === 0 ? (
        <Callout.Root color="green" variant="surface">
          <Callout.Text>The contract is valid.</Callout.Text>
        </Callout.Root>
      ) : (
        <ul className="diag-list" aria-label="Diagnostics">
          {sorted.map((x, i) => (
            <li key={i} className="diag-item" data-severity={x.severity}>
              <button type="button" className="diag-main" onClick={() => jump(x)}>
                <span className="diag-icon" aria-label={x.severity}>
                  {x.severity === 'error' ? <CrossCircledIcon color="var(--red-10)" /> : <ExclamationTriangleIcon color="var(--amber-10)" />}
                </span>
                <span>
                  <Text as="div" size="2">
                    {x.message}
                  </Text>
                  <Text as="div" size="1" color="gray">
                    <Code variant="ghost" size="1">
                      {x.code}
                    </Code>
                    {x.path ? <> · {x.path}</> : null}
                  </Text>
                </span>
              </button>
              {x.line !== undefined && (
                <Button size="1" variant="ghost" color="gray" onClick={() => toRaw(x)} aria-label={`Show line ${x.line} in Raw JSON`}>
                  Line {x.line}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Text as="p" size="1" color="gray" mt="3">
        <Badge variant="outline" color="gray" mr="1">
          Tip
        </Badge>
        Orbit never repairs files automatically. Fix errors in Raw JSON or the structured views.
      </Text>
    </Sheet>
  );
}
