import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Callout, Checkbox, Code, Dialog, Flex, IconButton, Table, Text, TextArea, TextField, Tooltip } from '@radix-ui/themes';
import { ChevronDownIcon, ChevronRightIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { allIds, behaviorAssurance, generateId } from '@orbit/contract';
import type { AssuranceSummary, Behavior, Entity, OrbitContract } from '@orbit/contract';
import { formatDateTime, relativeTime, shortSha } from '../lib/format';
import { useApp, useCtrl, useDispatch, useEdit, useInspected } from '../state/context';
import { BUCKET_LABEL } from './AssuranceSection';
import type { Bucket } from './AssuranceSection';
import { Confirm, EntityLink, EvidenceStatusBadge, FreshnessBadge, StatusPill } from './common';
import { Field } from './Dialogs';

function BehaviorCard({ contract, behavior, owner, own, commit, readOnly, focused, onEdit, onDelete }: { contract: OrbitContract; behavior: Behavior; owner: Entity; own: boolean; commit: string | null; readOnly: boolean; focused: boolean; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const ref = useRef<HTMLDivElement>(null);
  const d = useDispatch();
  const ba = useMemo(() => behaviorAssurance(contract, behavior.id, { inspectedCommit: commit }), [contract, behavior.id, commit]);
  useEffect(() => {
    if (focused) {
      ref.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      const t = setTimeout(() => d({ type: 'clearFocusBehavior' }), 2500);
      return () => clearTimeout(t);
    }
  }, [focused, d]);
  const status = ba?.status ?? 'untested';
  return (
    <div ref={ref} className={`behavior-card${focused ? ' flash' : ''}`} data-testid="behavior-card" data-behavior-id={behavior.id} tabIndex={-1}>
      <Flex justify="between" align="start" gap="3">
        <div style={{ minWidth: 0 }}>
          <Flex align="center" gap="2" wrap="wrap">
            <Text weight="bold" size="3">
              {behavior.name}
            </Text>
            <StatusPill status={status} />
          </Flex>
          <Text as="p" size="2" color="gray" mt="1" className="expected">
            {behavior.expected}
          </Text>
          {!own && (
            <Text size="1" color="gray">
              Owned by <EntityLink id={owner.id} behaviorId={behavior.id} />
            </Text>
          )}
        </div>
        {!readOnly && own && (
          <Flex gap="1" flexShrink="0">
            <Tooltip content="Edit behavior">
              <IconButton size="1" variant="ghost" color="gray" aria-label={`Edit behavior ${behavior.name}`} onClick={onEdit}>
                <Pencil1Icon />
              </IconButton>
            </Tooltip>
            <Tooltip content="Delete behavior">
              <IconButton size="1" variant="ghost" color="red" aria-label={`Delete behavior ${behavior.name}`} onClick={onDelete}>
                <TrashIcon />
              </IconButton>
            </Tooltip>
          </Flex>
        )}
      </Flex>
      <div className="test-rows">
        {behavior.testIds.length === 0 && (
          <Text size="1" color="gray">
            No tests mapped to this behavior.
          </Text>
        )}
        {ba?.tests.map((t) => (
          <div key={t.testId} className="test-row" data-testid="test-row">
            {!t.defined ? (
              <Flex align="center" gap="2">
                <ExclamationTriangleIcon color="var(--amber-10)" aria-hidden />
                <Text size="2">
                  Undefined test <Code size="1">{t.testId}</Code>
                </Text>
              </Flex>
            ) : (
              <>
                {(() => {
                  const shown = t.current ?? t.latestRecorded;
                  const fresh = t.current ? 'current' : t.freshness;
                  return (
                    <>
                      <Flex align="center" gap="2" wrap="wrap">
                        {shown ? <EvidenceStatusBadge status={shown.status} /> : <Badge color="gray" variant="soft" radius="full">No evidence</Badge>}
                        <Text size="2" weight="medium">
                          {t.test?.name}
                        </Text>
                        {shown && <FreshnessBadge freshness={fresh} />}
                      </Flex>
                      <Flex align="center" gap="2" wrap="wrap" className="test-meta">
                        <Code size="1" variant="ghost" color="gray">
                          {t.test?.location}
                        </Code>
                        {shown && (
                          <Text size="1" color="gray" title={formatDateTime(shown.executedAt)}>
                            · {relativeTime(shown.executedAt)}
                            {shown.commit ? ` · ${shortSha(shown.commit)}` : ' · no commit recorded'}
                          </Text>
                        )}
                        {t.history.length > 0 && (
                          <Button size="1" variant="ghost" color="gray" aria-expanded={!!open[t.testId]} onClick={() => setOpen({ ...open, [t.testId]: !open[t.testId] })}>
                            {open[t.testId] ? <ChevronDownIcon /> : <ChevronRightIcon />} History ({t.history.length})
                          </Button>
                        )}
                      </Flex>
                    </>
                  );
                })()}
                {open[t.testId] && (
                  <Table.Root size="1" variant="surface" className="history-table" aria-label={`Evidence history for ${t.test?.name}`}>
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Executed</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Commit</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Freshness</Table.ColumnHeaderCell>
                        <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {t.history.map((ev) => (
                        <Table.Row key={ev.id}>
                          <Table.Cell>
                            <EvidenceStatusBadge status={ev.status} />
                          </Table.Cell>
                          <Table.Cell title={ev.executedAt}>{formatDateTime(ev.executedAt)}</Table.Cell>
                          <Table.Cell>
                            <Code size="1">{ev.commit ? shortSha(ev.commit) : '—'}</Code>
                          </Table.Cell>
                          <Table.Cell>
                            <FreshnessBadge freshness={!commit || !ev.commit ? 'unknown' : ev.commit === commit ? 'current' : 'stale'} />
                          </Table.Cell>
                          <Table.Cell>{ev.details ?? ''}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BehaviorDialog({ open, onOpenChange, contract, entity, behavior }: { open: boolean; onOpenChange: (o: boolean) => void; contract: OrbitContract; entity: Entity; behavior: Behavior | null }) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const ids = useMemo(() => allIds(contract), [contract]);
  const [name, setName] = useState('');
  const [expected, setExpected] = useState('');
  const [id, setId] = useState('');
  const [idTouched, setIdTouched] = useState(false);
  const [testIds, setTestIds] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newTests, setNewTests] = useState<{ id: string; name: string; location: string }[]>([]);
  const [nt, setNt] = useState({ name: '', location: '' });
  useEffect(() => {
    if (open) {
      setName(behavior?.name ?? '');
      setExpected(behavior?.expected ?? '');
      setId(behavior?.id ?? '');
      setIdTouched(false);
      setTestIds(behavior?.testIds ?? []);
      setFilter('');
      setCreating(false);
      setNewTests([]);
      setNt({ name: '', location: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const slug = entity.id.replace(/^(cap|sys)\./, '');
  const autoId = useMemo(() => generateId(`behavior.${slug}`, ids.behaviors, name || 'new'), [ids.behaviors, slug, name]);
  const effectiveId = behavior ? behavior.id : idTouched ? id : autoId;
  const idTaken = !behavior && ids.behaviors.has(effectiveId.trim());
  const allTests = [...contract.tests, ...newTests];
  const shown = allTests.filter((t) => !filter.trim() || t.name.toLowerCase().includes(filter.toLowerCase()) || t.id.toLowerCase().includes(filter.toLowerCase()) || t.location.toLowerCase().includes(filter.toLowerCase()));
  const valid = name.trim() && expected.trim() && effectiveId.trim() && !idTaken;
  const ntValid = nt.name.trim() && nt.location.trim();

  const addTest = () => {
    if (!ntValid) return;
    const tid = generateId('test', [...ids.tests, ...newTests.map((t) => t.id)], nt.name);
    setNewTests([...newTests, { id: tid, name: nt.name.trim(), location: nt.location.trim() }]);
    setTestIds([...testIds, tid]);
    setNt({ name: '', location: '' });
    setCreating(false);
  };

  const submit = () => {
    if (!valid) return;
    const b: Behavior = { id: effectiveId.trim(), name: name.trim(), expected: expected.trim(), testIds: testIds.filter((t) => allTests.some((x) => x.id === t)) };
    edit((c) => ({
      ...c,
      tests: [...c.tests, ...newTests],
      entities: c.entities.map((e) => (e.id !== entity.id ? e : { ...e, behaviors: behavior ? e.behaviors.map((x) => (x.id === behavior.id ? b : x)) : [...e.behaviors, b] })),
    }));
    onOpenChange(false);
    ctrl.toast(behavior ? 'Behavior updated' : `Added behavior “${b.name}”`, 'success');
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="620px">
        <Dialog.Title>{behavior ? 'Edit behavior' : 'Add behavior'}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          A behavior is a guarantee about what the product does, owned by “{entity.name}”.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="3">
            <Field label="Name">
              <TextField.Root aria-label="Behavior name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Expected outcome" hint="Describe the result, not a test script.">
              <TextArea aria-label="Expected outcome" rows={3} value={expected} onChange={(e) => setExpected(e.target.value)} />
            </Field>
            <Field label="Id" hint={behavior ? 'Ids are fixed after creation.' : 'Stable identifier; cannot be changed later.'} error={idTaken ? 'This id is already used by another behavior.' : undefined}>
              <TextField.Root
                aria-label="Behavior id"
                value={effectiveId}
                readOnly={!!behavior}
                style={{ fontFamily: 'var(--code-font-family)' }}
                onChange={(e) => {
                  setId(e.target.value);
                  setIdTouched(true);
                }}
              />
            </Field>
            <div>
              <Flex justify="between" align="center" mb="1">
                <Text as="div" size="2" weight="medium" id="map-tests-label">
                  Mapped tests ({testIds.length})
                </Text>
                <Button type="button" size="1" variant="soft" onClick={() => setCreating(!creating)} aria-expanded={creating}>
                  <PlusIcon /> Create test…
                </Button>
              </Flex>
              {creating && (
                <Flex gap="2" mb="2" className="inline-form" align="end">
                  <TextField.Root size="1" style={{ flex: 1 }} placeholder="Test name" aria-label="New test name" value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} />
                  <TextField.Root size="1" style={{ flex: 1 }} placeholder="Location (path, id or URL)" aria-label="New test location" value={nt.location} onChange={(e) => setNt({ ...nt, location: e.target.value })} />
                  <Button type="button" size="1" disabled={!ntValid} onClick={addTest}>
                    Add test
                  </Button>
                </Flex>
              )}
              <TextField.Root size="1" placeholder="Filter tests…" aria-label="Filter tests" value={filter} onChange={(e) => setFilter(e.target.value)} mb="1">
                <TextField.Slot>
                  <MagnifyingGlassIcon />
                </TextField.Slot>
              </TextField.Root>
              <div className="check-list" role="group" aria-labelledby="map-tests-label">
                {shown.map((t) => (
                  <label key={t.id} className="check-item">
                    <Checkbox checked={testIds.includes(t.id)} onCheckedChange={(v) => setTestIds(v ? [...testIds, t.id] : testIds.filter((x) => x !== t.id))} aria-label={`Map test ${t.name}`} />
                    <span style={{ minWidth: 0 }}>
                      <Text size="2" as="div">
                        {t.name}
                        {newTests.some((n) => n.id === t.id) && (
                          <Badge ml="2" size="1" color="indigo">
                            new
                          </Badge>
                        )}
                      </Text>
                      <Text size="1" color="gray" as="div" className="truncate">
                        {t.location}
                      </Text>
                    </span>
                  </label>
                ))}
                {shown.length === 0 && (
                  <Text size="2" color="gray" as="div" style={{ padding: 8 }}>
                    {allTests.length === 0 ? 'No tests defined yet. Use “Create test…”.' : 'No tests match.'}
                  </Text>
                )}
              </div>
            </div>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Dialog.Close>
              <Button type="button" variant="soft" color="gray">
                Cancel
              </Button>
            </Dialog.Close>
            <Button type="submit" disabled={!valid}>
              {behavior ? 'Save behavior' : 'Add behavior'}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export function BehaviorsSection({ contract, entity, summary, bucket, onBucket, readOnly, descendantBehaviors }: {
  contract: OrbitContract;
  entity: Entity;
  summary: AssuranceSummary;
  bucket: Bucket;
  onBucket: (b: Bucket) => void;
  readOnly: boolean;
  descendantBehaviors: { behavior: Behavior; owner: Entity }[];
}) {
  const commit = useInspected();
  const edit = useEdit();
  const ctrl = useCtrl();
  const focusId = useApp((s) => s.focusBehaviorId);
  const [dialog, setDialog] = useState<{ behavior: Behavior | null } | null>(null);
  const [del, setDel] = useState<Behavior | null>(null);
  const [descOpen, setDescOpen] = useState(false);
  const bucketIds = bucket === 'all' ? null : new Set(summary.behaviorIds[bucket]);
  const own = entity.behaviors.filter((b) => !bucketIds || bucketIds.has(b.id));
  const desc = descendantBehaviors.filter((x) => !bucketIds || bucketIds.has(x.behavior.id));
  const focusInDesc = !!focusId && descendantBehaviors.some((x) => x.behavior.id === focusId);
  const showDesc = bucketIds ? true : descOpen || focusInDesc;

  return (
    <section aria-labelledby="sec-behaviors" className="section">
      <Flex justify="between" align="center" mb="2">
        <h3 id="sec-behaviors" className="section-title">
          Behaviors <Text size="2" color="gray" weight="regular">({entity.behaviors.length})</Text>
        </h3>
        {!readOnly && (
          <Button size="2" variant="soft" onClick={() => setDialog({ behavior: null })}>
            <PlusIcon aria-hidden /> Add behavior
          </Button>
        )}
      </Flex>
      {bucketIds && (
        <Callout.Root size="1" variant="surface" mb="3" data-testid="bucket-filter">
          <Flex justify="between" align="center" width="100%" gap="3">
            <Callout.Text>
              Showing {own.length + desc.length} of {summary.total}: {BUCKET_LABEL[bucket].toLowerCase()} in this {entity.kind} and everything beneath it.
            </Callout.Text>
            <Button size="1" variant="soft" onClick={() => onBucket('all')}>
              Clear filter
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
      <Flex direction="column" gap="3">
        {own.map((b) => (
          <BehaviorCard key={b.id} contract={contract} behavior={b} owner={entity} own commit={commit} readOnly={readOnly} focused={focusId === b.id} onEdit={() => setDialog({ behavior: b })} onDelete={() => setDel(b)} />
        ))}
      </Flex>
      {descendantBehaviors.length > 0 && (
        <div className="desc-group">
          {!bucketIds && (
            <Button variant="ghost" color="gray" size="2" aria-expanded={showDesc} onClick={() => setDescOpen(!descOpen)} className="desc-toggle">
              {showDesc ? <ChevronDownIcon /> : <ChevronRightIcon />} From sub-{entity.kind === 'capability' ? 'capabilities' : 'systems'} ({descendantBehaviors.length})
            </Button>
          )}
          {showDesc && (
            <Flex direction="column" gap="3" mt="2">
              {desc.map((x) => (
                <BehaviorCard key={x.behavior.id} contract={contract} behavior={x.behavior} owner={x.owner} own={false} commit={commit} readOnly focused={focusId === x.behavior.id} onEdit={() => undefined} onDelete={() => undefined} />
              ))}
              {desc.length === 0 && <Text size="2" color="gray">None match this filter.</Text>}
            </Flex>
          )}
        </div>
      )}
      {bucketIds && own.length + desc.length === 0 && (
        <div className="empty-inline">
          <Text size="2" color="gray">
            No behaviors in this category.
          </Text>
        </div>
      )}
      {dialog && <BehaviorDialog open onOpenChange={(o) => !o && setDialog(null)} contract={contract} entity={entity} behavior={dialog.behavior} />}
      <Confirm
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete behavior “${del?.name ?? ''}”?`}
        confirmLabel="Delete behavior"
        danger
        onConfirm={() => {
          if (!del) return;
          const id = del.id;
          edit((c) => ({ ...c, entities: c.entities.map((e) => (e.id !== entity.id ? e : { ...e, behaviors: e.behaviors.filter((b) => b.id !== id) })) }));
          ctrl.toast('Behavior deleted', 'info');
          setDel(null);
        }}
      >
        <Text size="2">
          The behavior and its {del?.testIds.length ?? 0} test mapping{del?.testIds.length === 1 ? '' : 's'} are removed. The tests and their evidence are not affected.
        </Text>
      </Confirm>
    </section>
  );
}
