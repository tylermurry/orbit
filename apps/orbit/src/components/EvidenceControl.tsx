import { useState } from 'react';
import { Button, Flex, Popover, RadioGroup, Select, Text, TextField } from '@radix-ui/themes';
import { InfoCircledIcon, MixerHorizontalIcon } from '@radix-ui/react-icons';
import { shortSha } from '../lib/format';
import { useApp, useCtrl } from '../state/context';
import type { EvidenceCtx } from '../state/types';

export function evidenceLabel(ctx: EvidenceCtx, headCommit?: string): string {
  if (ctx.kind === 'none') return 'Unknown revision';
  if (ctx.kind === 'head') return `HEAD ${shortSha(headCommit)}`;
  return `${ctx.label.length > 12 ? shortSha(ctx.commit) : ctx.label} ${ctx.label.length > 12 ? '' : shortSha(ctx.commit)}`.trim();
}

export function EvidenceControl() {
  const ctx = useApp((s) => s.evidenceCtx);
  const git = useApp((s) => s.git);
  const refs = useApp((s) => s.refs);
  const ctrl = useCtrl();
  const [sha, setSha] = useState('');
  const head = git?.available ? git.headCommit : undefined;
  const value = ctx.kind;
  return (
    <Popover.Root>
      <Popover.Trigger>
        <Button variant="surface" color={ctx.kind === 'none' ? 'gray' : 'indigo'} size="2" className="topbar-btn evidence-btn" aria-label={`Evidence context: ${evidenceLabel(ctx, head)}`}>
          <MixerHorizontalIcon aria-hidden />
          <span className="truncate">Evidence: {evidenceLabel(ctx, head)}</span>
        </Button>
      </Popover.Trigger>
      <Popover.Content width="400px" align="end">
        <Flex direction="column" gap="3">
          <Text weight="bold" size="2">
            Which code revision is being inspected?
          </Text>
          <RadioGroup.Root
            value={value}
            onValueChange={(v) => {
              if (v === 'none') ctrl.setEvidence({ kind: 'none' });
              else if (v === 'head' && head) ctrl.setEvidence({ kind: 'head' });
            }}
            aria-label="Evidence context"
          >
            <RadioGroup.Item value="none">None — freshness unknown</RadioGroup.Item>
            <RadioGroup.Item value="head" disabled={!head}>
              HEAD{head ? ` (${shortSha(head)})` : ' — needs a Git repository with commits'}
            </RadioGroup.Item>
            {ctx.kind === 'rev' && (
              <RadioGroup.Item value="rev">
                {ctx.label} ({shortSha(ctx.commit)})
              </RadioGroup.Item>
            )}
          </RadioGroup.Root>
          {git?.available && (
            <Flex direction="column" gap="2">
              <Text size="1" color="gray" weight="medium">
                Another branch, tag or commit
              </Text>
              <Select.Root
                size="2"
                onValueChange={async (v) => {
                  const c = await ctrl.resolveEvidenceRev(v);
                  if (c) ctrl.setEvidence(c);
                }}
              >
                <Select.Trigger placeholder="Choose a ref…" aria-label="Evidence ref" />
                <Select.Content position="popper">
                  {refs.filter((r) => r.kind !== 'head').map((r) => (
                    <Select.Item key={r.name} value={r.name}>
                      {r.name} · {shortSha(r.commit)}
                    </Select.Item>
                  ))}
                </Select.Content>
              </Select.Root>
              <Flex gap="2">
                <TextField.Root size="2" style={{ flex: 1 }} aria-label="Evidence commit SHA" placeholder="Commit SHA…" value={sha} onChange={(e) => setSha(e.target.value.trim())} />
                <Button
                  size="2"
                  variant="soft"
                  disabled={!sha}
                  onClick={async () => {
                    const c = await ctrl.resolveEvidenceRev(sha);
                    if (c) {
                      ctrl.setEvidence(c);
                      setSha('');
                    }
                  }}
                >
                  Use
                </Button>
              </Flex>
            </Flex>
          )}
          <Flex gap="2" align="start" className="note-box">
            <InfoCircledIcon style={{ flex: 'none', marginTop: 2 }} aria-hidden />
            <Text size="1" color="gray">
              A Git commit can never contain its own SHA, so evidence in a committed contract cannot be “current” for that same commit. Orbit marks evidence current only when its recorded SHA exactly equals the revision you choose here; a different SHA is potentially outdated, and a missing SHA is unknown.
            </Text>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
