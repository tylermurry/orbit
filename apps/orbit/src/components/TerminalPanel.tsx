// The bottom terminal: xterm.js rendering a host pseudo-terminal that runs Claude Code in the contract's folder.
import { useEffect, useRef, useState } from 'react';
import { IconButton, Spinner, Text, Tooltip } from '@radix-ui/themes';
import { ChevronDownIcon, ReloadIcon } from '@radix-ui/react-icons';
import { Terminal } from '@xterm/xterm';
import type { ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { loadPref, savePref } from '../lib/prefs';
import type { TerminalSession } from '../host/types';
import { useApp, useCtrl, useDispatch, useHost } from '../state/context';
import { runFolderOf } from '../state/controller';
import { ValidateBar } from './ValidateBar';
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

interface ViewProps {
  cwd: string | null;
  /** Undefined runs Claude Code; otherwise this command (Validate). */
  command?: string;
  /** Changing it (re)starts the session. */
  runKey: number;
  /** Nothing starts until true; the session keeps running while hidden. */
  enabled: boolean;
  visible: boolean;
  exitText: (code: number | null) => string;
  onExit?: (code: number | null) => void;
  onSession?: (s: TerminalSession | null) => void;
  onError?: (message: string | null) => void;
}

/** One xterm.js instance bound to a host pseudo-terminal session. */
function TerminalView({ cwd, command, runKey, enabled, visible, exitText, onExit, onSession, onError }: ViewProps) {
  const host = useHost();
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<{ term: Terminal; fit: FitAddon } | null>(null);
  const sessionRef = useRef<TerminalSession | null>(null);
  const latest = useRef({ command, exitText, onExit, onSession, onError });
  latest.current = { command, exitText, onExit, onSession, onError };

  // xterm instance (one for the view's lifetime)
  useEffect(() => {
    if (!enabled || !hostRef.current || !host.openTerminal) return;
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
  }, [enabled, host]);

  // session: (re)started for the folder, or when runKey changes
  useEffect(() => {
    const t = termRef.current;
    if (!enabled || !t || !cwd || !host.openTerminal) return;
    let cancelled = false;
    let session: TerminalSession | null = null;
    t.term.reset();
    latest.current.onError?.(null);
    if (hostRef.current?.offsetParent) t.fit.fit();
    host
      .openTerminal({
        cwd,
        cols: t.term.cols,
        rows: t.term.rows,
        ...(latest.current.command !== undefined ? { command: latest.current.command } : {}),
        onData: (bytes) => t.term.write(bytes),
        onExit: (code) => {
          if (cancelled) return;
          t.term.write(`\r\n\x1b[2m${latest.current.exitText(code)}\x1b[0m\r\n`);
          sessionRef.current = null;
          latest.current.onSession?.(null);
          latest.current.onExit?.(code);
        },
      })
      .then((s) => {
        if (cancelled) return s.close();
        session = s;
        sessionRef.current = s;
        latest.current.onSession?.(s);
        if (hostRef.current?.offsetParent) t.term.focus();
      })
      .catch((e: unknown) => !cancelled && latest.current.onError?.(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      session?.close();
      if (sessionRef.current === session) sessionRef.current = null;
      latest.current.onSession?.(null);
    };
  }, [enabled, cwd, runKey, host]);

  // refit + focus when shown again
  useEffect(() => {
    const t = termRef.current;
    if (!visible || !t) return;
    requestAnimationFrame(() => {
      t.fit.fit();
      sessionRef.current?.resize(t.term.cols, t.term.rows);
      t.term.focus();
    });
  }, [visible]);

  return <div ref={hostRef} className="terminal-host" style={{ display: visible ? undefined : 'none' }} />;
}

export function TerminalPanel() {
  const host = useHost();
  const d = useDispatch();
  const ctrl = useCtrl();
  const open = useApp((s) => s.terminalOpen);
  const tab = useApp((s) => s.terminalTab);
  const validateRun = useApp((s) => s.validateRun);
  const filePath = useApp((s) => s.filePath);
  const claudeCwd = filePath ? dirnameOf(filePath) : null;
  const validation = useApp((s) => s.contract?.validation);
  const runCwd = useApp((s) => runFolderOf(s));
  const [height, setHeight] = useState(() => loadPref<number>(HEIGHT_KEY, 300));
  const [exited, setExited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [vRunning, setVRunning] = useState(false);
  const [vExit, setVExit] = useState<number | null | undefined>(undefined);
  const [vError, setVError] = useState<string | null>(null);
  const [vHidden, setVHidden] = useState(false);
  const vSession = useRef<TerminalSession | null>(null);
  const dragging = useRef<{ y: number; h: number } | null>(null);
  // Start only once the panel has been shown; afterwards hiding keeps the sessions running.
  const [started, setStarted] = useState(open);
  useEffect(() => {
    if (open) setStarted(true);
  }, [open]);
  // Each Validate run starts "running" with no exit code yet.
  useEffect(() => {
    if (validateRun > 0) {
      setVRunning(true);
      setVExit(undefined);
    }
  }, [validateRun]);

  if (!started) return null;
  const supported = !!host.openTerminal;
  const showValidate = validateRun > 0 || tab === 'validate';
  const activeTab = showValidate ? tab : 'claude';
  const cwd = activeTab === 'validate' ? runCwd : claudeCwd;
  const setTab = (t: 'claude' | 'validate') => d({ type: 'ui', patch: { terminalTab: t } });

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
        <div className="terminal-tabs" role="tablist">
          <button role="tab" aria-selected={activeTab === 'claude'} className="terminal-tab" onClick={() => setTab('claude')}>
            Claude Code
          </button>
          {showValidate && (
            <button role="tab" aria-selected={activeTab === 'validate'} className="terminal-tab" onClick={() => setTab('validate')}>
              Validate
              {vRunning && <Spinner size="1" />}
            </button>
          )}
        </div>
        {cwd && (
          <Text size="1" color="gray" className="truncate" title={cwd}>
            {shortPath(cwd)}
          </Text>
        )}
        <span style={{ flex: 1 }} />
        {supported && claudeCwd && activeTab === 'claude' && (
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

      {activeTab === 'validate' && (
        <ValidateBar
          running={vRunning}
          exitCode={vExit}
          onHideOutput={setVHidden}
          onRun={() => d({ type: 'ui', patch: { validateRun: validateRun + 1 } })}
          onStop={() => vSession.current?.close()}
        />
      )}

      {!supported ? (
        <div className="terminal-note">
          <Text size="2" color="gray">The terminal is available in the Orbit desktop app.</Text>
        </div>
      ) : !cwd ? (
        <div className="terminal-note">
          <Text size="2" color="gray">{activeTab === 'validate' ? 'Open a contract to run its tests.' : 'Open a contract to start Claude Code in its folder.'}</Text>
        </div>
      ) : (activeTab === 'validate' ? vError : error) ? (
        <div className="terminal-note">
          <Text size="2" color="red">{activeTab === 'validate' ? vError : error}</Text>
        </div>
      ) : activeTab === 'validate' && (validateRun === 0 || vHidden) ? (
        <div className="terminal-note">
          <Text size="2" color="gray">{validateRun === 0 ? 'Confirm the run values above to run the tests.' : 'Confirm the new run values above to run again.'}</Text>
        </div>
      ) : null}

      <TerminalView
        cwd={claudeCwd}
        runKey={generation}
        enabled={started && supported && !!claudeCwd}
        visible={open && activeTab === 'claude' && !error}
        exitText={() => '[Terminal exited. Restart to start Claude Code again.]'}
        onExit={() => setExited(true)}
        onError={(m) => {
          setError(m);
          if (m === null) setExited(false);
        }}
      />
      {validateRun > 0 && (
        <TerminalView
          cwd={runCwd}
          command={validation?.command}
          runKey={validateRun}
          enabled={supported && !!runCwd && !!validation}
          visible={open && activeTab === 'validate' && !vError && !vHidden}
          exitText={(code) => (code === null ? '[Stopped.]' : code === 0 ? '[Finished: all commands succeeded (exit code 0).]' : `[Finished with exit code ${code}.]`)}
          onSession={(s) => (vSession.current = s)}
          onError={setVError}
          onExit={(code) => {
            setVRunning(false);
            setVExit(code);
            void ctrl.pollResults(true);
          }}
        />
      )}
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
