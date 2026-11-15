import { useEffect, useMemo, useState } from 'react';
import { Button, Callout, Flex, Heading, Spinner, Text } from '@radix-ui/themes';
import { ExclamationTriangleIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import type { Diagnostic } from '@orbit/contract';
import { diffLookups } from '../components/Changes';
import { AreaBadge, ChangedEntityList, EntityChangeDetail, changedEntities, entityIdFromKey } from '../components/ImpactEntities';
import { ImpactChain } from '../components/ImpactChain';
import { ChangePill, Legend } from '../components/common';
import { sideLabel } from '../state/compare';
import { Splitter } from '../components/Splitter';
import { loadPref, savePref } from '../lib/prefs';
import { useAppState, useDispatch } from '../state/context';
import type { SnapMeta } from '../state/types';

function DiagList({ side, meta }: { side: string; meta: SnapMeta }) {
  const list: Diagnostic[] = meta.diagnostics.filter((x) => x.severity === 'error');
  return (
    <div className="blocked-side">
      <Text weight="bold" size="2" as="div">
        {side}: {sideLabel(meta.sel)}
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

const LIST_WIDTH_KEY = 'orbit.layout.impactListWidth';

export function ImpactView() {
  const s = useAppState();
  const d = useDispatch();
  const git = s.git;
  const [pane, setPane] = useState<'changes' | 'affected'>('changes');
  const [listWidth, setListWidth] = useState(() => loadPref<number>(LIST_WIDTH_KEY, 380));
  const result = s.compareResult;
  const diff = result?.status === 'ready' ? result.diff : null;
  const items = useMemo(() => (diff ? changedEntities(diff) : []), [diff]);
  const selectedId = entityIdFromKey(s.impactSelection);
  const selected = items.find((i) => i.entity.id === selectedId) ?? null;

  useEffect(() => {
    if (diff && !selected && items.length) d({ type: 'selectChange', key: `entity:${items[0].entity.id}` });
  }, [diff, selected, items, d]);

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
            <Callout.Text>Nothing is wrong with your contract. Product and Engineering views, editing, Raw JSON, tests and saving all work without Git.</Callout.Text>
          </Callout.Root>
        </div>
      </main>
    );
  }

  const compare = s.compare;
  const legendAndDetails = (
    <>
      <Legend planned={compare?.target.type === 'plan'} />
    </>
  );
  let tabs: React.ReactNode = null;

  let body: React.ReactNode = null;
  if (!compare) {
    body = (
      <div className="impact-empty">
        <Text size="3" color="gray">
          Choose Plan, Plan vs. Actual or Actual under Impact to see what changed and what it may affect.
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
          <Callout.Text>One of the versions being compared is not a valid contract, so Orbit cannot show what changed. Fix that version of the file first.</Callout.Text>
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
    const showIn = (id: string) => {
      const e = entities.get(id);
      if (e) d({ type: 'selectEntity', id, kind: e.kind });
    };
    if (!noChanges)
      tabs = (
        <div className="impact-tabs switcher" role="tablist" aria-label="Impact lists">
          <button type="button" role="tab" aria-selected={pane === 'changes'} className={`switcher-item${pane === 'changes' ? ' on' : ''}`} onClick={() => setPane('changes')}>
            Changes ({items.length})
          </button>
          <button type="button" role="tab" aria-selected={pane === 'affected'} className={`switcher-item${pane === 'affected' ? ' on' : ''}`} onClick={() => setPane('affected')} data-testid="tab-affected">
            Potentially affected ({df.potentiallyAffected.length})
          </button>
        </div>
      );
    body = (
      <div className="impact-main">
        {df.contractStatus === 'added' && (
          <Callout.Root color="green" variant="surface" size="1" mb="3" data-testid="status-added">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              The contract does not exist in {sideLabel(base.sel)}, so everything in {sideLabel(target.sel)} is shown as added.
            </Callout.Text>
          </Callout.Root>
        )}
        {df.contractStatus === 'removed' && (
          <Callout.Root color="red" variant="surface" size="1" mb="3" data-testid="status-removed">
            <Callout.Icon>
              <InfoCircledIcon />
            </Callout.Icon>
            <Callout.Text>
              The contract does not exist in {sideLabel(target.sel)}, so everything from {sideLabel(base.sel)} is shown as removed. If it was moved or renamed, open the new location explicitly.
            </Callout.Text>
          </Callout.Root>
        )}
        {noChanges ? (
          <div className="empty-inline" data-testid="no-changes">
            <Text size="3">No product changes in this view</Text>
            <Text as="p" size="2" color="gray" mt="1">
              Formatting and ordering differences are ignored.
            </Text>
          </div>
        ) : (
          <>
            <div className="explorer impact-split">
              <aside className="tree-pane impact-left" style={{ width: listWidth }} aria-label="Impact list">
                <div className="impact-scroll">
                  {pane === 'changes' ? (
                    <ChangedEntityList items={items} selectedKey={s.impactSelection} onSelect={(k) => d({ type: 'selectChange', key: k })} labels={result.planLabels} planned={target.sel.type === 'plan'} />
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
                              <ChangePill status="affected" long />
                              <Text weight="bold" size="2">
                                {nameOf(p.entityId)}
                              </Text>
                              {e && <AreaBadge kind={e.kind} />}
                              {e && (
                                <Button size="1" variant="ghost" ml="auto" onClick={() => showIn(e.id)}>
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
              </aside>
              <Splitter width={listWidth} min={240} max={900} label="Resize change list" onChange={setListWidth} onCommit={(w) => savePref(LIST_WIDTH_KEY, w)} />
              <div className="detail impact-right" aria-label="Change details">
                <div className="detail-inner">
                  {selected && pane === 'changes' ? (
                    <EntityChangeDetail diff={df} item={selected} labels={result.planLabels} proposed={target.sel.type === 'plan'} canShowIn={(id) => !!s.contract?.entities.some((e) => e.id === id)} onShowIn={showIn} />
                  ) : (
                    <div className="empty-inline">
                      <Text size="2" color="gray">
                        {pane === 'affected' ? 'Each entity above is potentially affected because it directly or transitively depends on something that changed.' : 'Select a change to see its details.'}
                      </Text>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <main className="impact" aria-label="Impact" data-testid="impact-view">
      <div className="impact-toolbar">
        {tabs}
        {legendAndDetails}
      </div>
      {body}
    </main>
  );
}
