import { useEffect, useState } from 'react';
import { Button, Code, Flex, Popover, Text } from '@radix-ui/themes';
import { ChevronDownIcon } from '@radix-ui/react-icons';
import { shortSha } from '../lib/format';
import { PRESET_LABELS, activePreset, baseBranchFor, presetComparison } from '../state/compare';
import { useApp, useCtrl, useHost } from '../state/context';
import { syncStatus } from '../state/store';
import type { LifecyclePreset, RevSel } from '../state/types';

const DESCRIPTIONS: Record<LifecyclePreset, string> = {
  proposal: 'What was proposed for this feature, compared with the product before the feature started.',
  'vs-proposal': 'How the product as it is now differs from what was proposed.',
  actual: 'Everything that has changed in the product since this feature started.',
};

/** One row of the git details: what a side of the comparison is, in git terms. */
function SideDetail({ role, sel, mergeBase }: { role: string; sel: RevSel; mergeBase: string | null | undefined }) {
  const git = useApp((s) => s.git);
  const file = useApp((s) => s.proposalFile);
  let title = '';
  let detail: React.ReactNode = null;
  if (sel.type === 'baseline') {
    title = 'Baseline';
    detail = (
      <>
        Where <Code size="1">{git?.headBranch ?? 'HEAD'}</Code> branched from <Code size="1">{sel.branch}</Code> (merge-base){' '}
        {mergeBase === undefined ? '…' : mergeBase ? <Code size="1">{shortSha(mergeBase)}</Code> : 'not found'}
      </>
    );
  } else if (sel.type === 'pinned') {
    title = 'Baseline';
    detail = <Code size="1">{shortSha(sel.sha)}</Code>;
  } else if (sel.type === 'proposal') {
    title = sel.revision === 'approved' ? 'Approved proposal' : 'Draft proposal';
    detail = <><Code size="1">orbit.proposal.json</Code> · revision {file?.proposal?.[sel.revision]?.revision}</>;
  } else if (sel.type === 'working' || sel.type === 'unsaved') {
    title = 'Latest';
    detail = (
      <>
        {sel.type === 'unsaved' ? 'Your unsaved edits in Orbit' : 'The saved file in the working tree'} on <Code size="1">{git?.headBranch ?? 'detached HEAD'}</Code> (HEAD <Code size="1">{shortSha(git?.headCommit)}</Code>)
      </>
    );
  }
  return (
    <Flex direction="column" gap="1">
      <Text size="1" color="gray" weight="medium">
        {role}: {title}
      </Text>
      <Text size="1">{detail}</Text>
    </Flex>
  );
}

function Details({ preset }: { preset: LifecyclePreset }) {
  const s = useApp((x) => x);
  const host = useHost();
  const sync = syncStatus(s);
  const r = presetComparison(preset, s.git, s.refs, s.proposalFile);
  const baseBranch = baseBranchFor(s.refs);
  const [mergeBase, setMergeBase] = useState<string | null | undefined>(undefined);
  const root = s.git?.repoRoot;
  useEffect(() => {
    let live = true;
    if (root && baseBranch) {
      host.gitMergeBase(root, 'HEAD', baseBranch).then(
        (c) => live && setMergeBase(c),
        () => live && setMergeBase(null),
      );
    }
    return () => {
      live = false;
    };
  }, [host, root, baseBranch, s.git?.headCommit]);
  return (
    <Flex direction="column" gap="3" data-testid={`details-${preset}`}>
      <Flex direction="column" gap="1">
        <Text weight="bold" size="2">
          {PRESET_LABELS[preset]}
        </Text>
        <Text size="1" color="gray">
          {DESCRIPTIONS[preset]}
        </Text>
      </Flex>
      {r.ok ? (
        <>
          <SideDetail role="From" sel={r.comparison.base} mergeBase={mergeBase} />
          <SideDetail role="To" sel={r.comparison.target} mergeBase={mergeBase} />
          {preset === 'actual' && sync.tag && (
            <Text size="1">{sync.current ? 'Local sync is current' : 'Local sync is required'} · <Code size="1">{sync.tag}</Code></Text>
          )}
        </>
      ) : (
        <Text size="1" color="amber">
          {r.reason}
        </Text>
      )}
    </Flex>
  );
}

/** Impact header: a "Details" popover with the git details of the active view. */
export function ImpactDetails() {
  const ctrl = useCtrl();
  const s = useApp((x) => x);
  const preset = activePreset(s.compare, s.git, s.refs, s.proposalFile);
  if (!preset) return null;
  return (
    <Popover.Root onOpenChange={(open) => { if (open) void ctrl.refreshGit(); }}>
      <Popover.Trigger>
        <Button size="1" variant="soft" color="gray" aria-label={`${PRESET_LABELS[preset]} details`}>
          Details <ChevronDownIcon aria-hidden />
        </Button>
      </Popover.Trigger>
      <Popover.Content width="380px" align="start">
        <Details preset={preset} />
      </Popover.Content>
    </Popover.Root>
  );
}
