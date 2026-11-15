import { Button, Flex, Text } from '@radix-ui/themes';
import type { AssuranceBucket, AssuranceSummary } from '@orbit/contract';
import { relativeTime } from '../lib/format';
import { useApp, useDispatch } from '../state/context';

export type Bucket = AssuranceBucket;

export const BUCKET_LABEL: Record<Bucket, string> = {
  all: 'All behaviors',
  withTests: 'Behaviors with tests',
  passing: 'Passing behaviors',
  failing: 'Failing behaviors',
  unconfirmed: 'Unconfirmed behaviors',
  planned: 'Behaviors with only planned tests',
  untested: 'Behaviors without tests',
};

/** One line on where test results come from and how current they are. */
export function ResultsLine() {
  const validation = useApp((s) => s.contract?.validation);
  const file = useApp((s) => s.resultsFile);
  const d = useDispatch();
  let text: string;
  if (!validation) text = 'Tests are not set up to run yet.';
  else if (!file || file.state === 'missing') text = 'No test results yet.';
  else if (file.state === 'invalid') text = 'The test results file could not be read.';
  else text = `Last test run ${relativeTime(file.at!)}.`;
  return (
    <Flex align="center" gap="2" data-testid="results-line">
      <Text size="1" color="gray">
        {text}
      </Text>
      {!validation && (
        <Button size="1" variant="ghost" onClick={() => d({ type: 'ui', patch: { terminalOpen: true, terminalTab: 'validate' } })}>
          Set up
        </Button>
      )}
    </Flex>
  );
}

export function AssuranceSection({ summary, bucket, onBucket }: { summary: AssuranceSummary; bucket: Bucket; onBucket: (b: Bucket) => void }) {
  const stats: { key: Bucket; label: string; value: number; tone: string }[] = [
    { key: 'all', label: 'Total', value: summary.total, tone: 'neutral' },
    { key: 'passing', label: 'Passing', value: summary.passing, tone: 'good' },
    { key: 'failing', label: 'Failing', value: summary.failing, tone: 'bad' },
    { key: 'unconfirmed', label: 'Unconfirmed', value: summary.unconfirmed, tone: 'warn' },
    { key: 'untested', label: 'No tests', value: summary.untested, tone: 'neutral' },
  ];
  const seg = (n: number, cls: string) => (summary.total ? <span className={`seg ${cls}`} style={{ width: `${(n / summary.total) * 100}%` }} /> : null);
  return (
    <section aria-labelledby="sec-assurance" className="section">
      <Flex justify="between" align="baseline" mb="2" gap="3" wrap="wrap">
        <h3 id="sec-assurance" className="section-title">
          Assurance
        </h3>
        <ResultsLine />
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
          {seg(summary.passing, 'seg-good')}
          {seg(summary.failing, 'seg-bad')}
          {seg(summary.unconfirmed, 'seg-warn')}
          {seg(summary.untested, 'seg-none')}
        </div>
      )}
    </section>
  );
}
