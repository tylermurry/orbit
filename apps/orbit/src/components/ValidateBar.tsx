// The Validate tab's header bar: the run values (command and results folder), confirming them before the first run,
// changing them, and a one-line summary of the latest results.
import { useEffect, useMemo, useState } from 'react';
import { Button, Code, Flex, Text, TextField } from '@radix-ui/themes';
import { PlayIcon, StopIcon } from '@radix-ui/react-icons';
import { testAssurance } from '@orbit/contract';
import { relativeTime } from '../lib/format';
import { useAppState, useAssuranceCtx, useCtrl, useEdit } from '../state/context';

export const DEFAULT_COMMAND = 'npm run build';
export const DEFAULT_RESULTS = 'reports';

/** One line about the latest results file. */
function ResultsLine() {
  const s = useAppState();
  const actx = useAssuranceCtx();
  const counts = useMemo(() => {
    const c = { passing: 0, failing: 0, unconfirmed: 0, planned: 0 };
    if (!s.contract) return c;
    for (const t of s.contract.tests) {
      const st = testAssurance(s.contract, t.id, actx).status;
      if (st !== 'undefined') c[st]++;
    }
    return c;
  }, [s.contract, actx]);
  const f = s.resultsFile;
  if (!f) return null;
  if (f.state === 'missing') {
    return (
      <Text size="1" color="amber">
        No JUnit XML results in <Code size="1">{f.path}</Code> yet.
      </Text>
    );
  }
  if (f.state === 'invalid') {
    return (
      <Text size="1" color="red">
        {f.message ?? 'The results could not be read.'}
      </Text>
    );
  }
  return (
    <Text size="1" data-testid="run-summary">
      Results from {relativeTime(f.at!)}: <strong>{counts.passing}</strong> passing, <strong>{counts.failing}</strong> failing, <strong>{counts.unconfirmed}</strong> unconfirmed
      {counts.planned ? <>, <strong>{counts.planned}</strong> planned</> : null}.
    </Text>
  );
}

export function ValidateBar({ running, exitCode, onRun, onStop, onHideOutput }: {
  running: boolean;
  exitCode: number | null | undefined;
  onRun: () => void;
  onStop: () => void;
  /** True while the form is showing, so the terminal output is hidden behind it. */
  onHideOutput: (hidden: boolean) => void;
}) {
  const ctrl = useCtrl();
  const edit = useEdit();
  const v = useAppState().contract?.validation;
  const approved = v ? ctrl.isCommandApproved(v.command) : false;
  const [changing, setChanging] = useState(false);
  const [command, setCommand] = useState(v?.command ?? DEFAULT_COMMAND);
  const [results, setResults] = useState(v?.results ?? DEFAULT_RESULTS);
  const form = !approved || changing;
  useEffect(() => onHideOutput(form), [form, onHideOutput]);
  // Keep the form in step with the contract when it is not being edited.
  useEffect(() => {
    if (!changing) {
      setCommand(v?.command ?? DEFAULT_COMMAND);
      setResults(v?.results ?? DEFAULT_RESULTS);
    }
  }, [changing, v?.command, v?.results]);

  if (form) {
    const valid = command.trim() !== '' && results.trim() !== '';
    return (
      <form
        className="validate-bar"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          const next = { command: command.trim(), results: results.trim() };
          if (next.command !== v?.command || next.results !== v?.results) edit((c) => ({ ...c, validation: next }));
          ctrl.approveCommand(next.command);
          setChanging(false);
          onRun();
        }}
      >
        <Flex align="end" gap="3" wrap="wrap">
          <label className="validate-field" style={{ flex: '2 1 240px' }}>
            <Text size="1" color="gray">Test command</Text>
            <TextField.Root size="1" aria-label="Test command" autoFocus value={command} onChange={(e) => setCommand(e.target.value)} style={{ fontFamily: 'var(--code-font-family)' }} />
          </label>
          <label className="validate-field" style={{ flex: '1 1 160px' }}>
            <Text size="1" color="gray">Results folder</Text>
            <TextField.Root size="1" aria-label="Results folder" value={results} onChange={(e) => setResults(e.target.value)} style={{ fontFamily: 'var(--code-font-family)' }} />
          </label>
          {v && approved && (
            <Button type="button" size="1" variant="soft" color="gray" onClick={() => setChanging(false)}>
              Cancel
            </Button>
          )}
          <Button type="submit" size="1" disabled={!valid}>
            <PlayIcon aria-hidden /> Confirm &amp; run
          </Button>
        </Flex>
        <Text size="1" color="gray">
          {approved ? 'Saved in the contract once confirmed. ' : 'Orbit runs this command on your computer, in the repository root, then reads every JUnit XML file in the results folder. It comes from the contract file, so only confirm it if you trust it. '}
          Orbit asks again whenever the command changes.
        </Text>
      </form>
    );
  }

  return (
    <div className="validate-bar">
      <Flex align="center" gap="3" wrap="wrap">
        <Text size="1">
          <Code size="1" data-testid="validate-command">{v!.command}</Code> → <Code size="1">{v!.results}</Code>
        </Text>
        <Button size="1" variant="ghost" color="gray" onClick={() => setChanging(true)}>
          Change…
        </Button>
        <span style={{ flex: 1 }} />
        {!running && exitCode !== undefined && (
          <Text size="1" color={exitCode === 0 ? 'green' : 'red'} data-testid="run-exit">
            {exitCode === null ? 'Stopped' : exitCode === 0 ? 'Finished' : `Exited with code ${exitCode}`}
          </Text>
        )}
        {running ? (
          <Button size="1" color="red" variant="soft" onClick={onStop}>
            <StopIcon aria-hidden /> Stop
          </Button>
        ) : (
          <Button size="1" onClick={onRun}>
            <PlayIcon aria-hidden /> Run again
          </Button>
        )}
      </Flex>
      <ResultsLine />
    </div>
  );
}
