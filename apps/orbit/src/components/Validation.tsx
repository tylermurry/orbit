import { Button, Tooltip } from '@radix-ui/themes';
import { PlayIcon } from '@radix-ui/react-icons';
import { useApp, useCtrl, useDispatch } from '../state/context';

/** Top bar: shows the terminal's Validate tab, and starts the run right away when its values are already confirmed. */
export function ValidateButton() {
  const ctrl = useCtrl();
  const d = useDispatch();
  const run = useApp((s) => s.validateRun);
  const validation = useApp((s) => s.contract?.validation);
  const readOnly = useApp((s) => !s.contract);
  const ready = !!validation && ctrl.isCommandApproved(validation.command);
  return (
    <Tooltip content={ready ? 'Run the test suite in the terminal and update every test status' : 'Confirm how to run the test suite'}>
      <Button
        size="2"
        variant="solid"
        className="topbar-btn"
        disabled={readOnly}
        onClick={() => d({ type: 'ui', patch: { terminalOpen: true, terminalTab: 'validate', ...(ready ? { validateRun: run + 1 } : {}) } })}
      >
        <PlayIcon aria-hidden />
        Validate
      </Button>
    </Tooltip>
  );
}
