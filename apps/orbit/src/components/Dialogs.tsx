import { useEffect, useState } from 'react';
import { Button, Checkbox, Dialog, Flex, Kbd, Text, TextArea, TextField } from '@radix-ui/themes';
import { useProjectSkills } from './ProjectSkills';
import { slugify } from '../lib/format';
import { useApp, useCtrl, useDispatch, useEdit } from '../state/context';

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
  const [installSkills, setInstallSkills] = useState(false);
  const skills = useProjectSkills();
  useEffect(() => {
    if (open) {
      setName('');
      setId('');
      setIdTouched(false);
      setSummary('');
      setInstallSkills(false);
    }
  }, [open]);
  const valid = name.trim() && id.trim() && summary.trim();
  const close = (o: boolean) => d({ type: 'ui', patch: { newDialog: o } });
  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      const ok = await ctrl.createNew({ id: id.trim(), name: name.trim(), summary: summary.trim() });
      if (ok) {
        close(false);
        if (installSkills) void skills?.installForNewProject();
      }
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
            {skills?.available && (
              <Text as="label" size="2">
                <Flex gap="2" align="center">
                  <Checkbox checked={installSkills} onCheckedChange={(value) => setInstallSkills(value === true)} />
                  Install Orbit skills for Claude Code
                </Flex>
              </Text>
            )}
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
