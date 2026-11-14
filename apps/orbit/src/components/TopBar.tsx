import { DropdownMenu, IconButton, Text, Tooltip } from '@radix-ui/themes';
import { DotsHorizontalIcon, FileTextIcon } from '@radix-ui/react-icons';
import { fileName } from '../lib/format';
import { useApp, useAppState, useCtrl, useDispatch } from '../state/context';
import { activePreset, presetComparison } from '../state/compare';
import { isDirty } from '../state/store';
import type { AppState, LifecyclePreset, ViewId } from '../state/types';
import { AiButton } from './AiAccess';
import { TerminalIcon, setTerminalOpen } from './TerminalPanel';
import { ValidateButton } from './Validation';

export function OrbitMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="orbit-mark">
      <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
      <ellipse cx="12" cy="12" rx="9.2" ry="4" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-30 12 12)" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" />
      <circle cx="19" cy="7.6" r="1.7" fill="currentColor" />
    </svg>
  );
}

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl+';

export function TopBar() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const dirty = isDirty(s);
  const hasFile = !!s.filePath && (!!s.contract || s.loadedInvalid);
  const recent = useApp((x) => x.recent);
  const terminalOpen = s.terminalOpen;
  const productName = s.contract?.product.name ?? (hasFile ? 'Invalid contract' : 'Orbit');

  return (
    <header className="topbar" role="banner">
      <div className="topbar-left">
        <span className="brand">
          <OrbitMark />
        </span>
        <div className="identity">
          {hasFile ? (
            <Tooltip content="Product settings">
              <button type="button" className="product-name" onClick={() => d({ type: 'ui', patch: { productDialog: true } })} aria-label={`Product settings for ${productName}`} disabled={!s.contract}>
                {productName}
              </button>
            </Tooltip>
          ) : (
            <span className="product-name static">Orbit</span>
          )}
          {hasFile && (
            <Tooltip content={s.filePath}>
              <span className="file-name" data-testid="file-name">
                {dirty && (
                  <span className="dirty-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes">
                    •
                  </span>
                )}
                {fileName(s.filePath)}
              </span>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="topbar-center">
        {hasFile && (
          <>
            <Switcher
              label="Capabilities"
              value={s.view === 'impact' ? null : s.view}
              options={[
                { value: 'product', label: 'Product', onSelect: () => requestView('product') },
                { value: 'engineering', label: 'Engineering', onSelect: () => requestView('engineering') },
              ]}
            />
            <ImpactSelector s={s} />
            <div className="topbar-group">
              {/* Invisible label keeps the button on the same row as the switchers below their captions. */}
              <span className="topbar-group-label" aria-hidden style={{ visibility: 'hidden' }}>
                &nbsp;
              </span>
              <ValidateButton />
            </div>
          </>
        )}
      </div>

      <div className="topbar-right">
        {hasFile && dirty && (
          <Text size="2" color="gray" data-testid="unsaved-label" className="unsaved-label">
            Unsaved changes
          </Text>
        )}
        <Tooltip content={terminalOpen ? 'Hide terminal (Ctrl+`)' : 'Claude Code terminal (Ctrl+`)'}>
          <IconButton variant={terminalOpen ? 'soft' : 'surface'} color="gray" size="2" aria-label="Toggle terminal" aria-pressed={terminalOpen} onClick={() => setTerminalOpen(d, !terminalOpen)}>
            <TerminalIcon />
          </IconButton>
        </Tooltip>
        <AiButton />
        {(
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton variant="surface" color="gray" size="2" aria-label="More actions">
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={() => void ctrl.openDialog()}>
                Open…
                <div className="rt-DropdownMenuShortcut">{MOD}O</div>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => ctrl.guard('Creating a new contract', () => d({ type: 'ui', patch: { newDialog: true } }))}>New…</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void ctrl.save()} disabled={!hasFile || !dirty}>
                Save
                <div className="rt-DropdownMenuShortcut">{MOD}S</div>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => void ctrl.saveAs()} disabled={!hasFile}>
                Save As…
                <div className="rt-DropdownMenuShortcut">⇧{MOD}S</div>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={!hasFile}
                onSelect={() => {
                  if (dirty) d({ type: 'prompt', prompt: { type: 'reload' } });
                  else void ctrl.reloadFromDisk();
                }}
              >
                Reload from disk
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => d({ type: 'ui', patch: { productDialog: true } })} disabled={!s.contract}>
                Product settings…
              </DropdownMenu.Item>
              <DropdownMenu.Sub>
                <DropdownMenu.SubTrigger>Recent files</DropdownMenu.SubTrigger>
                <DropdownMenu.SubContent>
                  {recent.length === 0 && <DropdownMenu.Item disabled>No recent files</DropdownMenu.Item>}
                  {recent.map((p) => (
                    <DropdownMenu.Item key={p} onSelect={() => ctrl.guard('Opening another file', () => void ctrl.openPath(p))}>
                      <FileTextIcon /> {fileName(p)}
                      <Text size="1" color="gray" ml="2">
                        {p}
                      </Text>
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Sub>
              <DropdownMenu.Separator />
              <DropdownMenu.Item onSelect={() => d({ type: 'ui', patch: { shortcutsOpen: true } })}>
                Keyboard shortcuts
                <div className="rt-DropdownMenuShortcut">?</div>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Root>
        )}
      </div>
    </header>
  );
}

interface SwitchOption {
  value: string;
  label: string;
  onSelect: () => void;
  /** Why the option cannot be chosen now; it stays focusable and explains itself. */
  unavailable?: string;
}

/** A labelled group of mutually exclusive options; each option is as wide as its label. Arrow keys move between them. */
function Switcher({ label, value, options }: { label: string; value: string | null; options: SwitchOption[] }) {
  const id = `switch-${label.toLowerCase()}`;
  const move = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const btns = (e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role=radio]') ?? []) as NodeListOf<HTMLButtonElement>;
    btns[(i + d + options.length) % options.length]?.focus();
  };
  const active = options.findIndex((o) => o.value === value);
  return (
    <div className="topbar-group">
      <span className="topbar-group-label" id={id}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="switcher">
        {options.map((o, i) => {
          const on = o.value === value;
          const btn = (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={o.unavailable ? true : undefined}
              data-unavailable={o.unavailable ? true : undefined}
              tabIndex={on || (active === -1 && i === 0) ? 0 : -1}
              className={`switcher-item${on ? ' on' : ''}`}
              onClick={o.onSelect}
              onKeyDown={(e) => move(e, i)}
            >
              <span className="switcher-label" data-label={o.label}>
                {o.label}
              </span>
            </button>
          );
          return o.unavailable ? (
            <Tooltip key={o.value} content={o.unavailable}>
              {btn}
            </Tooltip>
          ) : (
            btn
          );
        })}
      </div>
    </div>
  );
}

const IMPACT_OPTIONS: { value: LifecyclePreset; label: string }[] = [
  { value: 'proposal', label: 'Proposal' },
  { value: 'vs-proposal', label: 'Actual vs. Proposal' },
  { value: 'actual', label: 'Actual' },
];

/** Impact: each option opens the Impact screen sliced by a different comparison. */
function ImpactSelector({ s }: { s: AppState }) {
  const ctrl = useCtrl();
  if (!s.git?.available) return null;
  const dirty = isDirty(s);
  // Nothing is selected here while a Capabilities option is.
  const value = s.view === 'impact' ? activePreset(s.compare, s.git, s.refs, dirty) : null;
  return (
    <Switcher
      label="Impact"
      value={value}
      options={IMPACT_OPTIONS.map((o) => {
        const r = presetComparison(o.value, s.git, s.refs, dirty);
        return {
          value: o.value,
          label: o.label,
          unavailable: r.ok ? undefined : r.reason,
          onSelect: () => {
            if (ctrl.applyPreset(o.value) === null) requestView('impact');
          },
        };
      })}
    />
  );
}

// View switching must respect unapplied raw edits; App registers the guard-aware handlers.
type Handlers = { requestView: (v: ViewId) => void; requestRaw: (on: boolean) => void };
let handlers: Handlers = { requestView: () => undefined, requestRaw: () => undefined };
export function registerNavHandlers(h: Handlers) {
  handlers = h;
}
export function requestView(v: ViewId) {
  handlers.requestView(v);
}
export function requestRaw(on: boolean) {
  handlers.requestRaw(on);
}
