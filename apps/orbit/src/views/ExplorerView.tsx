import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout, Flex, Text } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import type { EntityKind } from '@orbit/contract';
import { applyViewFilter, buildTree, moveEntity, nudgeEntity, pruneTree } from '../lib/model';
import { loadPref, savePref } from '../lib/prefs';
import { EntityCreateDialog } from '../components/EntityDialogs';
import { EntityDetail } from '../components/EntityDetail';
import { Tree } from '../components/Tree';
import { useApp, useAssurance, useCtrl, useDispatch } from '../state/context';

const WIDTH_KEY = 'orbit.layout.treeWidth';

export function ExplorerView({ kind }: { kind: EntityKind }) {
  const contract = useApp((s) => s.contract)!;
  const readOnlyDoc = useApp((s) => s.loadedInvalid);
  const selectedId = useApp((s) => s.selected[kind]);
  const expanded = useApp((s) => s.expanded);
  const search = useApp((s) => s.search);
  const viewFilter = useApp((s) => s.viewFilter);
  const d = useDispatch();
  const ctrl = useCtrl();
  const assurance = useAssurance(contract);
  const [adding, setAdding] = useState(false);
  const [width, setWidth] = useState(() => loadPref<number>(WIDTH_KEY, 320));
  const dragging = useRef(false);

  const allRoots = useMemo(() => buildTree(contract, kind), [contract, kind]);
  const filter = useMemo(() => applyViewFilter(allRoots, viewFilter), [allRoots, viewFilter]);
  const roots = useMemo(() => (filter ? pruneTree(allRoots, filter.visible) : allRoots), [allRoots, filter]);
  const firstMatch = filter ? contract.entities.find((e) => e.kind === kind && (filter.matches.has(e.id) || filter.behaviorMatches.has(e.id))) : undefined;
  const selected = selectedId ? contract.entities.find((e) => e.id === selectedId && e.kind === kind) : undefined;
  const entity = (selected && (!filter || filter.visible.has(selected.id)) ? selected : undefined) ?? firstMatch ?? roots[0]?.entity;

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 });
  }, [entity?.id]);

  const onDrag = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const left = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().left;
    setWidth(Math.min(560, Math.max(220, e.clientX - left)));
  };

  return (
    <div className="explorer" data-view={kind}>
      <aside className="tree-pane" style={{ width }} aria-label={kind === 'capability' ? 'Capabilities' : 'Systems'}>
        <Tree
          kind={kind}
          roots={roots}
          selectedId={entity?.id ?? null}
          onSelect={(id, behaviorId) => d({ type: 'selectEntity', id, kind, behaviorId: behaviorId ?? null })}
          onFocusBehaviors={(id, behaviorIds) => d({ type: 'focusBehaviors', id, kind, behaviorIds })}
          assurance={assurance}
          readOnly={readOnlyDoc}
          expanded={expanded}
          onExpandedChange={ctrl.setExpanded}
          search={search}
          onSearch={(q) => d({ type: 'setSearch', search: q })}
          onAdd={() => setAdding(true)}
          onMove={(id, targetId, pos) => d({ type: 'edit', fn: (c) => moveEntity(c, id, targetId, pos) })}
          onNudge={(id, dir) => d({ type: 'edit', fn: (c) => nudgeEntity(c, id, dir) })}
          filter={filter}
        />
      </aside>
      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={220}
        aria-valuemax={560}
        tabIndex={0}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={onDrag}
        onPointerUp={() => {
          dragging.current = false;
          savePref(WIDTH_KEY, width);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const w = Math.min(560, Math.max(220, width + (e.key === 'ArrowRight' ? 16 : -16)));
            setWidth(w);
            savePref(WIDTH_KEY, w);
          }
        }}
      />
      <main className="detail" ref={scrollRef} aria-label="Details">
        {entity ? (
          <EntityDetail key={entity.id} entity={entity} contract={contract} readOnly={readOnlyDoc} />
        ) : (
          <Flex align="center" justify="center" className="detail-empty" direction="column" gap="2">
            <Callout.Root variant="surface" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>
                {filter ? `No ${kind === 'capability' ? 'capabilities' : 'systems'} match the current filter.` : `Select or add ${kind === 'capability' ? 'a capability' : 'a system'} to see its details.`}
              </Callout.Text>
            </Callout.Root>
            <Text size="2" color="gray">
              {kind === 'capability' ? 'Capabilities describe what users can do.' : 'Systems describe the internal components that support capabilities.'}
            </Text>
          </Flex>
        )}
      </main>
      <EntityCreateDialog open={adding} onOpenChange={setAdding} contract={contract} kind={kind} selectedId={entity?.id ?? null} />
    </div>
  );
}
