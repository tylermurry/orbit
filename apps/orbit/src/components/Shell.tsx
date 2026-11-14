import { Button, Callout, Flex, IconButton, Tooltip } from '@radix-ui/themes';
import { Cross2Icon, ExclamationTriangleIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { useAppState, useCtrl, useDiagnostics, useDispatch } from '../state/context';
import { requestRaw } from './TopBar';

export function Banners() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const diagnostics = useDiagnostics();
  const errors = diagnostics.filter((x) => x.severity === 'error').length;
  return (
    <div className="banners">
      {s.viewFilter && s.contract && !s.rawMode && (
        <Callout.Root color="yellow" variant="soft" size="1" role="status" data-testid="banner-filter" className="filter-banner">
          <Callout.Icon>
            <MixerHorizontalIcon />
          </Callout.Icon>
          <Flex justify="between" align="center" gap="3" width="100%">
            <Callout.Text>{s.viewFilter.description}</Callout.Text>
            <Tooltip content="Clear filter">
              <IconButton size="1" variant="ghost" color="gray" aria-label="Clear filter" onClick={() => d({ type: 'setViewFilter', filter: null })}>
                <Cross2Icon />
              </IconButton>
            </Tooltip>
          </Flex>
        </Callout.Root>
      )}
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
