import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Callout, Checkbox, Flex, IconButton, Text, TextField, Tooltip, Dialog } from '@radix-ui/themes';
import { ChevronDownIcon, ChevronRightIcon, Cross2Icon, ExclamationTriangleIcon, ExternalLinkIcon, Link2Icon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { allIds, behaviorAssurance, generateId } from '@orbit/contract';
import type { AssuranceSummary, Behavior, Entity, OrbitContract } from '@orbit/contract';
import { useApp, useAssuranceCtx, useCtrl, useDispatch, useEdit, useHost } from '../state/context';
import { BUCKET_LABEL } from './AssuranceSection';
import type { Bucket } from './AssuranceSection';
import { Confirm, EntityLink, InlineText, TestStatusBadge, testStatusReason } from './common';

/** Absolute path of the file a test location points at, e.g. "tests/a.spec.ts › does x" or "a.ts#fn" or "a.ts:42". */
export function testFilePath(location: string, baseDir: string | null): string | null {
  const file = location
    .split(/ › |#|::/)[0]
    .replace(/:\d+(:\d+)?$/, '')
    .trim();
  if (!file) return null;
  if (file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(file)) return file;
  return baseDir ? `${baseDir.replace(/[\\/]+$/, '')}/${file}` : null;
}

/** Entities with behaviors that map to a test, not counting the behavior being viewed (so its own entity appears only if it uses the test elsewhere too). */
function testUsage(contract: OrbitContract, testId: string, exceptBehaviorId: string) {
  return contract.entities.map((e) => ({ entity: e, behaviors: e.behaviors.filter((b) => b.id !== exceptBehaviorId && b.testIds.includes(testId)) })).filter((x) => x.behaviors.length > 0);
}

function TestLinksDialog({ contract, testId, testName, exceptBehaviorId, onClose }: { contract: OrbitContract; testId: string; testName: string; exceptBehaviorId: string; onClose: () => void }) {
  const d = useDispatch();
  const usage = useMemo(() => testUsage(contract, testId, exceptBehaviorId), [contract, testId, exceptBehaviorId]);
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="520px" onClick={(e) => e.stopPropagation()}>
        <Dialog.Title>Links</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Other behaviors, in capabilities and systems, that use “{testName}”.
        </Dialog.Description>
        <ul className="link-list" data-testid="test-links">
          {usage.map(({ entity, behaviors }) => (
            <li key={entity.id}>
              <button
                type="button"
                className="link-item"
                onClick={() => {
                  d({ type: 'selectEntity', id: entity.id, kind: entity.kind, behaviorId: behaviors[0]!.id });
                  onClose();
                }}
              >
                <span className="link-item-name">{entity.name}</span>
                <span className="link-item-meta">{behaviors.map((b) => b.name).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}

/** One behavior as an outline item: chevron, editable text, and its tests as bullets beneath. */
function BehaviorRow({
  contract,
  behavior,
  owner,
  own,
  readOnly,
  focused,
  scrollTo,
  autoFocus,
  open,
  onOpenChange,
  onDelete,
  onMap,
}: {
  contract: OrbitContract;
  behavior: Behavior;
  owner: Entity;
  own: boolean;
  readOnly: boolean;
  focused: boolean;
  /** Scroll this row into view when it becomes focused (only one of several focused rows should). */
  scrollTo: boolean;
  autoFocus: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => void;
  onMap: () => void;
}) {
  const setOpen = onOpenChange;
  const [editing, setEditing] = useState(autoFocus);
  const [linksFor, setLinksFor] = useState<{ id: string; name: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const d = useDispatch();
  const ctrl = useCtrl();
  const edit = useEdit();
  const host = useHost();
  const filePath = useApp((s) => s.filePath);
  const repoRoot = useApp((s) => s.git?.repoRoot);
  const baseDir = repoRoot ?? (filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : null);
  const openTest = (location: string) => {
    const abs = testFilePath(location, baseDir);
    if (!abs) return ctrl.toast('Cannot tell which file this test lives in.', 'error');
    host.openInEditor(abs).catch((e: unknown) => ctrl.toast(e instanceof Error ? e.message : String(e), 'error'));
  };
  const actx = useAssuranceCtx();
  const ba = useMemo(() => behaviorAssurance(contract, behavior.id, actx), [contract, behavior.id, actx]);
  useEffect(() => {
    if (focused) {
      if (scrollTo) ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      const t = setTimeout(() => d({ type: 'clearFocusBehavior' }), 2500);
      return () => clearTimeout(t);
    }
  }, [focused, scrollTo, d]);

  const editable = !readOnly && own;
  const rename = (name: string) =>
    // The schema still stores an "expected" text; keep it identical to the behavior text.
    edit((c) => ({
      ...c,
      entities: c.entities.map((e) =>
        e.id !== owner.id
          ? e
          : {
              ...e,
              behaviors: e.behaviors.map((b) => (b.id === behavior.id ? { ...b, name, expected: name } : b)),
            },
      ),
    }));
  const unmap = (testId: string) =>
    edit((c) => ({
      ...c,
      entities: c.entities.map((e) =>
        e.id !== owner.id
          ? e
          : {
              ...e,
              behaviors: e.behaviors.map((b) => (b.id === behavior.id ? { ...b, testIds: b.testIds.filter((t) => t !== testId) } : b)),
            },
      ),
    }));
  const tests = ba?.tests ?? [];

  return (
    <div
      ref={ref}
      className={`bh${focused ? ' flash' : ''}`}
      data-testid="behavior-card"
      data-behavior-id={behavior.id}
      data-status={ba?.status ?? 'untested'}
      tabIndex={-1}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('textarea, button, a')) setOpen(!open);
      }}
    >
      <div className="bh-head">
        <button type="button" className="bh-chevron" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${behavior.name}`} onClick={() => setOpen(!open)}>
          {open ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </button>
        <div className="bh-text">
          <div className="bh-titlerow">
            {editing && editable ? (
              <InlineText
                value={behavior.name}
                label="Behavior"
                singleLine
                validate={(v) => v.trim().length > 0}
                onCommit={rename}
                onDone={() => setEditing(false)}
                className="bh-name"
                autoFocusSelect
              />
            ) : (
              <div className="bh-title">
                <span className="bh-name-text">{behavior.name}</span>
                {editable && (
                  <Tooltip content="Edit text">
                    <IconButton size="1" variant="ghost" color="gray" className="bh-edit" aria-label={`Edit ${behavior.name}`} onClick={() => setEditing(true)}>
                      <Pencil1Icon />
                    </IconButton>
                  </Tooltip>
                )}
              </div>
            )}
          </div>
          {!own && (
            <div className="bh-meta">
              {!own && (
                <Text size="1" color="gray">
                  Owned by <EntityLink id={owner.id} behaviorId={behavior.id} />
                </Text>
              )}
            </div>
          )}
        </div>
        {editable && (
          <Tooltip content="Delete behavior">
            <IconButton size="1" variant="ghost" color="red" className="bh-delete" aria-label={`Delete behavior ${behavior.name}`} onClick={onDelete}>
              <TrashIcon />
            </IconButton>
          </Tooltip>
        )}
      </div>
      {open && (
        <ul className="bh-tests">
          {tests.length === 0 && (
            <li className="bh-empty">
              <Badge color="amber" variant="soft" radius="full" data-testid="missing-test">
                <ExclamationTriangleIcon aria-hidden />
                Missing
              </Badge>
              No tests yet
            </li>
          )}
          {tests.map((t) => {
            const links = testUsage(contract, t.testId, behavior.id).length;
            return (
              <li key={t.testId} data-testid="test-row" className="bh-test" data-placeholder={t.test?.placeholder ? 'true' : undefined}>
                <div className="bh-test-row">
                  <span className="bh-test-main">
                    <TestStatusBadge status={t.status} reason={testStatusReason(t.status, t.result, actx.since)} />
                    <span className="bh-test-name">{t.test?.name ?? t.testId}</span>
                    {links > 0 && (
                      <Tooltip content="Other capabilities that use this test">
                        <button
                          type="button"
                          className="links-badge"
                          aria-label={`Links: ${links} using ${t.test?.name ?? t.testId}`}
                          data-testid="test-links-badge"
                          onClick={() => setLinksFor({ id: t.testId, name: t.test?.name ?? t.testId })}
                        >
                          <Badge color="blue" variant="soft" radius="full">
                            <Link2Icon aria-hidden />
                            {links}
                          </Badge>
                        </button>
                      </Tooltip>
                    )}
                  </span>
                  {t.test?.location && !t.test.placeholder && (
                    <Tooltip content="Open in default editor (WebStorm)">
                      <IconButton size="1" variant="ghost" color="gray" className="bh-open-editor" aria-label={`Open ${t.test.name} in editor`} onClick={() => openTest(t.test!.location)}>
                        <ExternalLinkIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                  {editable && (
                    <IconButton size="1" variant="ghost" color="gray" className="bh-unmap" aria-label={`Remove test ${t.test?.name}`} onClick={() => unmap(t.testId)}>
                      <Cross2Icon />
                    </IconButton>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {open && editable && (
        <div className="bh-add-test">
          <Button size="1" variant="ghost" color="gray" onClick={onMap}>
            <PlusIcon aria-hidden /> Add test mapping
          </Button>
        </div>
      )}
      {linksFor && <TestLinksDialog contract={contract} testId={linksFor.id} testName={linksFor.name} exceptBehaviorId={behavior.id} onClose={() => setLinksFor(null)} />}
    </div>
  );
}

/** Map existing tests to a behavior, or create a new one ("User can …") and map it. */
export function TestMappingDialog({
  open,
  onOpenChange,
  contract,
  entity,
  behavior,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  contract: OrbitContract;
  entity: Entity;
  behavior: Behavior;
}) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const ids = useMemo(() => allIds(contract), [contract]);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [nt, setNt] = useState({ name: '', location: '' });
  useEffect(() => {
    if (open) {
      setFilter('');
      setPicked([]);
      setNt({ name: '', location: '' });
    }
  }, [open]);
  const candidates = contract.tests.filter((t) => !behavior.testIds.includes(t.id)).filter((t) => !filter.trim() || `${t.name} ${t.location} ${t.id}`.toLowerCase().includes(filter.toLowerCase()));
  const creating = nt.name.trim() !== '' || nt.location.trim() !== '';
  const ntValid = nt.name.trim() !== '' && nt.location.trim() !== '';
  const canSubmit = creating ? ntValid : picked.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const created = creating
      ? {
          id: generateId('test', ids.tests, nt.name),
          name: nt.name.trim(),
          location: nt.location.trim(),
        }
      : null;
    const add = [...picked, ...(created ? [created.id] : [])];
    edit((c) => ({
      ...c,
      tests: created ? [...c.tests, created] : c.tests,
      entities: c.entities.map((e) =>
        e.id !== entity.id
          ? e
          : {
              ...e,
              behaviors: e.behaviors.map((b) =>
                b.id === behavior.id
                  ? {
                      ...b,
                      testIds: [...b.testIds, ...add.filter((t) => !b.testIds.includes(t))],
                    }
                  : b,
              ),
            },
      ),
    }));
    onOpenChange(false);
    ctrl.toast(`Mapped ${add.length} test${add.length === 1 ? '' : 's'}`, 'success');
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="560px">
        <Dialog.Title>Add test mapping</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Pick the tests that verify “{behavior.name}”, or describe a new one.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="3">
            <TextField.Root aria-label="Filter tests" placeholder="Filter existing tests…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="check-list" role="group" aria-label="Existing tests">
              {candidates.length === 0 && (
                <Text size="2" color="gray">
                  {contract.tests.length === 0 ? 'No tests are defined yet.' : 'No unmapped tests match.'}
                </Text>
              )}
              {candidates.map((t) => (
                <label key={t.id} className="check-item">
                  <Checkbox checked={picked.includes(t.id)} onCheckedChange={(v) => setPicked(v ? [...picked, t.id] : picked.filter((x) => x !== t.id))} aria-label={`Map test ${t.name}`} />
                  <span style={{ minWidth: 0 }}>
                    <Text size="2" as="div">
                      {t.name}
                    </Text>
                    <Text size="1" color="gray" as="div" className="truncate">
                      {t.location}
                    </Text>
                  </span>
                </label>
              ))}
            </div>
            <Text size="2" weight="medium">
              Or create a new test
            </Text>
            <TextField.Root aria-label="New test title" placeholder="User can…" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
            <TextField.Root
              aria-label="New test location"
              placeholder="Where it lives, e.g. tests/e2e/tasks.spec.ts › creates a task"
              value={nt.location}
              onChange={(e) => setNt({ ...nt, location: e.target.value })}
            />
          </Flex>
          <Flex justify="end" gap="2" mt="4">
            <Button type="button" variant="soft" color="gray" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {creating ? 'Create and map' : 'Map tests'}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function BehaviorsSection({
  contract,
  entity,
  summary,
  bucket,
  onBucket,
  readOnly,
}: {
  contract: OrbitContract;
  entity: Entity;
  summary: AssuranceSummary;
  bucket: Bucket;
  onBucket: (b: Bucket) => void;
  readOnly: boolean;
}) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const focusId = useApp((s) => s.focusBehaviorId);
  const focusIds = useApp((s) => s.focusBehaviorIds);
  const viewFilter = useApp((s) => s.viewFilter);
  const [showAllUnfiltered, setShowAllUnfiltered] = useState(false);
  useEffect(() => setShowAllUnfiltered(false), [viewFilter]);
  // A view filter that names behaviors of this entity (and not the entity itself) narrows the list to them.
  const filterIds =
    viewFilter && !viewFilter.entityIds.includes(entity.id) && !showAllUnfiltered ? new Set(viewFilter.behaviorIds.filter((id) => entity.behaviors.some((b) => b.id === id))) : null;
  const narrowed = filterIds && filterIds.size > 0 ? filterIds : null;
  const [mapping, setMapping] = useState<Behavior | null>(null);
  const [del, setDel] = useState<Behavior | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const bucketIds = bucket === 'all' ? null : new Set(summary.behaviorIds[bucket]);
  const own = entity.behaviors.filter((b) => (!bucketIds || bucketIds.has(b.id)) && (!narrowed || narrowed.has(b.id)));
  // Collapsed by default; a behavior that was just added or is being navigated to starts open.
  // Navigating to a behavior expands it for good: the highlight fades after a moment, the expansion stays.
  useEffect(() => {
    const ids = [...(focusId ? [focusId] : []), ...focusIds].filter((id) => entity.behaviors.some((b) => b.id === id));
    if (ids.length) setOpenMap((m) => (ids.every((id) => m[id] === true) ? m : { ...m, ...Object.fromEntries(ids.map((id) => [id, true])) }));
  }, [focusId, focusIds, entity.behaviors]);
  const isOpenFor = (id: string) => openMap[id] ?? (freshId === id || focusId === id || focusIds.includes(id) || !!narrowed?.has(id));
  const allOpen = own.length > 0 && own.every((b) => isOpenFor(b.id));

  const addBehavior = () => {
    const slug = entity.id.replace(/^(cap|sys)\./, '');
    const name = 'User can…';
    const id = generateId(`behavior.${slug}`, allIds(contract).behaviors, 'new behavior');
    edit((c) => ({
      ...c,
      entities: c.entities.map((e) =>
        e.id !== entity.id
          ? e
          : {
              ...e,
              behaviors: [...e.behaviors, { id, name, expected: name, testIds: [] }],
            },
      ),
    }));
    setFreshId(id);
    if (bucket !== 'all') onBucket('all');
  };

  if (entity.behaviors.length === 0) {
    return readOnly ? null : (
      <Button size="2" variant="soft" onClick={addBehavior} className="add-empty">
        <PlusIcon aria-hidden /> Add behavior
      </Button>
    );
  }

  return (
    <section aria-labelledby="sec-behaviors" className="section">
      <Flex justify="between" align="center" mb="2">
        <Flex align="center" gap="3">
          <h3 id="sec-behaviors" className="section-title">
            Behaviors{' '}
            <Text size="2" color="gray" weight="regular">
              ({entity.behaviors.length})
            </Text>
          </h3>
          <Button size="1" variant="ghost" color="gray" onClick={() => setOpenMap(Object.fromEntries(own.map((b) => [b.id, !allOpen])))}>
            {allOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        </Flex>
        {!readOnly && (
          <Button size="2" variant="soft" onClick={addBehavior}>
            <PlusIcon aria-hidden /> Add behavior
          </Button>
        )}
      </Flex>
      {bucketIds && (
        <Callout.Root size="1" variant="surface" mb="3" data-testid="bucket-filter">
          <Flex justify="between" align="center" width="100%" gap="3">
            <Callout.Text>
              Showing {own.length} of {summary.total}: {BUCKET_LABEL[bucket].toLowerCase()} in this {entity.kind} and everything beneath it.
            </Callout.Text>
            <Button size="1" variant="soft" onClick={() => onBucket('all')}>
              Clear filter
            </Button>
          </Flex>
        </Callout.Root>
      )}
      {narrowed && (
        <Callout.Root size="1" variant="surface" color="yellow" mb="3" data-testid="view-filter-behaviors">
          <Flex justify="between" align="center" width="100%" gap="3">
            <Callout.Text>
              Showing {narrowed.size} of {entity.behaviors.length} behaviors that match the filter.
            </Callout.Text>
            <Button size="1" variant="soft" color="gray" onClick={() => setShowAllUnfiltered(true)}>
              Show all
            </Button>
          </Flex>
        </Callout.Root>
      )}
      {entity.behaviors.length === 0 && !bucketIds && (
        <div className="empty-inline">
          <Text size="2" color="gray">
            “{entity.name}” has no behaviors of its own yet.
          </Text>
        </div>
      )}
      <div className="bh-list">
        {own.map((b) => (
          <BehaviorRow
            key={b.id}
            contract={contract}
            behavior={b}
            owner={entity}
            own
            readOnly={readOnly}
            focused={focusId === b.id || focusIds.includes(b.id)}
            scrollTo={focusId === b.id || focusIds[0] === b.id}
            autoFocus={freshId === b.id}
            open={isOpenFor(b.id)}
            onOpenChange={(o) => setOpenMap((m) => ({ ...m, [b.id]: o }))}
            onDelete={() => setDel(b)}
            onMap={() => setMapping(b)}
          />
        ))}
      </div>
      {bucketIds && own.length === 0 && (
        <div className="empty-inline">
          <Text size="2" color="gray">
            No behaviors in this category.
          </Text>
        </div>
      )}
      {mapping && <TestMappingDialog open onOpenChange={(o) => !o && setMapping(null)} contract={contract} entity={entity} behavior={mapping} />}
      <Confirm
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete behavior “${del?.name ?? ''}”?`}
        confirmLabel="Delete behavior"
        danger
        onConfirm={() => {
          if (!del) return;
          const id = del.id;
          edit((c) => ({
            ...c,
            entities: c.entities.map((e) => (e.id !== entity.id ? e : { ...e, behaviors: e.behaviors.filter((b) => b.id !== id) })),
          }));
          ctrl.toast('Behavior deleted', 'info');
          setDel(null);
        }}
      >
        <Text size="2">
          The behavior and its {del?.testIds.length ?? 0} test mapping
          {del?.testIds.length === 1 ? '' : 's'} are removed. The tests themselves are not affected.
        </Text>
      </Confirm>
    </section>
  );
}
