import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Callout, Code, Dialog, Flex, Spinner, Text, TextField, Tooltip } from '@radix-ui/themes';
import { ExclamationTriangleIcon, PlayIcon } from '@radix-ui/react-icons';
import { testAssurance } from '@orbit/contract';
import type { ValidationConfig } from '@orbit/contract';
import { relativeTime } from '../lib/format';
import { resultsPathOf, runFolderOf } from '../state/controller';
import { useApp, useAppState, useAssuranceCtx, useCtrl, useDispatch, useEdit } from '../state/context';
import { matchedResults, proposalTime } from '../state/store';
import { Field } from './Dialogs';

/** Top bar: run the whole test suite. Opens the dialog, and starts the run right away when it is set up and approved. */
export function ValidateButton() {
  const ctrl = useCtrl();
  const d = useDispatch();
  const running = useApp((s) => !!s.run);
  const configured = useApp((s) => !!s.contract?.validation);
  const readOnly = useApp((s) => !s.contract);
  return (
    <Tooltip content={configured ? 'Run the test suite and update every test status' : 'Set up how to run the test suite'}>
      <Button
        size="2"
        variant="solid"
        className="topbar-btn"
        disabled={readOnly}
        onClick={() => {
          d({ type: 'ui', patch: { runDialog: true } });
          if (!running) void ctrl.runValidation();
        }}
      >
        {running ? <Spinner size="1" /> : <PlayIcon aria-hidden />}
        Validate
      </Button>
    </Tooltip>
  );
}

function SetupForm({ initial, onDone }: { initial?: ValidationConfig; onDone: () => void }) {
  const edit = useEdit();
  const [command, setCommand] = useState(initial?.command ?? '');
  const [results, setResults] = useState(initial?.results ?? '');
  const valid = command.trim() !== '' && results.trim() !== '';
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        edit((c) => ({ ...c, validation: { command: command.trim(), results: results.trim() } }));
        onDone();
      }}
    >
      <Flex direction="column" gap="3">
        <Field label="Test command" hint="Runs the entire test suite from the repository root (or the contract's folder outside Git).">
          <TextField.Root aria-label="Test command" autoFocus placeholder="npm test" value={command} onChange={(e) => setCommand(e.target.value)} style={{ fontFamily: 'var(--code-font-family)' }} />
        </Field>
        <Field label="Results file" hint="Where the command writes JUnit XML results, relative to the same folder. Most test runners can write JUnit XML.">
          <TextField.Root aria-label="Results file" placeholder="test-results/junit.xml" value={results} onChange={(e) => setResults(e.target.value)} style={{ fontFamily: 'var(--code-font-family)' }} />
        </Field>
        <Text size="1" color="gray">
          Saved in the contract, so your team and the AI use the same command. Orbit matches results to tests by each test’s location (file and test name).
        </Text>
        <Flex justify="end" gap="2">
          <Button type="submit" disabled={!valid}>
            Save
          </Button>
        </Flex>
      </Flex>
    </form>
  );
}

function Summary() {
  const s = useAppState();
  const actx = useAssuranceCtx();
  const counts = useMemo(() => {
    const c = { passing: 0, failing: 0, unconfirmed: 0, planned: 0 };
    if (!s.contract) return c;
    // Same rule as every badge: only results from at or after the proposal count.
    for (const t of s.contract.tests) {
      const st = testAssurance(s.contract, t.id, actx).status;
      if (st !== 'undefined') c[st]++;
    }
    return c;
  }, [s.contract, actx]);
  const unmatched = matchedResults(s).unmatchedCases;
  const f = s.resultsFile;
  if (!f) return null;
  if (f.state === 'missing') {
    return (
      <Callout.Root color="amber" size="1" variant="surface">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>
          No results file at <Code size="1">{f.path}</Code>. Check that the command writes JUnit XML there.
        </Callout.Text>
      </Callout.Root>
    );
  }
  if (f.state === 'invalid') {
    return (
      <Callout.Root color="red" size="1" variant="surface">
        <Callout.Icon>
          <ExclamationTriangleIcon />
        </Callout.Icon>
        <Callout.Text>{f.message ?? 'The results file could not be read.'}</Callout.Text>
      </Callout.Root>
    );
  }
  return (
    <Flex direction="column" gap="1" data-testid="run-summary">
      <Text size="2">
        Results from {relativeTime(f.at!)}: <strong>{counts.passing}</strong> passing, <strong>{counts.failing}</strong> failing, <strong>{counts.unconfirmed}</strong> unconfirmed
        {counts.planned ? (
          <>
            , <strong>{counts.planned}</strong> planned
          </>
        ) : null}
        .
      </Text>
      {counts.unconfirmed > 0 && proposalTime(s) && (
        <Text size="1" color="gray">
          Unconfirmed tests have no result, were skipped, or last ran before the proposal ({relativeTime(proposalTime(s)!)}).
        </Text>
      )}
      {unmatched > 0 && (
        <Text size="1" color="gray">
          {unmatched} test case{unmatched === 1 ? '' : 's'} in the results match no test in the contract.
        </Text>
      )}
    </Flex>
  );
}

function Output({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre ref={ref} className="run-output" aria-label="Test output" data-testid="run-output">
      {text || ' '}
    </pre>
  );
}

/** Set up, approve, watch and summarize test runs. */
export function ValidationDialog() {
  const s = useAppState();
  const ctrl = useCtrl();
  const d = useDispatch();
  const [editing, setEditing] = useState(false);
  const [, tick] = useState(0);
  const v = s.contract?.validation;
  const open = s.runDialog;
  useEffect(() => {
    if (!open) setEditing(false);
  }, [open]);
  useEffect(() => {
    if (!s.run) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [s.run]);
  if (!s.contract) return null;
  const approved = v ? ctrl.isCommandApproved(v.command) : false;
  const folder = runFolderOf(s);
  const setup = !v || editing;
  const last = s.lastRun;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => d({ type: 'ui', patch: { runDialog: o } })}>
      <Dialog.Content maxWidth="720px" aria-describedby="validate-note">
        <Dialog.Title>Validate capabilities</Dialog.Title>
        <Dialog.Description id="validate-note" size="2" color="gray" mb="3">
          Runs the whole test suite and reads its results to update the status of every test and behavior.
        </Dialog.Description>

        {setup ? (
          <SetupForm initial={v} onDone={() => setEditing(false)} />
        ) : s.run ? (
          <Flex direction="column" gap="3">
            <Flex align="center" justify="between" gap="3">
              <Flex align="center" gap="2">
                <Spinner />
                <Text size="2">
                  Running <Code size="1">{s.run.command}</Code> · {Math.round((Date.now() - s.run.startedAt) / 1000)}s
                </Text>
              </Flex>
              <Button color="red" variant="soft" onClick={() => void ctrl.cancelValidation()}>
                Cancel
              </Button>
            </Flex>
            <Output text={s.run.output} />
          </Flex>
        ) : !approved ? (
          <Flex direction="column" gap="3">
            <Callout.Root color="amber" variant="surface">
              <Callout.Icon>
                <ExclamationTriangleIcon />
              </Callout.Icon>
              <Callout.Text>Orbit will run this command on your computer. It comes from the contract file, so only run it if you trust it. Orbit asks again whenever the command changes.</Callout.Text>
            </Callout.Root>
            <Code size="3" className="run-command" data-testid="approve-command">
              {v!.command}
            </Code>
            <Text size="1" color="gray">
              In <Code size="1">{folder}</Code>, then reads <Code size="1">{resultsPathOf(s)}</Code>.
            </Text>
            <Flex justify="between">
              <Button variant="ghost" color="gray" onClick={() => setEditing(true)}>
                Change command…
              </Button>
              <Button
                onClick={() => {
                  ctrl.approveCommand(v!.command);
                  void ctrl.runValidation();
                }}
              >
                <PlayIcon aria-hidden /> Run tests
              </Button>
            </Flex>
          </Flex>
        ) : (
          <Flex direction="column" gap="3">
            <Flex align="center" justify="between" gap="3" wrap="wrap">
              <Text size="2">
                <Code size="1">{v!.command}</Code> → <Code size="1">{v!.results}</Code>
              </Text>
              <Flex gap="2">
                <Button variant="ghost" color="gray" onClick={() => setEditing(true)}>
                  Change…
                </Button>
                <Button onClick={() => void ctrl.runValidation()}>
                  <PlayIcon aria-hidden /> {last ? 'Run again' : 'Run tests'}
                </Button>
              </Flex>
            </Flex>
            {last && (
              <Text size="2" color={last.cancelled ? 'gray' : last.exitCode === 0 ? 'green' : 'red'} data-testid="run-exit">
                {last.cancelled ? 'Cancelled.' : last.exitCode === 0 ? 'The test command finished successfully.' : last.exitCode === null ? 'The test command could not run.' : `The test command exited with code ${last.exitCode} (some tests probably failed).`}{' '}
                {!last.cancelled && last.durationMs > 0 && <Text color="gray">({Math.round(last.durationMs / 100) / 10}s)</Text>}
              </Text>
            )}
            <Summary />
            {last?.output && <Output text={last.output} />}
          </Flex>
        )}
        <Flex justify="end" mt="4">
          <Dialog.Close>
            <Button variant="soft" color="gray">
              Close
            </Button>
          </Dialog.Close>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
