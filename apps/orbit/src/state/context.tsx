import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { computeAssurance, parseContract } from '@orbit/contract';
import type { AssuranceContext, AssuranceSummary, Diagnostic, OrbitContract, ParseResult, SemanticDiff } from '@orbit/contract';
import type { OrbitHost } from '../host/types';
import type { Controller } from './controller';
import { assuranceContext, currentText } from './store';
import type { Action, Store } from './store';
import type { AppState } from './types';

interface Ctx {
  store: Store;
  host: OrbitHost;
  ctrl: Controller;
}

const AppContext = createContext<Ctx | null>(null);

export function AppProvider({ value, children }: { value: Ctx; children: ReactNode }) {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

function useCtx(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('AppProvider missing');
  return c;
}

export function useApp<T>(selector: (s: AppState) => T): T {
  const { store } = useCtx();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export function useAppState(): AppState {
  return useApp((s) => s);
}

export function useDispatch(): (a: Action) => void {
  return useCtx().store.dispatch;
}
export function useCtrl(): Controller {
  return useCtx().ctrl;
}
export function useHost(): OrbitHost {
  return useCtx().host;
}
export function useStore(): Store {
  return useCtx().store;
}

/** Edit the working contract (undoable). */
export function useEdit(): (fn: (c: OrbitContract) => OrbitContract) => void {
  const d = useDispatch();
  return useMemo(() => (fn) => d({ type: 'edit', fn }), [d]);
}

/** Test results and the proposal time that assurance is judged against. */
export function useAssuranceCtx(): AssuranceContext {
  return useApp(assuranceContext);
}

export function useAssurance(contract: OrbitContract | null): Map<string, AssuranceSummary> {
  const ctx = useAssuranceCtx();
  return useMemo(() => (contract ? computeAssurance(contract, ctx) : new Map()), [contract, ctx]);
}

// Small parse cache: diagnostics are derived from the text the user would see in the Raw editor.
const parseCache = new Map<string, ParseResult>();
export function parseCached(text: string): ParseResult {
  let r = parseCache.get(text);
  if (!r) {
    r = parseContract(text);
    const seen = new Set<string>();
    r = { ...r, diagnostics: r.diagnostics.filter((x) => { const k = `${x.code}|${x.message}|${x.line}|${x.column}|${x.path}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
    parseCache.set(text, r);
    if (parseCache.size > 6) parseCache.delete(parseCache.keys().next().value as string);
  }
  return r;
}

export function useDiagnostics(): Diagnostic[] {
  const s = useAppState();
  const text = s.contract || s.diskText || s.rawDraft !== null ? (s.rawDraft ?? currentText(s)) : '';
  return useMemo(() => (text ? parseCached(text).diagnostics : []), [text]);
}

export function useDiff(): SemanticDiff | null {
  const r = useApp((s) => s.compareResult);
  return r && r.status === 'ready' ? r.diff : null;
}
