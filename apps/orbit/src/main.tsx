import React from 'react';
import { createRoot } from 'react-dom/client';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import './styles.css';
import { App } from './App';
import { NotDesktop } from './views/EmptyState';
import { createMemoryHost } from './host/memoryHost';
import { McpProvider } from './mcp/context';
import { createMcpRuntime } from './mcp/runtime';
import type { OrbitHost } from './host/types';
import { createController } from './state/controller';
import { AppProvider } from './state/context';
import { createStore } from './state/store';

function useSystemAppearance(): 'light' | 'dark' {
  const [dark, setDark] = React.useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  React.useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return dark ? 'dark' : 'light';
}

type NativeBackdrop = 'liquid-glass' | 'mica' | null;

function Root({ host }: { host: OrbitHost | null }) {
  const appearance = useSystemAppearance();
  const [nativeBackdrop, setNativeBackdrop] = React.useState<NativeBackdrop>(null);
  React.useEffect(() => {
    if (host?.kind !== 'tauri') return;
    let active = true;
    void import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<NativeBackdrop>('get_native_backdrop'))
      .then((backdrop) => { if (active) setNativeBackdrop(backdrop); }, () => undefined);
    return () => { active = false; };
  }, [host]);
  const value = React.useMemo(() => {
    if (!host) return null;
    const store = createStore();
    const ctrl = createController(store, host);
    return { store, host, ctrl, mcp: createMcpRuntime({ store, ctrl, host }) };
  }, [host]);
  React.useEffect(() => value?.mcp.start(), [value]);
  return (
    <Theme accentColor="indigo" grayColor="slate" radius="medium" scaling="95%" appearance={appearance} hasBackground={!nativeBackdrop} data-native-backdrop={nativeBackdrop ?? undefined}>
      {value ? (
        <AppProvider value={value}>
          <McpProvider runtime={value.mcp}>
            <App />
          </McpProvider>
        </AppProvider>
      ) : (
        <NotDesktop />
      )}
    </Theme>
  );
}

async function selectHost(): Promise<OrbitHost | null> {
  if (window.__ORBIT_TEST_HOST__) {
    const h = createMemoryHost(window.__ORBIT_TEST_HOST__);
    window.__orbitMemoryHost = h;
    return h;
  }
  const { isTauri, createTauriHost } = await import('./host/tauriHost');
  return isTauri() ? createTauriHost() : null;
}

void selectHost().then((host) => {
  createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Root host={host} />
    </React.StrictMode>,
  );
});
