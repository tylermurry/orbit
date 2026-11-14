import { Button, Callout, Flex, Text } from '@radix-ui/themes';
import { InfoCircledIcon } from '@radix-ui/react-icons';
import type { AssuranceSummary, OrbitContract } from '@orbit/contract';
import { shortSha } from '../lib/format';
import { useApp, useCtrl } from '../state/context';

export type Bucket = 'all' | 'withTests' | 'passingCurrent' | 'failingCurrent' | 'untested' | 'noCurrentEvidence';

export const BUCKET_LABEL: Record<Bucket, string> = {
  all: 'All behaviors',
  withTests: 'Behaviors with tests',
  passingCurrent: 'Behaviors with passing evidence',
  failingCurrent: 'Failing behaviors',
  untested: 'Behaviors without tests',
  noCurrentEvidence: 'Mapped, no current evidence',
};

export function AssuranceSection({ summary, bucket, onBucket, hasCommit, contract }: { summary: AssuranceSummary; bucket: Bucket; onBucket: (b: Bucket) => void; hasCommit: boolean; contract: OrbitContract }) {
  const ctx = useApp((s) => s.evidenceCtx);
  const git = useApp((s) => s.git);
  const ctrl = useCtrl();
  void contract;
  const stats: { key: Bucket; label: string; value: number; tone: string }[] = [
    { key: 'all', label: 'Total', value: summary.total, tone: 'neutral' },
    { key: 'withTests', label: 'With tests', value: summary.withTests, tone: 'neutral' },
    { key: 'passingCurrent', label: 'Has passing evidence', value: summary.passingCurrent, tone: 'good' },
    { key: 'failingCurrent', label: 'Failing', value: summary.failingCurrent, tone: 'bad' },
    { key: 'untested', label: 'No tests', value: summary.untested, tone: 'warn' },
    { key: 'noCurrentEvidence', label: 'No current evidence', value: summary.noCurrentEvidence, tone: 'warn' },
  ];
  const seg = (n: number, cls: string) => (summary.total ? <span className={`seg ${cls}`} style={{ width: `${(n / summary.total) * 100}%` }} /> : null);
  const evidenceLine =
    ctx.kind === 'none'
      ? 'No code revision selected — evidence freshness is unknown.'
      : `Evidence checked against commit ${shortSha(ctx.kind === 'head' ? git?.headCommit : ctx.commit)} (${ctx.kind === 'head' ? 'HEAD' : ctx.label}).`;
  return (
    <section aria-labelledby="sec-assurance" className="section">
      <Flex justify="between" align="baseline" mb="2">
        <h3 id="sec-assurance" className="section-title">
          Assurance
        </h3>
        <Text size="1" color="gray" data-testid="evidence-line">
          {evidenceLine}
        </Text>
      </Flex>
      <div className="stats" role="group" aria-label="Assurance counts for this entity and its sub-items">
        {stats.map((st) => (
          <button key={st.key} type="button" className={`stat stat-${st.tone}${bucket === st.key ? ' active' : ''}`} aria-pressed={bucket === st.key} onClick={() => onBucket(bucket === st.key ? 'all' : st.key)} data-stat={st.key}>
            <span className="stat-value">{st.value}</span>
            <span className="stat-label">{st.label}</span>
          </button>
        ))}
      </div>
      {summary.total > 0 && (
        <div className="stackbar" aria-hidden="true">
          {seg(summary.passingCurrent, 'seg-good')}
          {seg(summary.failingCurrent, 'seg-bad')}
          {seg(summary.noCurrentEvidence, 'seg-warn')}
          {seg(summary.untested, 'seg-none')}
        </div>
      )}
      {ctx.kind === 'none' && git?.available && git.headCommit && (
        <Callout.Root size="1" variant="surface" mt="3">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Flex justify="between" align="center" gap="3" width="100%">
            <Callout.Text>Check evidence against HEAD ({shortSha(git.headCommit)})?</Callout.Text>
            <Button size="1" variant="soft" onClick={() => ctrl.setEvidence({ kind: 'head' })}>
              Use HEAD
            </Button>
          </Flex>
        </Callout.Root>
      )}
      {!hasCommit && ctx.kind === 'none' && !git?.available && (
        <Text as="p" size="1" color="gray" mt="2">
          Recorded results are shown with provenance, but without a code revision none can be called current.
        </Text>
      )}
    </section>
  );
}
