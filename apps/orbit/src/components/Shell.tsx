import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { ExclamationTriangleIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { shortSha } from '../lib/format';
import { useApp, useAppState, useCtrl, useDiagnostics, useDispatch } from '../state/context';
import { revLabel } from '../state/compare';
import { requestRaw } from './TopBar';

export function Banners() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const diagnostics = useDiagnostics();
  const errors = diagnostics.filter((x) => x.severity === 'error').length;
  return (
    <div className="banners">
      {s.externalChange?.kind === 'modified' && (
        <Callout.Root color="amber" variant="surface" size="1" role="alert" data-testid="banner-external">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Flex justify="between" align="center" gap="3" width="100%">
            <Callout.Text>This file changed on disk while you have unsaved edits. Nothing has been overwritten.</Callout.Text>
            <Flex gap="2" flexShrink="0">
              <Button size="1" variant="soft" onClick={() => void ctrl.reviewDifferences()}>
                Review differences
              </Button>
              <Button size="1" variant="soft" color="red" onClick={() => d({ type: 'prompt', prompt: { type: 'reload' } })}>
                Reload from disk
              </Button>
              <Button size="1" variant="soft" onClick={() => void ctrl.saveAs()}>
                Save As…
              </Button>
            </Flex>
          </Flex>
        </Callout.Root>
      )}
      {s.externalChange?.kind === 'deleted' && (
        <Callout.Root color="amber" variant="surface" size="1" role="alert" data-testid="banner-deleted">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Flex justify="between" align="center" gap="3" width="100%">
            <Callout.Text>This file was deleted or moved on disk. Your copy in Orbit is intact.</Callout.Text>
            <Flex gap="2" flexShrink="0">
              <Button size="1" onClick={() => void ctrl.save()}>
                Save to recreate
              </Button>
              <Button size="1" variant="soft" onClick={() => void ctrl.saveAs()}>
                Save As…
              </Button>
            </Flex>
          </Flex>
        </Callout.Root>
      )}
      {s.loadedInvalid && !s.rawMode && (
        <Callout.Root color="red" variant="surface" size="1" data-testid="banner-invalid">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Flex justify="between" align="center" gap="3" width="100%">
            <Callout.Text>
              This file has {errors} error{errors === 1 ? '' : 's'}. Showing the valid parts read-only. Fix them in Raw JSON.
            </Callout.Text>
            <Flex gap="2" flexShrink="0">
              <Button size="1" variant="soft" onClick={() => d({ type: 'ui', patch: { diagnosticsOpen: true } })}>
                Diagnostics
              </Button>
              <Button size="1" onClick={() => requestRaw(true)}>
                Open Raw JSON
              </Button>
            </Flex>
          </Flex>
        </Callout.Root>
      )}
    </div>
  );
}

export function StatusStrip() {
  const s = useAppState();
  const diagnostics = useDiagnostics();
  const result = useApp((x) => x.compareResult);
  const errors = diagnostics.filter((x) => x.severity === 'error').length;
  const warnings = diagnostics.length - errors;
  if (!s.filePath) return <footer className="statusbar" aria-label="Status" />;
  const git = s.git;
  let cmp = '';
  if (s.compare) {
    cmp = `${revLabel(s.compare.base)} → ${revLabel(s.compare.target)}`;
    if (result?.status === 'ready') cmp += ` · ${result.diff.changes.length} changes`;
    else if (result?.status === 'blocked') cmp += ' · blocked';
  }
  return (
    <footer className="statusbar" aria-label="Status">
      <Text size="1" className="truncate" title={s.filePath} style={{ flex: '0 1 40%' }}>
        {s.filePath}
      </Text>
      <Text size="1" color="gray">
        {git?.available ? (git.detached ? `detached HEAD ${shortSha(git.headCommit)}` : `${git.headBranch ?? '?'} @ ${shortSha(git.headCommit) || 'no commits'}`) : 'No Git repository'}
      </Text>
      <Text size="1" color={errors ? 'red' : warnings ? 'amber' : 'green'} data-testid="validation-status">
        {errors ? `${errors} error${errors === 1 ? '' : 's'}` : warnings ? `Valid · ${warnings} warning${warnings === 1 ? '' : 's'}` : 'Valid'}
      </Text>
      <Text size="1" color="gray" className="truncate" style={{ marginLeft: 'auto' }}>
        {cmp ? (
          <>
            <InfoCircledIcon style={{ verticalAlign: '-2px' }} aria-hidden /> Comparing {cmp}
          </>
        ) : (
          'No comparison'
        )}
      </Text>
    </footer>
  );
}
