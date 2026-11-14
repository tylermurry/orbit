import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Flex, Heading, Spinner, Text, TextField } from '@radix-ui/themes';
import { ExclamationTriangleIcon, InfoCircledIcon, MagnifyingGlassIcon } from '@radix-ui/react-icons';
import type { ChangeCategory, Diagnostic, SemanticDiff } from '@orbit/contract';
import { ChangeDetail, ChangeList, diffLookups } from '../components/Changes';
import { CompareEditor } from '../components/CompareControl';
import { ImpactChain } from '../components/ImpactChain';
import { KindBadge, Legend } from '../components/common';
import { shortSha } from '../lib/format';
import { defaultComparison, revLabel } from '../state/compare';
import { useAppState, useCtrl, useDispatch } from '../state/context';
import { isDirty } from '../state/store';
import type { SnapMeta } from '../state/types';

function Totals({ diff, category, onCategory }: { diff: SemanticDiff; category: string | null; onCategory: (c: string | null) => void }) {
  const { entities } = useMemo(() => diffLookups(diff), [diff]);
  const items = useMemo(() => {
    const count = (pred: (c: SemanticDiff['changes'][number]) => boolean) => {
      const t = { added: 0, modified: 0, removed: 0 };
      diff.changes.filter(pred).forEach((c) => t[c.kind]++);
      return t;
    };
    const ent = (k: string) => count((c) => c.category === 'entity' && entities.get(c.id)?.kind === k);
    const cat = (c: ChangeCategory) => count((x) => x.category === c);
    return [
      { key: 'capability', label: 'Capabilities', t: ent('capability') },
      { key: 'system', label: 'Systems', t: ent('system') },
      { key: 'behavior', label: 'Behaviors', t: cat('behavior') },
      { key: 'relationship', label: 'Relationships', t: cat('relationship') },
      { key: 'test', label: 'Tests', t: cat('test') },
      { key: 'evidence', label: 'Evidence', t: cat('evidence') },
      { key: 'product', label: 'Product', t: cat('product') },
    ];
  }, [diff, entities]);
  return (
    <div className="totals" role="group" aria-label="Change totals by category">
      {items.map((i) => (
        <button key={i.key} type="button" className={`total-card${category === i.key ? ' active' : ''}`} aria-pressed={category === i.key} onClick={() => onCategory(category === i.key ? null : i.key)} aria-label={`${i.label}: ${i.t.added} added, ${i.t.modified} modified, ${i.t.removed} removed`} data-total={i.key}>
          <span className="total-label">{i.label}</span>
          <span className="total-nums" aria-hidden>
            <span className="n-added">＋{i.t.added}</span>
            <span className="n-modified">●{i.t.modified}</span>
            <span className="n-removed">−{i.t.removed}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function DiagList({ side, meta }: { side: string; meta: SnapMeta }) {
  const list: Diagnostic[] = meta.diagnostics.filter((x) => x.severity === 'error');
  return (
    <div className="blocked-side">
      <Text weight="bold" size="2" as="div">
        {side}: {meta.label}
        {meta.commit ? ` (${shortSha(meta.commit)})` : ''}
      </Text>
      {list.length === 0 ? (
        <Text size="2" color="gray">
          Valid.
        </Text>
      ) : (
        <ul className="diag-simple">
          {list.slice(0, 8).map((x, i) => (
            <li key={i}>
              <Text size="2">{x.message}</Text>
              {x.line !== undefined && (
                <Text size="1" color="gray">
                  {' '}
                  (line {x.line})
                </Text>
              )}
            </li>
          ))}
          {list.length > 8 && <li>…and {list.length - 8} more</li>}
        </ul>
      )}
    </div>
  );
}

export function ImpactView() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const git = s.git;
  const [group, setGroup] = useState<'all' | 'guarantee' | 'verification'>('all');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [pane, setPane] = useState<'changes' | 'affected'>('changes');
  const result = s.compareResult;
  const diff = result?.status === 'ready' ? result.diff : null;
  const selected = diff?.changes.find((c) => c.key === s.impactSelection) ?? null;

  useEffect(() => {
    if (diff && !selected && diff.changes.length) d({ type: 'selectChange', key: diff.changes[0].key });
  }, [diff, selected, d]);

  if (!git?.available) {
    return (
      <main className="impact-empty" data-testid="impact-nogit">
        <div className="empty-card" style={{ maxWidth: 560 }}>
          <Heading size="5" mb="2">
            Version comparison needs the contract to be inside a local Git repository
          </Heading>
          <Text as="p" size="3" color="gray" mb="3">
            {git?.unavailableReason === 'git-missing'
              ? 'The git program could not be found on this computer. Install Git and make sure it is on your PATH, then reopen the file.'
              : git?.unavailableReason === 'error'
                ? (git.message ?? 'Orbit could not read the Git repository.')
                : 'This file is not inside a Git repository, so there is no history to compare. Move it into a repository (or run “git init”) and reopen it.'}
          </Text>
          <Callout.Root size="1" variant="surface" style={{ textAlign: 'left' }}>
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>Nothing is wrong with your contract. Product and Engineering views, editing, Raw JSON, tests &amp; evidence and saving all work without Git.</Callout.Text>
          </Callout.Root>
        </div>
      </main>
    );
  }

  const compare = s.compare;
  const dirty = isDirty(s);
  const header = (
    <div className="impact-header">
      <Flex align="start" gap="4" wrap="wrap">
        <div style={{ flex: '1 1 420px', maxWidth: 560 }}>
          <Flex align="center" gap="2" mb="2">
            <Heading size="4">Impact</Heading>
            <Text size="2" color="gray">
              {compare ? `${revLabel(compare.base)} → ${revLabel(compare.target)}` : 'Choose revisions to compare'}
            </Text>
          </Flex>
          {compare ? (
            <CompareEditor compact />
          ) : (
            <Button onClick={() => ctrl.setCompare(defaultComparison(git, dirty))}>Compare HEAD → {dirty ? 'unsaved edits' : 'Working tree'}</Button>
          )}
        </div>
        <Flex direction="column" gap="2" style={{ flex: '1 1 300px' }}>
          <Legend />
          {git.detached && (
            <Text size="1" color="gray">
              HEAD is detached at {shortSha(git.headCommit)} (not on a branch).
            </Text>
          )}
          {git.shallow && (
            <Text size="1" color="gray">
              This is a shallow clone: older revisions may be unavailable.
            </Text>
          )}
          {git.trackedAtHead === false && (
            <Text size="1" color="amber">
              Not committed yet — HEAD has no version of this path.
            </Text>
          )}
          {compare && (
            <Button size="1" variant="soft" color="gray" style={{ alignSelf: 'flex-start' }} onClick={() => ctrl.setCompare(null)}>
              Clear comparison
            </Button>
          )}
        </Flex>
      </Flex>
    </div>
  );

  let body: React.ReactNode = null;
  if (!compare) {
    body = (
      <div className="impact-empty">
        <Text size="3" color="gray">
          No comparison selected. Compare two revisions to see what changed and what it may affect.
        </Text>
      </div>
    );
  } else if (!result || result.status === 'loading') {
    body = (
      <Flex align="center" justify="center" gap="2" p="6">
        <Spinner /> <Text color="gray">Comparing…</Text>
      </Flex>
    );
  } else if (result.status === 'error') {
    body = (
      <div className="impact-pad">
        <Callout.Root color="red" variant="surface" data-testid="compare-error">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{result.message}</Callout.Text>
        </Callout.Root>
      </div>
    );
  } else if (result.status === 'blocked') {
    body = (
      <div className="impact-pad">
        <Callout.Root color="red" variant="surface" data-testid="compare-blocked">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>
            A revision contains an invalid contract, so Orbit cannot compare semantically. It will not fall back to a text diff. Fix the file at that revision (or choose a different one).
          </Callout.Text>
        </Callout.Root>
        <Flex direction="column" gap="3" mt="3">
          {result.base.invalid && <DiagList side="Base" meta={result.base} />}
          {result.target.invalid && <DiagList side="Target" meta={result.target} />}
        </Flex>
      </div>
    );
  } else {
    const { diff: df, base, target } = result;
    const { nameOf, entities } = diffLookups(df);
    const noChanges = df.changes.length === 0;
    body = (
      <div className="impact-main">
        {df.contractStatus === 'added' && (
          <Callout.Root color="green" variant="surface" size="1" mb="3" data-testid="status-added">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              The contract file does not exist in {base.label}
              {git.trackedAtHead === false && base.sel.type === 'ref' && base.sel.name === 'HEAD' ? ' (it is not committed yet)' : ''}, so everything in {target.label} is shown as added.
            </Callout.Text>
          </Callout.Root>
        )}
        {df.contractStatus === 'removed' && (
          <Callout.Root color="red" variant="surface" size="1" mb="3" data-testid="status-removed">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>The contract file does not exist in {target.label}, so everything from {base.label} is shown as removed. If it was moved or renamed, Orbit v1 compares the same path only: open the new location explicitly.</Callout.Text>
          </Callout.Root>
        )}
        <div className="bignums">
          <div className="bignum" data-testid="direct-count">
            <span className="bignum-value">{df.directlyChangedEntityIds.length}</span>
            <span className="bignum-label">Directly changed entities</span>
            <span className="bignum-sub">Their own fields, behaviors or outgoing relationships changed</span>
          </div>
          <div className="bignum potential" data-testid="potential-count">
            <span className="bignum-value">◇ {df.potentiallyAffected.length}</span>
            <span className="bignum-label">Potentially affected</span>
            <span className="bignum-sub">Inferred from relationships; not observed breakage</span>
          </div>
          <Totals diff={df} category={category} onCategory={setCategory} />
        </div>
        {noChanges ? (
          <div className="empty-inline" data-testid="no-changes">
            <Text size="3">No semantic changes between {base.label} and {target.label}</Text>
            <Text as="p" size="2" color="gray" mt="1">
              Formatting, key order and array order are ignored. Choose branches, tags or commits above to compare other revisions.
            </Text>
          </div>
        ) : (
          <div className="impact-split">
            <div className="impact-left">
              <Flex gap="2" align="center" wrap="wrap" mb="2">
                <div className="chips" role="group" aria-label="Filter by kind of change">
                  {(['all', 'guarantee', 'verification'] as const).map((g) => (
                    <button key={g} type="button" className={`fchip${group === g ? ' active' : ''}`} aria-pressed={group === g} onClick={() => setGroup(g)}>
                      {g === 'all' ? 'All' : g === 'guarantee' ? 'Product guarantees' : 'Verification metadata'}
                    </button>
                  ))}
                </div>
                <TextField.Root size="1" placeholder="Filter changes…" aria-label="Filter changes" value={query} onChange={(e) => setQuery(e.target.value)} style={{ flex: 1, minWidth: 120 }}>
                  <TextField.Slot>
                    <MagnifyingGlassIcon />
                  </TextField.Slot>
                </TextField.Root>
              </Flex>
              <div className="pane-tabs" role="tablist" aria-label="Impact lists">
                <button type="button" role="tab" aria-selected={pane === 'changes'} className={pane === 'changes' ? 'active' : ''} onClick={() => setPane('changes')}>
                  Changes ({df.changes.length})
                </button>
                <button type="button" role="tab" aria-selected={pane === 'affected'} className={pane === 'affected' ? 'active' : ''} onClick={() => setPane('affected')} data-testid="tab-affected">
                  ◇ Potentially affected ({df.potentiallyAffected.length})
                </button>
              </div>
              <div className="impact-scroll">
                {pane === 'changes' ? (
                  <ChangeList diff={df} selectedKey={s.impactSelection} onSelect={(k) => d({ type: 'selectChange', key: k })} group={group} query={query} category={category} />
                ) : df.potentiallyAffected.length === 0 ? (
                  <div className="empty-inline">
                    <Text size="2" color="gray">
                      No other entity depends on anything that changed.
                    </Text>
                  </div>
                ) : (
                  <ul className="affected-list" aria-label="Potentially affected entities">
                    {df.potentiallyAffected.map((p) => {
                      const e = entities.get(p.entityId);
                      return (
                        <li key={p.entityId} data-testid="affected-row" data-entity-id={p.entityId}>
                          <Flex align="center" gap="2" mb="1">
                            <span className="marker marker-affected">
                              <span aria-hidden>◇</span>
                              <span aria-hidden>P</span>
                            </span>
                            <Text weight="bold" size="2">
                              {nameOf(p.entityId)}
                            </Text>
                            {e && <KindBadge kind={e.kind} />}
                            {e && (
                              <Button size="1" variant="ghost" ml="auto" onClick={() => d({ type: 'selectEntity', id: e.id, kind: e.kind })}>
                                Show in {e.kind === 'capability' ? 'Product' : 'Engineering'}
                              </Button>
                            )}
                          </Flex>
                          <ImpactChain path={p} nameOf={nameOf} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
            <div className="impact-right" aria-label="Change details">
              {selected && pane === 'changes' ? (
                <ChangeDetail diff={df} change={selected} onShowIn={(id) => {
                  const e = entities.get(id);
                  if (e) d({ type: 'selectEntity', id, kind: e.kind });
                }} />
              ) : (
                <div className="empty-inline">
                  <Text size="2" color="gray">
                    {pane === 'affected' ? 'Each entity above is potentially affected because it directly or transitively depends on something that changed.' : 'Select a change to see its details.'}
                  </Text>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <main className="impact" aria-label="Impact" data-testid="impact-view">
      {header}
      {body}
    </main>
  );
}
