import { Badge, Button, DropdownMenu, IconButton, SegmentedControl, Text, Tooltip } from '@radix-ui/themes';
import { CheckIcon, DotsHorizontalIcon, ExclamationTriangleIcon, FilePlusIcon, FileTextIcon, CodeIcon, ListBulletIcon, OpenInNewWindowIcon } from '@radix-ui/react-icons';
import { fileName } from '../lib/format';
import { useApp, useAppState, useCtrl, useDiagnostics, useDispatch } from '../state/context';
import { isDirty } from '../state/store';
import type { ViewId } from '../state/types';
import { AiButton } from './AiAccess';
import { CompareButton } from './CompareControl';
import { EvidenceControl } from './EvidenceControl';

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
  const diagnostics = useDiagnostics();
  const dirty = isDirty(s);
  const hasFile = !!s.filePath && (!!s.contract || s.loadedInvalid);
  const errors = diagnostics.filter((x) => x.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  const recent = useApp((x) => x.recent);
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
          <SegmentedControl.Root value={s.view} size="2" aria-label="View">
            <SegmentedControl.Item value="product" onClick={() => requestView('product')}>
              Product
            </SegmentedControl.Item>
            <SegmentedControl.Item value="engineering" onClick={() => requestView('engineering')}>
              Engineering
            </SegmentedControl.Item>
            <SegmentedControl.Item value="impact" onClick={() => requestView('impact')}>
              Impact
            </SegmentedControl.Item>
          </SegmentedControl.Root>
        )}
      </div>

      <div className="topbar-right">
        {hasFile && (
          <>
            <CompareButton />
            <EvidenceControl />
            <Tooltip content={diagnostics.length ? `${errors} errors, ${warnings} warnings` : 'No problems'}>
              <Button variant="surface" color={errors ? 'red' : warnings ? 'amber' : 'gray'} size="2" aria-label={`Diagnostics: ${errors} errors, ${warnings} warnings`} onClick={() => d({ type: 'ui', patch: { diagnosticsOpen: true } })} className="topbar-btn">
                {errors ? <ExclamationTriangleIcon aria-hidden /> : <CheckIcon aria-hidden />}
                {diagnostics.length > 0 && (
                  <Badge color={errors ? 'red' : 'amber'} variant="solid" radius="full" data-testid="diag-count">
                    {errors + warnings}
                  </Badge>
                )}
              </Button>
            </Tooltip>
            <Button variant={s.rawMode ? 'solid' : 'surface'} color={s.rawMode ? 'indigo' : 'gray'} size="2" aria-pressed={s.rawMode} onClick={() => requestRaw(!s.rawMode)} className="topbar-btn">
              <CodeIcon aria-hidden />
              Raw JSON
            </Button>
            <Tooltip content="Tests & evidence">
              <IconButton variant="surface" color="gray" size="2" aria-label="Tests & evidence" disabled={!s.contract} onClick={() => d({ type: 'ui', patch: { libraryOpen: true } })}>
                <ListBulletIcon />
              </IconButton>
            </Tooltip>
          </>
        )}
        <AiButton />
        <Tooltip content={`Open (${MOD}O)`}>
          <IconButton variant="surface" color="gray" size="2" aria-label="Open contract" onClick={() => void ctrl.openDialog()}>
            <OpenInNewWindowIcon />
          </IconButton>
        </Tooltip>
        <Tooltip content="New contract">
          <IconButton variant="surface" color="gray" size="2" aria-label="New contract" onClick={() => ctrl.guard('Creating a new contract', () => d({ type: 'ui', patch: { newDialog: true } }))}>
            <FilePlusIcon />
          </IconButton>
        </Tooltip>
        {hasFile && (
          <Button
            size="2"
            variant={dirty ? 'solid' : 'soft'}
            color={dirty ? 'indigo' : 'gray'}
            onClick={() => void ctrl.save()}
            aria-label={dirty ? `Save (${MOD}S)` : 'Saved'}
            data-testid="save-button"
            data-dirty={dirty}
            className="save-btn"
          >
            {dirty ? (
              'Save'
            ) : (
              <>
                <CheckIcon aria-hidden /> Saved
              </>
            )}
          </Button>
        )}
        {hasFile && (
          <DropdownMenu.Root>
            <DropdownMenu.Trigger>
              <IconButton variant="surface" color="gray" size="2" aria-label="More actions">
                <DotsHorizontalIcon />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onSelect={() => void ctrl.saveAs()}>
                Save As…
                <div className="rt-DropdownMenuShortcut">⇧{MOD}S</div>
              </DropdownMenu.Item>
              <DropdownMenu.Item
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
