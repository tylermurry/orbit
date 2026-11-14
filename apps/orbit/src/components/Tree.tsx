import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Flex, ScrollArea, Text, TextField, Tooltip } from '@radix-ui/themes';
import { CheckCircledIcon, ChevronDownIcon, ChevronRightIcon, CircleIcon, CrossCircledIcon, MagnifyingGlassIcon, PlusIcon, Cross2Icon, ChatBubbleIcon } from '@radix-ui/react-icons';
import type { AssuranceSummary, EntityDiffState, EntityKind } from '@orbit/contract';
import { KIND_PLURAL, searchTree } from '../lib/model';
import type { SearchResult, TreeNode } from '../lib/model';
import { plural } from '../lib/format';
import { ChangeMarker, Legend } from './common';

interface Row {
  type: 'entity' | 'behavior';
  id: string; // dom id key
  entityId: string;
  behaviorId?: string;
  name: string;
  depth: number;
  node?: TreeNode;
  hasChildren: boolean;
  expanded: boolean;
  posinset: number;
  setsize: number;
  parentKey: string | null;
}

function Highlight({ text, q }: { text: string; q: string }) {
  const needle = q.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const i = text.toLowerCase().indexOf(needle);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="hl">{text.slice(i, i + needle.length)}</mark>
      {text.slice(i + needle.length)}
    </>
  );
}

export function AssuranceChip({ summary, hasCommit }: { summary: AssuranceSummary | undefined; hasCommit: boolean }) {
  if (!summary || summary.total === 0) return null;
  const good = hasCommit ? summary.passingCurrent : summary.withTests;
  const kind = summary.failingCurrent > 0 ? 'failing' : hasCommit && summary.passingCurrent === summary.total ? 'passing' : 'gaps';
  const icon = kind === 'failing' ? <CrossCircledIcon aria-hidden /> : kind === 'passing' ? <CheckCircledIcon aria-hidden /> : <CircleIcon aria-hidden />;
  const breakdown = [
    `${summary.total} behaviors`,
    `${summary.withTests} with tests`,
    hasCommit ? `${summary.passingCurrent} with passing evidence` : 'passing evidence unknown (no code revision selected)',
    hasCommit ? `${summary.failingCurrent} failing` : null,
    `${summary.untested} without tests`,
    `${summary.noCurrentEvidence} mapped, no current evidence`,
  ].filter(Boolean) as string[];
  const label = `${good} of ${summary.total} ${hasCommit ? 'have passing evidence' : 'have tests mapped'}${kind === 'failing' ? '; failing behaviors present' : ''}`;
  return (
    <Tooltip
      content={
        <span>
          {breakdown.map((b) => (
            <span key={b} style={{ display: 'block' }}>
              {b}
            </span>
          ))}
        </span>
      }
    >
      <span className={`chip chip-${kind}`} role="img" aria-label={label} data-testid="assurance-chip">
        {icon}
        <span aria-hidden>
          {good}/{summary.total}
        </span>
      </span>
    </Tooltip>
  );
}

export function Tree({ kind, roots, selectedId, onSelect, diffStates, assurance, hasCommit, readOnly, expanded, onExpandedChange, search, onSearch, onAdd, comparing }: {
  kind: EntityKind;
  roots: TreeNode[];
  selectedId: string | null;
  onSelect: (entityId: string, behaviorId?: string) => void;
  diffStates?: Record<string, EntityDiffState>;
  assurance: Map<string, AssuranceSummary>;
  hasCommit: boolean;
  readOnly: boolean;
  expanded: Record<string, boolean>;
  onExpandedChange: (m: Record<string, boolean>) => void;
  search: string;
  onSearch: (q: string) => void;
  onAdd: () => void;
  comparing: boolean;
}) {
  const sr: SearchResult | null = useMemo(() => searchTree(roots, search), [roots, search]);
  const total = useMemo(() => {
    let n = 0;
    const walk = (a: TreeNode[]) => a.forEach((x) => { n++; walk(x.children); });
    walk(roots);
    return n;
  }, [roots]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const isExpanded = (n: TreeNode, depth: number): boolean => {
      if (sr) return sr.visible.has(n.entity.id) && n.children.some((c) => sr.visible.has(c.entity.id));
      const v = expanded[n.entity.id];
      return v === undefined ? depth === 0 : v;
    };
    const walk = (nodes: TreeNode[], depth: number, parentKey: string | null) => {
      const list = sr ? nodes.filter((n) => sr.visible.has(n.entity.id)) : nodes;
      list.forEach((n, i) => {
        const visibleKids = sr ? n.children.filter((c) => sr.visible.has(c.entity.id)) : n.children;
        const exp = isExpanded(n, depth);
        const key = `e:${n.entity.id}`;
        const bm = sr?.behaviorMatches.get(n.entity.id) ?? [];
        out.push({ type: 'entity', id: key, entityId: n.entity.id, name: n.entity.name, depth, node: n, hasChildren: visibleKids.length > 0, expanded: exp, posinset: i + 1, setsize: list.length, parentKey });
        if (sr) bm.forEach((b, j) => out.push({ type: 'behavior', id: `b:${b.id}`, entityId: n.entity.id, behaviorId: b.id, name: b.name, depth: depth + 1, hasChildren: false, expanded: false, posinset: j + 1, setsize: bm.length, parentKey: key }));
        if (exp) walk(visibleKids, depth + 1, key);
      });
    };
    walk(roots, 0, null);
    return out;
  }, [roots, expanded, sr]);

  const selectedKey = selectedId ? `e:${selectedId}` : null;
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const effectiveFocus = focusKey && rows.some((r) => r.id === focusKey) ? focusKey : rows.some((r) => r.id === selectedKey) ? selectedKey : (rows[0]?.id ?? null);
  const refs = useRef(new Map<string, HTMLDivElement>());
  const pendingFocus = useRef(false);
  const typeBuf = useRef({ s: '', t: 0 });

  useEffect(() => {
    if (pendingFocus.current && effectiveFocus) {
      pendingFocus.current = false;
      refs.current.get(effectiveFocus)?.focus();
    }
  });

  useEffect(() => {
    if (selectedKey) refs.current.get(selectedKey)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedKey]);

  const moveTo = useCallback((key: string | undefined) => {
    if (!key) return;
    pendingFocus.current = true;
    setFocusKey(key);
  }, []);

  const toggle = (id: string, value: boolean) => onExpandedChange({ ...expanded, [id]: value });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement) return;
    const idx = rows.findIndex((r) => r.id === effectiveFocus);
    const row = rows[idx];
    if (!row) return;
    const key = e.key;
    if (key === 'ArrowDown') {
      e.preventDefault();
      moveTo(rows[Math.min(rows.length - 1, idx + 1)]?.id);
    } else if (key === 'ArrowUp') {
      e.preventDefault();
      moveTo(rows[Math.max(0, idx - 1)]?.id);
    } else if (key === 'Home') {
      e.preventDefault();
      moveTo(rows[0]?.id);
    } else if (key === 'End') {
      e.preventDefault();
      moveTo(rows[rows.length - 1]?.id);
    } else if (key === 'ArrowRight') {
      e.preventDefault();
      if (row.type === 'entity' && row.hasChildren) {
        if (!row.expanded) toggle(row.entityId, true);
        else moveTo(rows[idx + 1]?.id);
      }
    } else if (key === 'ArrowLeft') {
      e.preventDefault();
      if (row.type === 'entity' && row.hasChildren && row.expanded && !sr) toggle(row.entityId, false);
      else if (row.parentKey) moveTo(row.parentKey);
    } else if (key === 'Enter' || key === ' ') {
      e.preventDefault();
      onSelect(row.entityId, row.behaviorId);
    } else if (key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const now = Date.now();
      const tb = typeBuf.current;
      tb.s = now - tb.t > 700 ? key.toLowerCase() : tb.s + key.toLowerCase();
      tb.t = now;
      const order = [...rows.slice(idx + (tb.s.length === 1 ? 1 : 0)), ...rows.slice(0, idx + 1)];
      moveTo(order.find((r) => r.name.toLowerCase().startsWith(tb.s))?.id);
    }
  };

  const noun = KIND_PLURAL[kind].toLowerCase();
  const states = diffStates;

  return (
    <Flex direction="column" className="tree-pane-inner">
      <Flex gap="2" p="2" align="center">
        <TextField.Root
          size="2"
          style={{ flex: 1 }}
          placeholder="Search…"
          aria-label={`Search ${noun} and behaviors`}
          data-tree-search
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onSearch('');
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              moveTo(effectiveFocus ?? undefined);
            }
          }}
        >
          <TextField.Slot>
            <MagnifyingGlassIcon />
          </TextField.Slot>
          {search && (
            <TextField.Slot>
              <button type="button" className="clear-x" aria-label="Clear search" onClick={() => onSearch('')}>
                <Cross2Icon />
              </button>
            </TextField.Slot>
          )}
        </TextField.Root>
        <Tooltip content={readOnly ? 'The file has errors and is read-only' : `Add ${kind}`}>
          <Button size="2" variant="soft" onClick={onAdd} disabled={readOnly} aria-label={`Add ${kind}`}>
            <PlusIcon aria-hidden /> Add
          </Button>
        </Tooltip>
      </Flex>
      {comparing && (
        <div className="tree-legend">
          <Legend />
        </div>
      )}
      <ScrollArea scrollbars="vertical" className="tree-scroll">
        {total === 0 && !sr ? (
          <div className="tree-empty">
            <Text size="2" color="gray" as="p" mb="2">
              No {noun} yet.
            </Text>
            <Button size="2" onClick={onAdd} disabled={readOnly}>
              <PlusIcon /> Add {kind}
            </Button>
          </div>
        ) : sr && rows.length === 0 ? (
          <div className="tree-empty" data-testid="no-matches">
            <Text size="2" color="gray" as="p" mb="2">
              No matches for “{search}”
            </Text>
            <Button size="1" variant="soft" color="gray" onClick={() => onSearch('')}>
              Clear search
            </Button>
          </div>
        ) : (
          <div role="tree" aria-label={KIND_PLURAL[kind]} className="tree" onKeyDown={onKeyDown}>
            {rows.map((r) => {
              const isSel = r.type === 'entity' && r.id === selectedKey;
              const st = r.type === 'entity' ? states?.[r.entityId] : undefined;
              const ghost = r.node?.ghost;
              const summary = r.type === 'entity' && !ghost ? assurance.get(r.entityId) : undefined;
              return (
                <Fragment key={r.id}>
                  <div
                    ref={(el) => {
                      if (el) refs.current.set(r.id, el);
                      else refs.current.delete(r.id);
                    }}
                    role="treeitem"
                    aria-level={r.depth + 1}
                    aria-posinset={r.posinset}
                    aria-setsize={r.setsize}
                    aria-expanded={r.type === 'entity' && r.hasChildren ? r.expanded : undefined}
                    aria-selected={r.type === 'entity' ? isSel : false}
                    aria-label={r.type === 'behavior' ? `Behavior: ${r.name}` : undefined}
                    tabIndex={r.id === effectiveFocus ? 0 : -1}
                    className={`tree-row${isSel ? ' selected' : ''}${ghost ? ' ghost' : ''}${r.type === 'behavior' ? ' behavior-row' : ''}`}
                    data-entity-id={r.entityId}
                    data-status={st?.status}
                    style={{ paddingLeft: 6 + r.depth * 16 }}
                    onClick={() => {
                      setFocusKey(r.id);
                      onSelect(r.entityId, r.behaviorId);
                    }}
                    onFocus={() => setFocusKey(r.id)}
                  >
                    {r.type === 'entity' ? (
                      <span
                        className="twisty"
                        aria-hidden
                        onClick={(e) => {
                          if (!r.hasChildren || sr) return;
                          e.stopPropagation();
                          toggle(r.entityId, !r.expanded);
                        }}
                      >
                        {r.hasChildren ? r.expanded ? <ChevronDownIcon /> : <ChevronRightIcon /> : null}
                      </span>
                    ) : (
                      <span className="twisty" aria-hidden>
                        <ChatBubbleIcon />
                      </span>
                    )}
                    <span className="row-name truncate">
                      <Highlight text={r.name} q={r.type === 'entity' || sr ? search : ''} />
                      {r.type === 'behavior' && sr && (
                        <Text size="1" color="gray" className="row-sub">
                          {' '}
                          — behavior
                        </Text>
                      )}
                    </span>
                    {ghost && (
                      <Text size="1" color="gray" className="ghost-label">
                        {st?.status === 'added' ? 'Not in working copy' : 'Removed'}
                      </Text>
                    )}
                    {st && st.changedDescendants > 0 && (
                      <Text size="1" color="gray" className="inside-count" title={`${plural(st.changedDescendants, 'item')} changed inside`}>
                        {st.changedDescendants} changed inside
                      </Text>
                    )}
                    {st && st.status !== 'unchanged' && <ChangeMarker status={st.status} />}
                    {summary && <AssuranceChip summary={summary} hasCommit={hasCommit} />}
                  </div>
                </Fragment>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </Flex>
  );
}
