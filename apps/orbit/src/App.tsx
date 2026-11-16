import { useEffect, useMemo, useRef, useState } from 'react';
import { Flex } from '@radix-ui/themes';
import { Banners } from './components/Shell';
import { TerminalPanel, setTerminalOpen } from './components/TerminalPanel';
import { NewContractDialog, ProductDialog, ShortcutsDialog } from './components/Dialogs';
import { ProjectSkills } from './components/ProjectSkills';
import { Prompts } from './components/Prompts';
import { TopBar, registerNavHandlers, requestView } from './components/TopBar';
import { Toasts } from './components/common';
import { ReviewSheet } from './components/ReviewSheet';
import { fileName } from './lib/format';
import { loadPref, savePref } from './lib/prefs';
import { setWindowTitle } from './lib/windowTitle';
import { useAppState, useCtrl, useDispatch, useHost, useStore } from './state/context';
import { isDirty, currentText } from './state/store';
import type { ViewId } from './state/types';
import { EmptyState } from './views/EmptyState';
import { ExplorerView } from './views/ExplorerView';
import { ImpactView } from './views/ImpactView';
import { RawEditor } from './views/RawEditor';
import { WorkspaceSplit } from './components/WorkspaceSplit';
import type { MemoryHost } from './host/memoryHost';

const SPLIT_VIEW_KEY = 'orbit.layout.splitView';

export function App() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const host = useHost();
  const store = useStore();
  const dirty = isDirty(s);
  const [splitView, setSplitView] = useState(() => loadPref<unknown>(SPLIT_VIEW_KEY, false) === true);
  const canSplit = !!s.filePath && !!s.contract && !s.rawMode && !!s.git?.available;
  const split = canSplit && splitView;
  const splitRef = useRef(split);
  splitRef.current = split;

  function changeLayout(nextSplit: boolean) {
    if (!canSplit || nextSplit === splitView) return;
    setSplitView(nextSplit);
    savePref(SPLIT_VIEW_KEY, nextSplit);
    if (!nextSplit && s.view !== 'impact') ctrl.setCompare(null);
  }

  // navigation handlers that respect unapplied raw edits
  useEffect(() => {
    const leaveRawGuard = (run: () => void) => {
      const st = store.getState();
      if (st.rawMode && st.rawDraft !== null && st.rawDraft !== currentText(st)) d({ type: 'prompt', prompt: { type: 'leaveRaw', run } });
      else run();
    };
    registerNavHandlers({
      requestView: (v: ViewId) =>
        leaveRawGuard(() => {
          const st = store.getState();
          if (!st.contract) return; // syntax-broken file: stay in Raw JSON
          d({ type: 'setRawMode', on: false });
          d({ type: 'setView', view: v });
          if (v === 'impact') ctrl.ensureDefaultCompare();
          else if (!splitRef.current) ctrl.setCompare(null); // diffs only exist on the Impact screen (always visible when split)
        }),
      requestRaw: (on: boolean) => {
        if (on) d({ type: 'setRawMode', on: true });
        else leaveRawGuard(() => store.getState().contract && d({ type: 'setRawMode', on: false }));
      },
    });
  }, [d, store, ctrl]);

  // background work: polling, comparison, initial file
  useEffect(() => {
    const pollMs = (host as Partial<MemoryHost>).pollMs ?? 2000;
    const stop = ctrl.startBackground(pollMs);
    void ctrl.initialize();
    return stop;
  }, [ctrl, host]);

  // Side by side, the Impact pane is always visible, so it always needs a comparison.
  useEffect(() => {
    if (split) ctrl.ensureDefaultCompare();
  }, [split, ctrl, s.git, s.refs, s.planFile]);

  // window title
  const productName = s.contract?.product.name;
  useEffect(() => {
    setWindowTitle(s.filePath ? `${dirty ? '● ' : ''}${productName ?? fileName(s.filePath)} — ${fileName(s.filePath)} — Orbit` : 'Orbit');
  }, [s.filePath, dirty, productName]);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const t = e.target as HTMLElement | null;
      const inField = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const k = e.key.toLowerCase();
      const st = store.getState();
      if (e.ctrlKey && !e.metaKey && !e.altKey && e.code === 'Backquote') {
        e.preventDefault();
        setTerminalOpen(d, !st.terminalOpen);
        return;
      }
      // Keys typed into the terminal belong to the shell / Claude Code (Ctrl+F, Ctrl+O, ... mean something there).
      if (t?.closest?.('.terminal-panel')) return;
      const hasFile = !!st.filePath;
      if (mod && k === 'o') {
        e.preventDefault();
        void ctrl.openDialog();
      } else if (mod && k === 's') {
        e.preventDefault();
        if (hasFile) void (e.shiftKey ? ctrl.saveAs() : ctrl.save());
      } else if (mod && ['1', '2', '3'].includes(k) && hasFile) {
        e.preventDefault();
        const v: ViewId = k === '1' ? 'product' : k === '2' ? 'engineering' : 'impact';
        // route through the nav handler registered above
        requestView(v);
      } else if (mod && k === 'f' && hasFile) {
        const el = document.querySelector<HTMLInputElement>('[data-tree-search]');
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
      } else if (mod && k === 'z' && !inField && !e.shiftKey) {
        e.preventDefault();
        d({ type: 'undo' });
      } else if (((mod && k === 'z' && e.shiftKey) || (e.ctrlKey && k === 'y')) && !inField) {
        e.preventDefault();
        d({ type: 'redo' });
      } else if (e.key === '?' && !inField && !mod) {
        d({ type: 'ui', patch: { shortcutsOpen: true } });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctrl, d, store]);

  const hasDoc = !!s.filePath && (!!s.contract || s.loadedInvalid);
  const body = useMemo(() => {
    if (!hasDoc) return <EmptyState />;
    if (s.rawMode || !s.contract) return <RawEditor />;
    if (split) return <WorkspaceSplit left={<ExplorerView kind={s.explorerView === 'product' ? 'capability' : 'system'} />} right={<ImpactView />} />;
    if (s.view === 'impact') return <ImpactView />;
    return <ExplorerView kind={s.view === 'product' ? 'capability' : 'system'} />;
  }, [hasDoc, s.rawMode, s.contract, s.view, s.explorerView, split]);

  return (
    <ProjectSkills>
      <Flex direction="column" className="app">
        <TopBar split={split} canSplit={canSplit} onLayoutChange={changeLayout} />
        <Banners />
        <div className="app-body">{body}</div>
        <TerminalPanel />
        <Toasts />
        <ProductDialog />
        <NewContractDialog />
        <ShortcutsDialog />
        <ReviewSheet />
        <Prompts />
      </Flex>
    </ProjectSkills>
  );
}
