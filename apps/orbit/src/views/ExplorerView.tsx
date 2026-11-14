import { useEffect, useMemo, useRef, useState } from 'react';
import { Callout, Flex, Text } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import type { Entity, EntityKind } from '@orbit/contract';
import { buildTree } from '../lib/model';
import { loadPref, savePref } from '../lib/prefs';
import { EntityCreateDialog } from '../components/EntityDialogs';
import { EntityDetail } from '../components/EntityDetail';
import { Tree } from '../components/Tree';
import { revLabel } from '../state/compare';
import { useApp, useAssurance, useCtrl, useDiff, useDispatch, useInspected } from '../state/context';

const WIDTH_KEY = 'orbit.layout.treeWidth';

export function ExplorerView({ kind }: { kind: EntityKind }) {
  const contract = useApp((s) => s.contract)!;
  const readOnlyDoc = useApp((s) => s.loadedInvalid);
  const selectedId = useApp((s) => s.selected[kind]);
  const expanded = useApp((s) => s.expanded);
  const search = useApp((s) => s.search);
  const compare = useApp((s) => s.compare);
  const d = useDispatch();
  const ctrl = useCtrl();
  const diff = useDiff();
  const commit = useInspected();
  const assurance = useAssurance(contract);
  const [adding, setAdding] = useState(false);
  const [width, setWidth] = useState(() => loadPref<number>(WIDTH_KEY, 320));
  const dragging = useRef(false);

  // Entities that exist in the comparison but not in the working copy are shown as read-only ghosts.
  const ghosts = useMemo(() => {
    if (!diff) return [] as Entity[];
    const have = new Set(contract.entities.map((e) => e.id));
    const out: Entity[] = [];
    for (const id of Object.keys(diff.entityStates)) {
      if (have.has(id)) continue;
      const st = diff.entityStates[id];
      const e = (st.status === 'removed' ? diff.base : diff.target ?? diff.base)?.entities.find((x) => x.id === id) ?? diff.base?.entities.find((x) => x.id === id);
      if (e) out.push(e);
    }
    return out;
  }, [diff, contract]);

  const roots = useMemo(() => buildTree(contract, kind, ghosts), [contract, kind, ghosts]);
  const ghostMap = useMemo(() => new Map(ghosts.map((g) => [g.id, g])), [ghosts]);

  const live = selectedId ? contract.entities.find((e) => e.id === selectedId && e.kind === kind) : undefined;
  const ghost = !live && selectedId ? ghostMap.get(selectedId) : undefined;
  const entity = live ?? ghost ?? roots[0]?.entity;
  const isGhost = !live && !!entity && ghostMap.has(entity.id);
  const state = entity ? diff?.entityStates[entity.id] : undefined;
  const detailContract = isGhost && diff ? ((state?.status === 'removed' ? diff.base : diff.target) ?? diff.base ?? contract) : contract;

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
          diffStates={diff?.entityStates}
          assurance={assurance}
          hasCommit={!!commit}
          readOnly={readOnlyDoc}
          expanded={expanded}
          onExpandedChange={ctrl.setExpanded}
          search={search}
          onSearch={(q) => d({ type: 'setSearch', search: q })}
          onAdd={() => setAdding(true)}
          comparing={!!compare}
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
          <EntityDetail
            key={entity.id + (isGhost ? ':ghost' : '')}
            entity={entity}
            contract={detailContract}
            readOnly={readOnlyDoc || isGhost}
            state={state}
            states={diff?.entityStates}
            ghostNote={
              isGhost
                ? state?.status === 'removed'
                  ? `This ${entity.kind} was removed in the comparison target. You are viewing the base version (${compare ? revLabel(compare.base) : 'base'}), read-only.`
                  : `This ${entity.kind} exists in ${compare ? revLabel(compare.target) : 'the target'} but not in your working copy. Read-only.`
                : undefined
            }
          />
        ) : (
          <Flex align="center" justify="center" className="detail-empty" direction="column" gap="2">
            <Callout.Root variant="surface" size="1">
              <Callout.Icon>
                <InfoCircledIcon />
              </Callout.Icon>
              <Callout.Text>Select or add {kind === 'capability' ? 'a capability' : 'a system'} to see its details.</Callout.Text>
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
