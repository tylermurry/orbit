import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Callout, Code, Dialog, Flex, IconButton, Popover, Select, Table, Tabs, Text, TextArea, TextField, Tooltip } from '@radix-ui/themes';
import { ArrowDownIcon, ArrowUpIcon, Cross2Icon, InfoCircledIcon, Pencil1Icon, PlusIcon, TrashIcon } from '@radix-ui/react-icons';
import { allIds, behaviorIndex, evidenceFreshness, generateId, referencesTo, removeTest } from '@orbit/contract';
import type { Evidence, EvidenceStatus, Freshness, OrbitContract, TestDefinition } from '@orbit/contract';
import { EVIDENCE_STATUSES } from '@orbit/contract';
import { FULL_SHA, formatDateTime, localInputToRfc3339, plural, relativeTime, rfc3339ToLocalInput, shortSha } from '../lib/format';
import { EVIDENCE_LABEL } from '../lib/model';
import { useApp, useCtrl, useDispatch, useEdit, useInspected } from '../state/context';
import { Confirm, EntityLink, EvidenceStatusBadge, FreshnessBadge } from './common';
import { Field } from './Dialogs';

function TestForm({ contract, test, onClose }: { contract: OrbitContract; test: TestDefinition | null; onClose: () => void }) {
  const edit = useEdit();
  const [name, setName] = useState(test?.name ?? '');
  const [location, setLocation] = useState(test?.location ?? '');
  const [id, setId] = useState('');
  const [touched, setTouched] = useState(false);
  const ids = useMemo(() => allIds(contract).tests, [contract]);
  const auto = useMemo(() => generateId('test', ids, name || 'new'), [ids, name]);
  const effective = test ? test.id : touched ? id : auto;
  const taken = !test && ids.has(effective.trim());
  const valid = name.trim() && location.trim() && effective.trim() && !taken;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="500px">
        <Dialog.Title>{test ? 'Edit test' : 'Add test'}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          A test definition names an automated test that verifies behaviors. Orbit never runs it.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            const t: TestDefinition = { id: effective.trim(), name: name.trim(), location: location.trim() };
            edit((c) => ({ ...c, tests: test ? c.tests.map((x) => (x.id === test.id ? t : x)) : [...c.tests, t] }));
            onClose();
          }}
        >
          <Flex direction="column" gap="3">
            <Field label="Name">
              <TextField.Root aria-label="Test name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Location" hint="A source path, test identifier or URL. It does not need to exist locally.">
              <TextField.Root aria-label="Test location" value={location} onChange={(e) => setLocation(e.target.value)} />
            </Field>
            <Field label="Id" hint={test ? 'Ids are fixed after creation.' : undefined} error={taken ? 'This id is already used.' : undefined}>
              <TextField.Root
                aria-label="Test id"
                value={effective}
                readOnly={!!test}
                style={{ fontFamily: 'var(--code-font-family)' }}
                onChange={(e) => {
                  setId(e.target.value);
                  setTouched(true);
                }}
              />
            </Field>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button type="button" variant="soft" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {test ? 'Save test' : 'Add test'}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function EvidenceForm({ contract, ev, onClose, defaultTestId }: { contract: OrbitContract; ev: Evidence | null; onClose: () => void; defaultTestId?: string }) {
  const edit = useEdit();
  const git = useApp((s) => s.git);
  const head = git?.available ? git.headCommit : undefined;
  const [testId, setTestId] = useState(ev?.testId ?? defaultTestId ?? contract.tests[0]?.id ?? '');
  const [status, setStatus] = useState<EvidenceStatus>(ev?.status ?? 'passed');
  const [when, setWhen] = useState(ev ? rfc3339ToLocalInput(ev.executedAt) : rfc3339ToLocalInput(new Date().toISOString()));
  const [commit, setCommit] = useState(ev?.commit ?? '');
  const [details, setDetails] = useState(ev?.details ?? '');
  const ids = useMemo(() => allIds(contract).evidence, [contract]);
  const auto = useMemo(() => generateId('run', ids, (testId || 'new').replace(/^test\./, '')), [ids, testId]);
  const iso = localInputToRfc3339(when);
  const c = commit.trim().toLowerCase();
  const commitBad = c !== '' && !FULL_SHA.test(c);
  const valid = !!testId && !!iso && !commitBad;
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>{ev ? 'Edit evidence record' : 'Add evidence record'}</Dialog.Title>
        <Dialog.Description size="2" color="gray" mb="3">
          Record a result produced by an external tool. Leave the commit empty when it is unknown; Orbit never invents one.
        </Dialog.Description>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || !iso) return;
            const rec: Evidence = { id: ev?.id ?? auto, testId, status, executedAt: iso, ...(c ? { commit: c } : {}), ...(details.trim() ? { details: details.trim() } : {}) };
            edit((cc) => ({ ...cc, evidence: ev ? cc.evidence.map((x) => (x.id === ev.id ? rec : x)) : [...cc.evidence, rec] }));
            onClose();
          }}
        >
          <Flex direction="column" gap="3">
            <Field label="Test">
              <Select.Root value={testId || undefined} onValueChange={setTestId}>
                <Select.Trigger aria-label="Evidence test" placeholder="Choose a test" style={{ width: '100%' }} />
                <Select.Content>
                  {contract.tests.map((t) => (
                    <Select.Item key={t.id} value={t.id}>
                      {t.name}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
            </Field>
            <Flex gap="3">
              <div style={{ flex: 1 }}>
                <Field label="Status">
                  <Select.Root value={status} onValueChange={(v) => setStatus(v as EvidenceStatus)}>
                    <Select.Trigger aria-label="Evidence status" style={{ width: '100%' }} />
                    <Select.Content>
                      {EVIDENCE_STATUSES.map((s) => (
                        <Select.Item key={s} value={s}>
                          {EVIDENCE_LABEL[s]}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select.Root>
                </Field>
              </div>
              <div style={{ flex: 1.3 }}>
                <Field label="Executed at" hint="Stored as RFC 3339 UTC">
                  <input type="datetime-local" step={1} className="datetime-input" aria-label="Executed at" value={when} onChange={(e) => setWhen(e.target.value)} />
                </Field>
              </div>
            </Flex>
            <Field label="Commit (optional)" error={commitBad ? 'A commit must be a full 40-character hex SHA.' : undefined}>
              <Flex gap="2">
                <TextField.Root aria-label="Evidence commit" style={{ flex: 1, fontFamily: 'var(--code-font-family)' }} placeholder="40-hex SHA" value={commit} onChange={(e) => setCommit(e.target.value)} />
                <Tooltip content={head ? `Use HEAD (${shortSha(head)})` : 'Needs a Git repository with commits'}>
                  <Button type="button" variant="soft" disabled={!head} onClick={() => head && setCommit(head)}>
                    Use HEAD
                  </Button>
                </Tooltip>
              </Flex>
            </Field>
            <Field label="Details (optional)">
              <TextArea aria-label="Evidence details" rows={2} value={details} onChange={(e) => setDetails(e.target.value)} />
            </Field>
          </Flex>
          <Flex gap="3" mt="4" justify="end">
            <Button type="button" variant="soft" color="gray" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid}>
              {ev ? 'Save record' : 'Add record'}
            </Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function TestsTab({ contract, onShowEvidence }: { contract: OrbitContract; onShowEvidence: (testId: string) => void }) {
  const edit = useEdit();
  const ctrl = useCtrl();
  const d = useDispatch();
  const [form, setForm] = useState<{ test: TestDefinition | null } | null>(null);
  const [del, setDel] = useState<TestDefinition | null>(null);
  const [q, setQ] = useState('');
  const index = useMemo(() => behaviorIndex(contract), [contract]);
  const rows = contract.tests.filter((t) => !q.trim() || `${t.id} ${t.name} ${t.location}`.toLowerCase().includes(q.toLowerCase()));
  const mapped = (id: string) => [...index.values()].filter((x) => x.behavior.testIds.includes(id));
  const latest = (id: string) => contract.evidence.filter((e) => e.testId === id).sort((a, b) => (a.executedAt < b.executedAt ? 1 : a.executedAt > b.executedAt ? -1 : b.id.localeCompare(a.id)))[0];
  const delMapped = del ? mapped(del.id) : [];
  const delEvidence = del ? contract.evidence.filter((e) => e.testId === del.id).length : 0;
  return (
    <Flex direction="column" gap="3">
      <Flex gap="2" justify="between">
        <TextField.Root size="2" style={{ width: 280 }} placeholder="Filter tests…" aria-label="Filter tests" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button onClick={() => setForm({ test: null })}>
          <PlusIcon aria-hidden /> Add test
        </Button>
      </Flex>
      {rows.length === 0 ? (
        <div className="empty-inline">
          <Text size="2" color="gray">
            {contract.tests.length === 0 ? 'No tests defined yet. Add the automated tests that verify your behaviors.' : 'No tests match the filter.'}
          </Text>
        </div>
      ) : (
        <Table.Root variant="surface" size="1" aria-label="Tests">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Test</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Location</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Behaviors</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Latest result</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right">
                <span className="sr-only">Actions</span>
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((t) => {
              const m = mapped(t.id);
              const l = latest(t.id);
              return (
                <Table.Row key={t.id} data-testid="test-row-lib" data-test-id={t.id}>
                  <Table.RowHeaderCell>
                    <Text size="2" weight="medium" as="div">
                      {t.name}
                    </Text>
                    <Code size="1" variant="ghost" color="gray">
                      {t.id}
                    </Code>
                  </Table.RowHeaderCell>
                  <Table.Cell>
                    <Code size="1" variant="ghost" className="wrap-code">
                      {t.location}
                    </Code>
                  </Table.Cell>
                  <Table.Cell>
                    {m.length === 0 ? (
                      <Text size="2" color="gray">
                        none
                      </Text>
                    ) : (
                      <Popover.Root>
                        <Popover.Trigger>
                          <Button size="1" variant="soft" aria-label={`${plural(m.length, 'behavior')} mapped to ${t.name}`}>
                            {m.length}
                          </Button>
                        </Popover.Trigger>
                        <Popover.Content width="320px">
                          <Text size="2" weight="bold" as="div" mb="2">
                            Verifies
                          </Text>
                          <Flex direction="column" gap="2">
                            {m.map((x) => (
                              <div key={x.behavior.id} onClick={() => d({ type: 'ui', patch: { libraryOpen: false } })}>
                                <EntityLink id={x.entity.id} name={x.behavior.name} behaviorId={x.behavior.id} />
                                <Text size="1" color="gray" as="div">
                                  in {x.entity.name}
                                </Text>
                              </div>
                            ))}
                          </Flex>
                        </Popover.Content>
                      </Popover.Root>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {l ? (
                      <Flex direction="column" gap="1" align="start">
                        <EvidenceStatusBadge status={l.status} />
                        <Button size="1" variant="ghost" color="gray" onClick={() => onShowEvidence(t.id)}>
                          {plural(contract.evidence.filter((e) => e.testId === t.id).length, 'record')}
                        </Button>
                      </Flex>
                    ) : (
                      <Badge color="gray" variant="soft" radius="full">
                        No evidence
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell align="right">
                    <Flex gap="1" justify="end">
                      <Tooltip content="Edit test">
                        <IconButton size="1" variant="ghost" color="gray" aria-label={`Edit test ${t.name}`} onClick={() => setForm({ test: t })}>
                          <Pencil1Icon />
                        </IconButton>
                      </Tooltip>
                      <Tooltip content="Delete test">
                        <IconButton size="1" variant="ghost" color="red" aria-label={`Delete test ${t.name}`} onClick={() => setDel(t)}>
                          <TrashIcon />
                        </IconButton>
                      </Tooltip>
                    </Flex>
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Root>
      )}
      {form && <TestForm contract={contract} test={form.test} onClose={() => setForm(null)} />}
      <Confirm
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title={`Delete test “${del?.name ?? ''}”?`}
        confirmLabel="Delete test"
        danger
        onConfirm={() => {
          if (!del) return;
          const id = del.id;
          edit((c) => removeTest(c, id, { unmap: true, removeEvidence: true }));
          ctrl.toast('Test deleted', 'info');
          setDel(null);
        }}
      >
        <ul className="impl-list">
          <li>
            Unmap it from <strong>{delMapped.length}</strong> behavior{delMapped.length === 1 ? '' : 's'}.
          </li>
          <li>
            Delete its <strong>{delEvidence}</strong> evidence record{delEvidence === 1 ? '' : 's'} (a record cannot exist without its test).
          </li>
        </ul>
        {del && referencesTo(contract, 'test', del.id).length === 0 && <Text size="1" color="gray">Nothing else references this test.</Text>}
      </Confirm>
    </Flex>
  );
}

function EvidenceTab({ contract, focusTest, setFocusTest }: { contract: OrbitContract; focusTest: string; setFocusTest: (s: string) => void }) {
  const edit = useEdit();
  const commit = useInspected();
  const [status, setStatus] = useState<string>('all');
  const [fresh, setFresh] = useState<string>('all');
  const [desc, setDesc] = useState(true);
  const [form, setForm] = useState<{ ev: Evidence | null } | null>(null);
  const [del, setDel] = useState<Evidence | null>(null);
  const testName = (id: string) => contract.tests.find((t) => t.id === id)?.name ?? id;
  const rows = useMemo(() => {
    const out = contract.evidence
      .filter((e) => focusTest === 'all' || e.testId === focusTest)
      .filter((e) => status === 'all' || e.status === status)
      .filter((e) => fresh === 'all' || evidenceFreshness(e, { inspectedCommit: commit }) === (fresh as Freshness));
    out.sort((a, b) => (a.executedAt < b.executedAt ? -1 : a.executedAt > b.executedAt ? 1 : a.id.localeCompare(b.id)) * (desc ? -1 : 1));
    return out;
  }, [contract.evidence, focusTest, status, fresh, desc, commit]);
  return (
    <Flex direction="column" gap="3">
      <Flex gap="2" align="end" wrap="wrap">
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Test
          </Text>
          <Select.Root value={focusTest} onValueChange={setFocusTest}>
            <Select.Trigger aria-label="Filter by test" style={{ minWidth: 200 }} />
            <Select.Content>
              <Select.Item value="all">All tests</Select.Item>
              {contract.tests.map((t) => (
                <Select.Item key={t.id} value={t.id}>
                  {t.name}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Status
          </Text>
          <Select.Root value={status} onValueChange={setStatus}>
            <Select.Trigger aria-label="Filter by status" />
            <Select.Content>
              <Select.Item value="all">All statuses</Select.Item>
              {EVIDENCE_STATUSES.map((s) => (
                <Select.Item key={s} value={s}>
                  {EVIDENCE_LABEL[s]}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Flex>
        <Flex direction="column" gap="1">
          <Text size="1" color="gray">
            Freshness
          </Text>
          <Select.Root value={fresh} onValueChange={setFresh}>
            <Select.Trigger aria-label="Filter by freshness" />
            <Select.Content>
              <Select.Item value="all">Any freshness</Select.Item>
              <Select.Item value="current">Current</Select.Item>
              <Select.Item value="stale">Potentially outdated</Select.Item>
              <Select.Item value="unknown">Unknown</Select.Item>
            </Select.Content>
          </Select.Root>
        </Flex>
        <Button ml="auto" onClick={() => setForm({ ev: null })} disabled={contract.tests.length === 0}>
          <PlusIcon aria-hidden /> Add evidence
        </Button>
      </Flex>
      {rows.length === 0 ? (
        <div className="empty-inline">
          <Text size="2" color="gray">
            {contract.tests.length === 0 ? 'Define a test first, then record evidence for it.' : contract.evidence.length === 0 ? 'No evidence recorded yet.' : 'No evidence matches the filters.'}
          </Text>
        </div>
      ) : (
        <Table.Root variant="surface" size="1" aria-label="Evidence records">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Test</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell aria-sort={desc ? 'descending' : 'ascending'}>
                <Button size="1" variant="ghost" color="gray" onClick={() => setDesc(!desc)} aria-label={`Sort by executed time, currently ${desc ? 'newest first' : 'oldest first'}`}>
                  Executed {desc ? <ArrowDownIcon /> : <ArrowUpIcon />}
                </Button>
              </Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Commit</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Freshness</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Details</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell align="right">
                <span className="sr-only">Actions</span>
              </Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {rows.map((e) => (
              <Table.Row key={e.id} data-testid="evidence-row" data-evidence-id={e.id}>
                <Table.RowHeaderCell>{testName(e.testId)}</Table.RowHeaderCell>
                <Table.Cell>
                  <EvidenceStatusBadge status={e.status} />
                </Table.Cell>
                <Table.Cell title={e.executedAt}>
                  {formatDateTime(e.executedAt)}
                  <Text size="1" color="gray" as="div">
                    {relativeTime(e.executedAt)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Code size="1">{e.commit ? shortSha(e.commit) : '—'}</Code>
                </Table.Cell>
                <Table.Cell>
                  <FreshnessBadge freshness={evidenceFreshness(e, { inspectedCommit: commit })} />
                </Table.Cell>
                <Table.Cell>
                  <Text size="1">{e.details ?? ''}</Text>
                </Table.Cell>
                <Table.Cell align="right">
                  <Flex gap="1" justify="end">
                    <IconButton size="1" variant="ghost" color="gray" aria-label={`Edit evidence ${e.id}`} onClick={() => setForm({ ev: e })}>
                      <Pencil1Icon />
                    </IconButton>
                    <IconButton size="1" variant="ghost" color="red" aria-label={`Delete evidence ${e.id}`} onClick={() => setDel(e)}>
                      <TrashIcon />
                    </IconButton>
                  </Flex>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      )}
      {form && <EvidenceForm contract={contract} ev={form.ev} onClose={() => setForm(null)} defaultTestId={focusTest !== 'all' ? focusTest : undefined} />}
      <Confirm
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete evidence record?"
        confirmLabel="Delete record"
        danger
        onConfirm={() => {
          if (!del) return;
          const id = del.id;
          edit((c) => ({ ...c, evidence: c.evidence.filter((x) => x.id !== id) }));
          setDel(null);
        }}
      >
        {del ? `${EVIDENCE_LABEL[del.status]} result for “${testName(del.testId)}” at ${formatDateTime(del.executedAt)}.` : ''}
      </Confirm>
    </Flex>
  );
}

export function Library() {
  const open = useApp((s) => s.libraryOpen);
  const tab = useApp((s) => s.libraryTab);
  const contract = useApp((s) => s.contract);
  const readOnly = useApp((s) => s.loadedInvalid);
  const focusTest = useApp((s) => s.libraryFocusTest);
  const d = useDispatch();
  const [evTest, setEvTest] = useState('all');
  useEffect(() => {
    if (open && focusTest) setEvTest(focusTest);
  }, [open, focusTest]);
  if (!contract) return null;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => d({ type: 'ui', patch: { libraryOpen: o, libraryFocusTest: null } })}>
      <Dialog.Content className="orbit-library" aria-describedby="library-note">
        <Flex justify="between" align="start" mb="2">
          <div>
            <Dialog.Title size="4" mb="1">
              Tests &amp; evidence
            </Dialog.Title>
            <Text id="library-note" size="2" color="gray">
              Orbit displays evidence produced by external tools. It never runs tests.
            </Text>
          </div>
          <Dialog.Close>
            <IconButton variant="ghost" color="gray" aria-label="Close tests and evidence">
              <Cross2Icon />
            </IconButton>
          </Dialog.Close>
        </Flex>
        {readOnly && (
          <Callout.Root color="amber" size="1" variant="surface" mb="3">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>The file has errors and is read-only. Fix them in Raw JSON to edit tests and evidence.</Callout.Text>
          </Callout.Root>
        )}
        <Tabs.Root className="library-tabs" value={tab} onValueChange={(v) => d({ type: 'ui', patch: { libraryTab: v as 'tests' | 'evidence' } })}>
          <Tabs.List>
            <Tabs.Trigger value="tests">Tests ({contract.tests.length})</Tabs.Trigger>
            <Tabs.Trigger value="evidence">Evidence ({contract.evidence.length})</Tabs.Trigger>
          </Tabs.List>
          <div className={`library-body${readOnly ? ' readonly' : ''}`}>
            <Tabs.Content value="tests">
              <TestsTab
                contract={contract}
                onShowEvidence={(id) => {
                  setEvTest(id);
                  d({ type: 'ui', patch: { libraryTab: 'evidence' } });
                }}
              />
            </Tabs.Content>
            <Tabs.Content value="evidence">
              <EvidenceTab contract={contract} focusTest={evTest} setFocusTest={setEvTest} />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </Dialog.Content>
    </Dialog.Root>
  );
}
