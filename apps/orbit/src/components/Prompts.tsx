import { AlertDialog, Button, Code, Flex, Text } from '@radix-ui/themes';
import { useAppState, useCtrl, useDispatch } from '../state/context';
import { Confirm } from './common';

export function Prompts() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const p = s.prompt;
  const close = () => d({ type: 'prompt', prompt: null });

  return (
    <>
      <Confirm
        open={p?.type === 'discard'}
        onOpenChange={(o) => !o && close()}
        title={p?.type === 'discard' ? p.title : ''}
        confirmLabel={p?.type === 'discard' ? p.confirmLabel : ''}
        danger
        onConfirm={() => {
          if (p?.type === 'discard') {
            close();
            p.run();
          }
        }}
      >
        {p?.type === 'discard' ? p.description : ''}
      </Confirm>

      <Confirm
        open={p?.type === 'reload'}
        onOpenChange={(o) => !o && close()}
        title="Reload from disk?"
        confirmLabel="Discard my changes and reload"
        danger
        onConfirm={() => {
          close();
          void ctrl.reloadFromDisk();
        }}
      >
        Your unsaved changes will be discarded and replaced by the file on disk. This cannot be undone.
      </Confirm>

      <AlertDialog.Root open={p?.type === 'leaveRaw'} onOpenChange={(o) => !o && close()}>
        <AlertDialog.Content maxWidth="480px">
          <AlertDialog.Title>Unapplied raw edits</AlertDialog.Title>
          <AlertDialog.Description size="2">You have edited the raw JSON without applying it. Apply the edits, discard them, or stay in the editor.</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end" wrap="wrap">
            <Button variant="soft" color="gray" onClick={close}>
              Stay
            </Button>
            <Button
              variant="soft"
              color="red"
              onClick={() => {
                const run = p?.type === 'leaveRaw' ? p.run : undefined;
                d({ type: 'setRawDraft', text: null });
                close();
                run?.();
              }}
            >
              Discard
            </Button>
            <Button
              onClick={() => {
                const run = p?.type === 'leaveRaw' ? p.run : undefined;
                if (ctrl.applyRaw()) {
                  close();
                  run?.();
                } else close();
              }}
            >
              Apply
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <Confirm
        open={p?.type === 'applyRawBeforeSave'}
        onOpenChange={(o) => !o && close()}
        title="Apply raw edits before saving?"
        confirmLabel="Apply and save"
        onConfirm={() => {
          close();
          void ctrl.save({ applyRaw: true });
        }}
      >
        Your raw JSON edits are valid but have not been applied to the structured views yet. Orbit applies them first so the file and the views never disagree.
      </Confirm>

      <AlertDialog.Root open={p?.type === 'saveErrors'} onOpenChange={(o) => !o && close()}>
        <AlertDialog.Content maxWidth="560px">
          <AlertDialog.Title>This text has errors</AlertDialog.Title>
          <AlertDialog.Description size="2">Saving now would write your raw text exactly as typed, errors included. Orbit never saves a repaired version.</AlertDialog.Description>
          <ul className="diag-simple">
            {p?.type === 'saveErrors' &&
              p.diagnostics
                .filter((x) => x.severity === 'error')
                .slice(0, 6)
                .map((x, i) => (
                  <li key={i}>
                    <Text size="2">{x.message}</Text>
                    {x.line !== undefined && (
                      <Text size="1" color="gray">
                        {' '}
                        (line {x.line})
                      </Text>
                    )}
                  </li>
                ))}
            {p?.type === 'saveErrors' && p.diagnostics.filter((x) => x.severity === 'error').length > 6 && <li>…and more. See the Diagnostics panel.</li>}
          </ul>
          <Flex gap="3" mt="4" justify="end">
            <Button
              variant="soft"
              color="red"
              onClick={() => {
                close();
                void ctrl.save({ anyway: true });
              }}
            >
              Save anyway
            </Button>
            <Button autoFocus onClick={close}>
              Fix first
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root open={p?.type === 'conflict'} onOpenChange={(o) => !o && close()}>
        <AlertDialog.Content maxWidth="520px">
          <AlertDialog.Title>This file changed on disk since you opened it</AlertDialog.Title>
          <AlertDialog.Description size="2">
            Orbit did not save, so neither version has been overwritten. Choose how to continue. <Code size="1">{s.filePath}</Code>
          </AlertDialog.Description>
          <Flex direction="column" gap="2" mt="4">
            <Button
              variant="soft"
              onClick={() => {
                close();
                void ctrl.reviewDifferences();
              }}
            >
              Review differences
            </Button>
            <Button
              variant="soft"
              onClick={() => {
                close();
                void ctrl.saveAs();
              }}
            >
              Save As…
            </Button>
            <Button
              variant="soft"
              color="red"
              onClick={() => {
                close();
                d({ type: 'prompt', prompt: { type: 'reload' } });
              }}
            >
              Reload from disk (discard mine)…
            </Button>
            <Button variant="ghost" color="gray" onClick={close}>
              Cancel
            </Button>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
