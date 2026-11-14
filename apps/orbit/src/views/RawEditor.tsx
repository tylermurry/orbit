import { useEffect, useMemo, useRef } from 'react';
import { Badge, Button, Callout, Flex, Text } from '@radix-ui/themes';
import { CrossCircledIcon, ExclamationTriangleIcon, CheckCircledIcon } from '@radix-ui/react-icons';
import { serializeContract } from '@orbit/contract';
import { onRawJump, takePendingRawJump } from '../lib/rawJump';
import type { RawJump } from '../lib/rawJump';
import { parseCached, useAppState, useCtrl, useDispatch } from '../state/context';
import { currentText } from '../state/store';

const LINE_HEIGHT = 20;

export function RawEditor() {
  const s = useAppState();
  const d = useDispatch();
  const ctrl = useCtrl();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const base = currentText(s);
  const text = s.rawDraft ?? base;
  const unapplied = s.rawDraft !== null && s.rawDraft !== base;
  const parse = useMemo(() => parseCached(text), [text]);
  const diagnostics = parse.diagnostics;
  const errors = diagnostics.filter((x) => x.severity === 'error');
  const lineCount = useMemo(() => text.split('\n').length, [text]);
  const lineSeverity = useMemo(() => {
    const m = new Map<number, 'error' | 'warning'>();
    for (const x of diagnostics) if (x.line) m.set(x.line, x.severity === 'error' || m.get(x.line) === 'error' ? 'error' : 'warning');
    return m;
  }, [diagnostics]);

  const jump = (j: RawJump) => {
    const ta = taRef.current;
    if (!ta) return;
    const lines = ta.value.split('\n');
    let off = 0;
    for (let i = 0; i < Math.min(j.line - 1, lines.length - 1); i++) off += lines[i].length + 1;
    off += Math.max(0, Math.min((lines[Math.min(j.line - 1, lines.length - 1)] ?? '').length, j.column - 1));
    ta.focus();
    ta.setSelectionRange(off, off);
    ta.scrollTop = Math.max(0, (j.line - 5) * LINE_HEIGHT);
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  };

  useEffect(() => {
    const p = takePendingRawJump();
    if (p) setTimeout(() => jump(p), 30);
    return onRawJump((j) => setTimeout(() => jump(j), 0));
  }, []);

  const setText = (v: string) => d({ type: 'setRawDraft', text: v === base ? null : v });

  const format = () => {
    try {
      const p = parseCached(text);
      if (p.ok && p.contract) setText(serializeContract(p.contract));
      else setText(JSON.stringify(JSON.parse(text), null, 2) + '\n');
    } catch {
      ctrl.toast('Cannot format: the text is not valid JSON yet. See the diagnostics below.', 'error');
    }
  };

  return (
    <section className="raw" aria-label="Raw JSON editor">
      <Flex className="raw-toolbar" align="center" gap="3" wrap="wrap">
        <Text weight="bold" size="3">
          Raw JSON
        </Text>
        {unapplied && (
          <Badge color="amber" variant="soft" radius="full" data-testid="raw-unapplied">
            <ExclamationTriangleIcon aria-hidden /> Raw edits not applied
          </Badge>
        )}
        {!unapplied && s.loadedInvalid && (
          <Badge color="red" variant="soft" radius="full">
            Showing the file as stored; it has errors
          </Badge>
        )}
        <Badge color={errors.length ? 'red' : 'green'} variant="soft" radius="full" data-testid="raw-validity">
          {errors.length ? <CrossCircledIcon aria-hidden /> : <CheckCircledIcon aria-hidden />}
          {errors.length ? `${errors.length} error${errors.length === 1 ? '' : 's'}` : 'Valid'}
        </Badge>
        <Flex gap="2" ml="auto">
          <Button variant="soft" color="gray" onClick={format}>
            Format
          </Button>
          <Button variant="soft" color="gray" disabled={!unapplied} onClick={() => d({ type: 'setRawDraft', text: null })}>
            Revert raw
          </Button>
          <Button disabled={!unapplied} onClick={() => ctrl.applyRaw()}>
            Apply
          </Button>
        </Flex>
      </Flex>
      {!s.contract && (
        <Callout.Root color="red" size="1" variant="surface" className="raw-callout">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>This file is not valid JSON, so there is nothing to show in the structured views yet. Your original text is untouched; fix it here.</Callout.Text>
        </Callout.Root>
      )}
      <div className="raw-body">
        <div className="gutter" ref={gutterRef} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} className={`gutter-line ${lineSeverity.get(i + 1) ?? ''}`}>
              {i + 1}
            </div>
          ))}
        </div>
        <textarea
          ref={taRef}
          className="raw-textarea"
          aria-label="Raw JSON"
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          onChange={(e) => setText(e.target.value)}
          onScroll={(e) => {
            if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>
      <div className="raw-diagnostics" role="region" aria-label="Raw JSON diagnostics">
        {diagnostics.length === 0 ? (
          <Text size="2" color="green">
            No problems found.
          </Text>
        ) : (
          <ul className="diag-list compact">
            {diagnostics.map((x, i) => (
              <li key={i} className="diag-item" data-severity={x.severity}>
                <button type="button" className="diag-main" onClick={() => jump({ line: x.line ?? 1, column: x.column ?? 1 })}>
                  <span className="diag-icon" aria-label={x.severity}>
                    {x.severity === 'error' ? <CrossCircledIcon color="var(--red-10)" /> : <ExclamationTriangleIcon color="var(--amber-10)" />}
                  </span>
                  <span>
                    <Text size="2">{x.message}</Text>
                    <Text size="1" color="gray">
                      {x.line !== undefined ? ` · line ${x.line}${x.column ? `, col ${x.column}` : ''}` : x.path ? ` · ${x.path}` : ''}
                    </Text>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
