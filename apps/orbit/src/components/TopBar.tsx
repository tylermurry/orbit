import { Button, Text, Tooltip } from '@radix-ui/themes';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { useAppState, useCtrl } from '../state/context';
import { activePreset, presetComparison } from '../state/compare';
import { isDirty } from '../state/store';
import type { AppState, LifecyclePreset, ViewId } from '../state/types';
import { AiButton } from './AiAccess';
import { useProjectSkills } from './ProjectSkills';
import { ValidateButton } from './Validation';
import { FileMenu } from './FileMenu';
import { ProjectSwitcher } from './ProjectSwitcher';

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

function WorkspaceLayoutIcon({ split = false }: { split?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.75" />
      {split && <path d="M8 2v12" />}
    </svg>
  );
}

export function TopBar({ split, canSplit, onLayoutChange }: { split: boolean; canSplit: boolean; onLayoutChange: (split: boolean) => void }) {
  const s = useAppState();
  const dirty = isDirty(s);
  const hasFile = !!s.filePath && (!!s.contract || s.loadedInvalid);
  const skills = useProjectSkills();

  const left = (
    <div className="topbar-left">
      <span className="brand">
        <OrbitMark />
      </span>
      <FileMenu />
      <div className="identity">
        <ProjectSwitcher />
      </div>
    </div>
  );
  const capabilities = (
    <Switcher
      label="Capabilities"
      // Side by side, both panes are visible, so both switchers show their selection.
      value={split ? s.explorerView : s.view === 'impact' ? null : s.view}
      options={[
        {
          value: 'product',
          label: 'Product',
          onSelect: () => requestView('product'),
        },
        {
          value: 'engineering',
          label: 'Engineering',
          onSelect: () => requestView('engineering'),
        },
      ]}
    />
  );
  const right = (
    <div className="topbar-right">
      {hasFile && dirty && (
        <Text size="2" color="gray" data-testid="unsaved-label" className="unsaved-label">
          Unsaved changes
        </Text>
      )}
      {hasFile && <ValidateButton />}
      <div className="topbar-layout-actions">
        {canSplit && (
          <ToggleGroup.Root
            type="single"
            role="radiogroup"
            orientation="horizontal"
            aria-label="Workspace layout"
            className="workspace-layout-toggle"
            value={split ? 'split' : 'combined'}
            onValueChange={(value) => {
              if (value) onLayoutChange(value === 'split');
            }}
          >
            <Tooltip content="Split view">
              <ToggleGroup.Item value="split" aria-label="Split view">
                <WorkspaceLayoutIcon split />
              </ToggleGroup.Item>
            </Tooltip>
            <Tooltip content="Combined view">
              <ToggleGroup.Item value="combined" aria-label="Combined view">
                <WorkspaceLayoutIcon />
              </ToggleGroup.Item>
            </Tooltip>
          </ToggleGroup.Root>
        )}
        <AiButton />
      </div>
      {hasFile && skills?.primary && (
        <Button size="2" onClick={skills.runPrimary}>
          {skills.primary}
        </Button>
      )}
    </div>
  );

  return (
    <header className={split ? 'topbar split' : 'topbar'} role="banner">
      <div className="topbar-half">
        {left}
        {hasFile && capabilities}
      </div>
      <div className="topbar-half right">
        {hasFile && <ImpactSelector s={s} split={split} />}
        {right}
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
  { value: 'plan', label: 'Plan' },
  { value: 'plan-vs-actual', label: 'Plan vs. Actual' },
  { value: 'actual', label: 'Actual' },
];

/** Impact: each option opens the Impact screen sliced by a different comparison. */
function ImpactSelector({ s, split }: { s: AppState; split?: boolean }) {
  const ctrl = useCtrl();
  if (!s.git?.available) return null;
  // Nothing is selected here while a Capabilities option is.
  const value = s.view === 'impact' || split ? activePreset(s.compare, s.git, s.refs, s.planFile) : null;
  return (
    <Switcher
      label="Impact"
      value={value}
      options={IMPACT_OPTIONS.map((o) => {
        const r = presetComparison(o.value, s.git, s.refs, s.planFile);
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
type Handlers = {
  requestView: (v: ViewId) => void;
  requestRaw: (on: boolean) => void;
};
let handlers: Handlers = {
  requestView: () => undefined,
  requestRaw: () => undefined,
};
export function registerNavHandlers(h: Handlers) {
  handlers = h;
}
export function requestView(v: ViewId) {
  handlers.requestView(v);
}
export function requestRaw(on: boolean) {
  handlers.requestRaw(on);
}
