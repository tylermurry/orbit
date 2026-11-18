import { useMemo, useState } from 'react';
import { Button, IconButton, ScrollArea, Text, Tooltip } from '@radix-ui/themes';
import { ChevronDownIcon, ChevronRightIcon, ListBulletIcon, TrashIcon } from '@radix-ui/react-icons';
import type { Flow } from '@orbit/contract';
import { Confirm } from '../components/common';
import { FlowStage } from '../components/FlowStage';
import { Splitter } from '../components/Splitter';
import { buildTree } from '../lib/model';
import type { TreeNode } from '../lib/model';
import { loadPref, savePref } from '../lib/prefs';
import { useApp, useCtrl, useDiff, useDispatch, useEdit } from '../state/context';

const TREE_KEY = 'orbit.layout.flowTreeWidth';
const TREE_MIN = 220;
const TREE_MAX = 560;

interface Row {
  key: string;
  type: 'capability' | 'flow';
  depth: number;
  name: string;
  /** capability id, or flow id */
  id: string;
  flow?: Flow;
  status?: 'added' | 'modified' | 'removed';
  hasChildren: boolean;
  expanded: boolean;
  count: number;
}

function ExpansionIcon({ expand }: { expand: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={expand ? 'M4.5 6 L9 1.5 L13.5 6 M4.5 12 L9 16.5 L13.5 12' : 'M4.5 1.5 L9 6 L13.5 1.5 M4.5 16.5 L9 12 L13.5 16.5'} />
    </svg>
  );
}

export function FlowsView() {
  const working = useApp((s) => s.contract)!;
  const diff = useDiff();
  // When comparing (e.g. a plan), show the compared side's flows plus flows it removes, each tagged with its change.
  const contract = diff?.target ?? working;
  const status = useMemo(() => {
    const m = new Map<string, 'added' | 'modified' | 'removed'>();
    for (const c of diff?.changes ?? []) if (c.category === 'flow') m.set(c.id, c.kind);
    return m;
  }, [diff]);
  const removed = useMemo(() => (diff?.base?.flows ?? []).filter((f) => status.get(f.id) === 'removed'), [diff, status]);
  const allFlows = useMemo(() => [...(contract.flows ?? []), ...removed], [contract, removed]);
  const flowId = useApp((s) => s.flowId);
  const selectedStep = useApp((s) => s.flowStep);
  const expanded = useApp((s) => s.expanded);
  const dispatch = useDispatch();
  const ctrl = useCtrl();
  const edit = useEdit();
  const readOnly = useApp((s) => s.loadedInvalid);
  const [deleting, setDeleting] = useState(false);
  const [treeWidth, setTreeWidth] = useState(() => loadPref<number>(TREE_KEY, 320));

  // Capability hierarchy pruned to branches that hold flows; each capability's flows come first, then its children.
  const { rows, parentIds, firstFlow } = useMemo(() => {
    const flows = allFlows;
    const byCap = new Map<string, Flow[]>();
    for (const f of flows) byCap.set(f.capabilityId, [...(byCap.get(f.capabilityId) ?? []), f]);
    const inTree = new Set(contract.entities.filter((e) => e.kind === 'capability').map((e) => e.id));
    const countIn = (n: TreeNode): number => (byCap.get(n.entity.id)?.length ?? 0) + n.children.reduce((a, c) => a + countIn(c), 0);
    const out: Row[] = [];
    const parents: string[] = [];
    const isOpen = (id: string) => expanded[id] ?? true;
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const n of nodes) {
        const count = countIn(n);
        if (count === 0) continue;
        const own = byCap.get(n.entity.id) ?? [];
        const kids = n.children.filter((c) => countIn(c) > 0);
        const open = isOpen(n.entity.id);
        parents.push(n.entity.id);
        out.push({ key: `c:${n.entity.id}`, type: 'capability', depth, name: n.entity.name, id: n.entity.id, hasChildren: own.length + kids.length > 0, expanded: open, count });
        if (!open) continue;
        for (const f of own) out.push({ key: `f:${f.id}`, type: 'flow', depth: depth + 1, name: f.name, id: f.id, flow: f, status: status.get(f.id), hasChildren: false, expanded: false, count: 0 });
        walk(kids, depth + 1);
      }
    };
    walk(buildTree(contract, 'capability'), 0);
    // Flows whose capability is missing still need a home so they can be inspected and fixed.
    for (const f of flows) {
      if (inTree.has(f.capabilityId)) continue;
      out.push({ key: `f:${f.id}`, type: 'flow', depth: 0, name: f.name, id: f.id, flow: f, status: status.get(f.id), hasChildren: false, expanded: false, count: 0 });
    }
    return { rows: out, parentIds: parents, firstFlow: out.find((r) => r.type === 'flow')?.flow ?? flows[0] ?? null };
  }, [contract, allFlows, status, expanded]);

  const flow = allFlows.find((f) => f.id === flowId) ?? firstFlow;
  const flowRemoved = !!flow && status.get(flow.id) === 'removed';
  const hasFlows = allFlows.length > 0;

  const setAll = (value: boolean) => ctrl.setExpanded(Object.fromEntries(parentIds.map((id) => [id, value])));
  const pick = (f: Flow) => dispatch({ type: 'showFlow', id: f.id, step: 0 });

  return (
    <div className="flows-view" aria-label="Flows" data-view="flows">
      <aside className="tree-pane" style={{ width: treeWidth }} aria-label="Flows">
        <div className="flow-tree-toolbar">
          <Text size="1" color="gray">Flows by capability</Text>
          {parentIds.length > 0 && (
            <span className="flow-tree-toolbar-buttons">
              <Tooltip content="Expand all">
                <IconButton size="2" variant="ghost" color="gray" className="tree-expansion-button" onClick={() => setAll(true)} aria-label="Expand all"><ExpansionIcon expand /></IconButton>
              </Tooltip>
              <Tooltip content="Collapse all">
                <IconButton size="2" variant="ghost" color="gray" className="tree-expansion-button" onClick={() => setAll(false)} aria-label="Collapse all"><ExpansionIcon expand={false} /></IconButton>
              </Tooltip>
            </span>
          )}
        </div>
        <ScrollArea scrollbars="vertical" className="tree-scroll">
          {!hasFlows ? (
            <div className="tree-empty">
              <Text size="2" color="gray" as="p">No flows yet. Ask Claude to add one, or add <code>flows</code> in Raw JSON.</Text>
            </div>
          ) : (
            <div role="tree" aria-label="Flows" className="tree">
              {rows.map((r) => {
                const isSel = r.type === 'flow' && r.id === flow?.id;
                const activate = () => (r.flow ? pick(r.flow) : ctrl.setExpanded({ ...expanded, [r.id]: !r.expanded }));
                return (
                  <div
                    key={r.key}
                    role="treeitem"
                    aria-level={r.depth + 1}
                    aria-selected={r.type === 'flow' ? isSel : undefined}
                    aria-expanded={r.type === 'capability' ? r.expanded : undefined}
                    tabIndex={0}
                    className={`tree-row${isSel ? ' selected' : ''}${r.type === 'flow' ? ' flow-row' : ''}`}
                    data-flow-id={r.flow?.id}
                    style={{ paddingLeft: 6 + r.depth * 16 }}
                    onClick={activate}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        activate();
                      } else if (r.type === 'capability' && ((e.key === 'ArrowRight' && !r.expanded) || (e.key === 'ArrowLeft' && r.expanded))) {
                        e.preventDefault();
                        ctrl.setExpanded({ ...expanded, [r.id]: !r.expanded });
                      }
                    }}
                  >
                    <span className="twisty" aria-hidden>
                      {r.type === 'flow' ? <ListBulletIcon /> : r.expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                    </span>
                    <span className={`row-name truncate${r.status ? ` n-${r.status}` : ''}`}>{r.name}</span>
                    {r.status && <span className={`n-${r.status}`} style={{ fontSize: 11 }}>{r.status}</span>}
                    {r.type === 'capability' && !r.expanded && <span className="inside-count" aria-label={`${r.count} flows`}>{r.count}</span>}
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </aside>
      <Splitter width={treeWidth} min={TREE_MIN} max={TREE_MAX} label="Resize sidebar" onChange={setTreeWidth} onCommit={(w) => savePref(TREE_KEY, w)} />
      {!flow && <main className="flow-stage" aria-label="Sequence diagram"><p className="flow-empty">{hasFlows ? 'Select a flow to see its sequence diagram.' : 'Add a flow to see how a capability works step by step.'}</p></main>}
      {flow && (
        <FlowStage
          contract={flowRemoved && diff?.base ? diff.base : contract}
          flow={flow}
          step={selectedStep}
          onStep={(i) => dispatch({ type: 'setFlowStep', step: i })}
          onShowInTopology={(ids) => dispatch({ type: 'showInTopology', relationshipIds: ids })}
          actions={!readOnly && !diff && (
            <Button className="flow-delete" size="1" variant="ghost" color="red" onClick={() => setDeleting(true)} aria-label={`Delete flow ${flow.name}`}>
              <TrashIcon aria-hidden /> Delete
            </Button>
          )}
        />
      )}
      {flow && (
        <Confirm
          open={deleting}
          onOpenChange={setDeleting}
          title="Delete flow?"
          confirmLabel="Delete flow"
          danger
          onConfirm={() => {
            const id = flow.id;
            edit((c) => ({ ...c, flows: (c.flows ?? []).filter((f) => f.id !== id) }));
            dispatch({ type: 'showFlow', id: '', step: 0 });
            ctrl.toast('Flow deleted', 'info');
            setDeleting(false);
          }}
        >
          {`“${flow.name}” and its ${flow.steps.length} step${flow.steps.length === 1 ? '' : 's'} will be removed. Relationships are not affected. You can undo this.`}
        </Confirm>
      )}
    </div>
  );
}
