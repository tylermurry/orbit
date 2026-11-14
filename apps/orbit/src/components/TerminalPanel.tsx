// The bottom terminal: xterm.js rendering a host pseudo-terminal that runs Claude Code in the contract's folder.
import { useEffect, useRef, useState } from 'react';
import { IconButton, Text, Tooltip } from '@radix-ui/themes';
import { ChevronDownIcon, ReloadIcon } from '@radix-ui/react-icons';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { loadPref, savePref } from '../lib/prefs';
import type { TerminalSession } from '../host/types';
import { useApp, useDispatch, useHost } from '../state/context';
import type { Action } from '../state/store';
import { TERMINAL_OPEN_KEY } from '../state/store';

const HEIGHT_KEY = 'orbit.layout.terminalHeight';
const MIN_HEIGHT = 120;

export function setTerminalOpen(d: (a: Action) => void, open: boolean) {
  d({ type: 'ui', patch: { terminalOpen: open } });
  savePref(TERMINAL_OPEN_KEY, open);
}

/** Folder that holds a file (handles / and \\ separators). */
export function dirnameOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i <= 0 ? path.slice(0, i + 1) || '/' : path.slice(0, i);
}

function shortPath(p: string): string {
  const m = /^(\/Users\/[^/]+|\/home\/[^/]+)(\/|$)/.exec(p);
  return m ? `~${p.slice(m[1].length)}` : p;
}

const LIGHT: ITheme = {
  background: '#ffffff', foreground: '#1c2024', cursor: '#1c2024', cursorAccent: '#ffffff', selectionBackground: '#c7d2fe',
  black: '#1c2024', red: '#ce2c31', green: '#18794e', yellow: '#946800', blue: '#3e63dd', magenta: '#8e4ec6', cyan: '#0d74ce', white: '#b9bbc6',
  brightBlack: '#60646c', brightRed: '#e5484d', brightGreen: '#30a46c', brightYellow: '#ab6400', brightBlue: '#5472e4', brightMagenta: '#a560d8', brightCyan: '#0090ff', brightWhite: '#e0e1e6',
};
const DARK: ITheme = {
  background: '#111113', foreground: '#edeef0', cursor: '#edeef0', cursorAccent: '#111113', selectionBackground: '#3a4580',
  black: '#272a2d', red: '#ff9592', green: '#3dd68c', yellow: '#ffca16', blue: '#9eb1ff', magenta: '#d19dff', cyan: '#70b8ff', white: '#b0b4ba',
  brightBlack: '#696e77', brightRed: '#ffadaa', brightGreen: '#71e8a8', brightYellow: '#ffe066', brightBlue: '#b6c4ff', brightMagenta: '#e2bfff', brightCyan: '#9ecbff', brightWhite: '#edeef0',
};
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function TerminalPanel() {
  const host = useHost();
  const d = useDispatch();
  const open = useApp((s) => s.terminalOpen);
  const filePath = useApp((s) => s.filePath);
  const cwd = filePath ? dirnameOf(filePath) : null;
  const [height, setHeight] = useState(() => loadPref<number>(HEIGHT_KEY, 300));
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const dragging = useRef<{ y: number; h: number } | null>(null);
  // Start only once the panel has been shown; afterwards hiding keeps the session running.
  const [started, setStarted] = useState(open);
  useEffect(() => {
    if (open) setStarted(true);
  }, [open]);

  // xterm instance (one for the panel's lifetime)
  useEffect(() => {
    if (!started || !hostRef.current || !host.openTerminal) return;
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
      fontSize: 12.5,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
      theme: darkQuery().matches ? DARK : LIGHT,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = { term, fit };
    const sub = term.onData((data) => sessionRef.current?.write(data));
    const mq = darkQuery();
    const onScheme = () => (term.options.theme = mq.matches ? DARK : LIGHT);
    mq.addEventListener('change', onScheme);
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!hostRef.current?.offsetParent) return; // hidden
        fit.fit();
        sessionRef.current?.resize(term.cols, term.rows);
      });
    });
    ro.observe(hostRef.current);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
      mq.removeEventListener('change', onScheme);
      sub.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [started, host]);

  // session: (re)started for the contract's folder, or on Restart
  useEffect(() => {
    const t = termRef.current;
    if (!started || !t || !cwd || !host.openTerminal) return;
    let cancelled = false;
    let session: TerminalSession | null = null;
    t.term.reset();
    setExited(false);
    setError(null);
    if (hostRef.current?.offsetParent) t.fit.fit();
    host
      .openTerminal({
        cwd,
        cols: t.term.cols,
        rows: t.term.rows,
        onData: (bytes) => t.term.write(bytes),
        onExit: () => {
          if (cancelled) return;
          t.term.write('\r\n\x1b[2m[Terminal exited. Restart to start Claude Code again.]\x1b[0m\r\n');
          setExited(true);
          sessionRef.current = null;
        },
      })
      .then((s) => {
        if (cancelled) return s.close();
        session = s;
        sessionRef.current = s;
        if (hostRef.current?.offsetParent) t.term.focus();
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      session?.close();
      if (sessionRef.current === session) sessionRef.current = null;
    };
  }, [started, cwd, generation, host]);

  // refit + focus when shown again
  useEffect(() => {
    const t = termRef.current;
    if (!open || !t) return;
    requestAnimationFrame(() => {
      t.fit.fit();
      sessionRef.current?.resize(t.term.cols, t.term.rows);
      t.term.focus();
    });
  }, [open]);

  if (!started) return null;
  const supported = !!host.openTerminal;

  return (
    <section className="terminal-panel" style={{ height, display: open ? undefined : 'none' }} aria-label="Terminal">
      <div
        className="terminal-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onPointerDown={(e) => {
          dragging.current = { y: e.clientY, h: height };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!dragging.current) return;
          const max = Math.round(window.innerHeight * 0.8);
          setHeight(Math.min(max, Math.max(MIN_HEIGHT, dragging.current.h + dragging.current.y - e.clientY)));
        }}
        onPointerUp={() => {
          dragging.current = null;
          savePref(HEIGHT_KEY, height);
        }}
      />
      <div className="terminal-header">
        <Text size="1" weight="medium">
          Claude Code
        </Text>
        {cwd && (
          <Text size="1" color="gray" className="truncate" title={cwd}>
            {shortPath(cwd)}
          </Text>
        )}
        <span style={{ flex: 1 }} />
        {supported && cwd && (
          <Tooltip content={exited ? 'Start again' : 'Restart'}>
            <IconButton size="1" variant="ghost" color="gray" aria-label="Restart terminal" onClick={() => setGeneration((g) => g + 1)}>
              <ReloadIcon />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content="Hide terminal (Ctrl+`)">
          <IconButton size="1" variant="ghost" color="gray" aria-label="Hide terminal" onClick={() => setTerminalOpen(d, false)}>
            <ChevronDownIcon />
          </IconButton>
        </Tooltip>
      </div>
      {!supported ? (
        <div className="terminal-note">
          <Text size="2" color="gray">The terminal is available in the Orbit desktop app.</Text>
        </div>
      ) : !cwd ? (
        <div className="terminal-note">
          <Text size="2" color="gray">Open a contract to start Claude Code in its folder.</Text>
        </div>
      ) : error ? (
        <div className="terminal-note">
          <Text size="2" color="red">{error}</Text>
        </div>
      ) : null}
      <div ref={hostRef} className="terminal-host" style={{ display: supported && cwd && !error ? undefined : 'none' }} />
    </section>
  );
}

/** Small "terminal" glyph (Radix icons has none). */
export function TerminalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="12" height="10" rx="1.5" stroke="currentColor" />
      <path d="M4 6l2 1.5L4 9M7.5 9.5h3" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
