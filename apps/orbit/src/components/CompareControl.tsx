import { useState } from 'react';
import { Button, Callout, Flex, IconButton, Popover, Select, Text, TextField, Tooltip } from '@radix-ui/themes';
import { ArrowRightIcon, InfoCircledIcon, LayersIcon, SwitchIcon } from '@radix-ui/react-icons';
import type { GitRef } from '../host/types';
import { shortSha } from '../lib/format';
import { useApp, useCtrl } from '../state/context';
import { defaultComparison, revFromKey, revKey, revLabel } from '../state/compare';
import { isDirty } from '../state/store';
import type { RevSel } from '../state/types';
import { Legend } from './common';

function RevSelect({ label, value, onChange, refs, dirty, headLabel }: { label: string; value: RevSel; onChange: (v: RevSel) => void; refs: GitRef[]; dirty: boolean; headLabel: string }) {
  const [shaMode, setShaMode] = useState(false);
  const [sha, setSha] = useState('');
  const branches = refs.filter((r) => r.kind === 'branch');
  const tags = refs.filter((r) => r.kind === 'tag');
  const hasHead = refs.some((r) => r.kind === 'head');
  const key = revKey(value);
  const known = key === 'working' || key === 'unsaved' || value.type === 'sha' || refs.some((r) => (r.kind === 'head' ? 'HEAD' : r.name) === (value.type === 'ref' ? value.name : ''));
  return (
    <Flex direction="column" gap="1" style={{ minWidth: 0, flex: 1 }}>
      <Select.Root
        size="2"
        value={known ? key : undefined}
        onValueChange={(v) => {
          if (v === 'sha:') setShaMode(true);
          else {
            setShaMode(false);
            onChange(revFromKey(v));
          }
        }}
      >
        <Select.Trigger aria-label={label} placeholder="Choose revision" />
        <Select.Content position="popper">
          <Select.Group>
            <Select.Label>Working tree</Select.Label>
            <Select.Item value="working">Working tree (saved file)</Select.Item>
            {dirty && <Select.Item value="unsaved">Unsaved edits (in Orbit)</Select.Item>}
          </Select.Group>
          {hasHead && (
            <Select.Group>
              <Select.Label>HEAD</Select.Label>
              <Select.Item value="ref:HEAD">{headLabel}</Select.Item>
            </Select.Group>
          )}
          {branches.length > 0 && (
            <Select.Group>
              <Select.Label>Branches</Select.Label>
              {branches.map((r) => (
                <Select.Item key={r.name} value={`ref:${r.name}`}>
                  {r.name} · {shortSha(r.commit)}
                </Select.Item>
              ))}
            </Select.Group>
          )}
          {tags.length > 0 && (
            <Select.Group>
              <Select.Label>Tags</Select.Label>
              {tags.map((r) => (
                <Select.Item key={r.name} value={`ref:${r.name}`}>
                  {r.name} · {shortSha(r.commit)}
                </Select.Item>
              ))}
            </Select.Group>
          )}
          <Select.Separator />
          {value.type === 'sha' && <Select.Item value={key}>Commit {shortSha(value.sha)}</Select.Item>}
          <Select.Item value="sha:">Commit SHA…</Select.Item>
        </Select.Content>
      </Select.Root>
      {shaMode && (
        <Flex gap="1">
          <TextField.Root
            size="1"
            style={{ flex: 1 }}
            autoFocus
            aria-label={`${label} commit SHA`}
            placeholder="Commit SHA (4–40 hex)"
            value={sha}
            onChange={(e) => setSha(e.target.value.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && sha) {
                onChange({ type: 'sha', sha });
                setShaMode(false);
              }
            }}
          />
          <Button
            size="1"
            disabled={!sha}
            onClick={() => {
              onChange({ type: 'sha', sha });
              setShaMode(false);
            }}
          >
            Use
          </Button>
        </Flex>
      )}
    </Flex>
  );
}

export function CompareEditor({ compact }: { compact?: boolean }) {
  const s = useApp((x) => x);
  const ctrl = useCtrl();
  const dirty = isDirty(s);
  const git = s.git;
  const headLabel = git?.detached ? `HEAD (detached) · ${shortSha(git.headCommit)}` : `HEAD (${git?.headBranch ?? '?'}) · ${shortSha(git?.headCommit)}`;
  const cmp = s.compare ?? defaultComparison(git, dirty);
  if (!cmp) return null;
  return (
    <Flex direction="column" gap="2">
      <Flex align="start" gap="2">
        <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
          <Text size="1" color="gray" weight="medium">
            Base
          </Text>
          <RevSelect label="Base revision" value={cmp.base} refs={s.refs} dirty={dirty} headLabel={headLabel} onChange={(base) => ctrl.setCompare({ ...cmp, base })} />
        </Flex>
        <Flex direction="column" align="center" gap="1" pt="5">
          <Tooltip content="Swap base and target">
            <IconButton size="1" variant="ghost" color="gray" aria-label="Swap base and target" onClick={() => ctrl.setCompare({ base: cmp.target, target: cmp.base })}>
              <SwitchIcon />
            </IconButton>
          </Tooltip>
        </Flex>
        <Flex direction="column" gap="1" style={{ flex: 1, minWidth: 0 }}>
          <Text size="1" color="gray" weight="medium">
            Target
          </Text>
          <RevSelect label="Target revision" value={cmp.target} refs={s.refs} dirty={dirty} headLabel={headLabel} onChange={(target) => ctrl.setCompare({ ...cmp, target })} />
        </Flex>
      </Flex>
      {dirty && (
        <Callout.Root size="1" color="amber" variant="surface">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>You have unsaved changes; “Working tree” compares the saved file. Save to include them, or choose “Unsaved edits”.</Callout.Text>
        </Callout.Root>
      )}
      {!compact && <Legend />}
    </Flex>
  );
}

export function CompareButton() {
  const s = useApp((x) => x);
  const ctrl = useCtrl();
  const available = !!s.git?.available;
  const active = !!s.compare;
  const label = s.compare ? `${revLabel(s.compare.base)} → ${revLabel(s.compare.target)}` : 'Compare';
  const btn = (
    <Button variant={active ? 'soft' : 'surface'} color={active ? 'indigo' : 'gray'} size="2" disabled={!available} tabIndex={available ? undefined : -1} aria-label={active ? `Comparison ${label}` : 'Compare revisions'} className="topbar-btn compare-btn">
      <LayersIcon aria-hidden />
      <span className="truncate">{label}</span>
    </Button>
  );
  if (!available) {
    return (
      <Tooltip content={`Version comparison needs the contract to be inside a local Git repository. ${s.git?.message ?? ''}`}>
        <span role="button" aria-disabled="true" tabIndex={0} aria-label="Compare unavailable: no Git repository" style={{ display: 'inline-flex' }}>
          <span aria-hidden style={{ display: 'inline-flex' }}>
            {btn}
          </span>
        </span>
      </Tooltip>
    );
  }
  return (
    <Popover.Root onOpenChange={(o) => o && ctrl.ensureDefaultCompare()}>
      <Popover.Trigger>{btn}</Popover.Trigger>
      <Popover.Content width="520px" align="end">
        <Flex direction="column" gap="3">
          <Flex justify="between" align="center">
            <Text weight="bold" size="2">
              Compare revisions
            </Text>
            <Flex align="center" gap="1" style={{ color: 'var(--gray-11)' }}>
              <Text size="1">base</Text>
              <ArrowRightIcon />
              <Text size="1">target</Text>
            </Flex>
          </Flex>
          <CompareEditor />
          <Flex justify="between">
            <Text size="1" color="gray" style={{ maxWidth: 300 }}>
              Read-only: Orbit never checks out, stages or commits anything.
            </Text>
            <Button variant="soft" color="gray" size="1" disabled={!s.compare} onClick={() => ctrl.setCompare(null)}>
              Clear comparison
            </Button>
          </Flex>
        </Flex>
      </Popover.Content>
    </Popover.Root>
  );
}
