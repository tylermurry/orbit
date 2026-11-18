import { useState } from 'react';
import { SegmentedControl } from '@radix-ui/themes';
import type { Change, SemanticDiff } from '@orbit/contract';
import { FlowStage } from './FlowStage';

/** The Flows screen for a planned change: added shows the proposed flow, modified adds a Before / After switch. */
export function FlowChangePreview({ diff, change }: { diff: SemanticDiff; change: Change }) {
  const [side, setSide] = useState<'before' | 'after'>('after');
  const [step, setStep] = useState(0);
  const showing = change.kind === 'removed' ? 'before' : change.kind === 'added' ? 'after' : side;
  const contract = showing === 'before' ? diff.base : diff.target;
  const flow = contract?.flows?.find((f) => f.id === change.id);
  if (!contract || !flow) return null;
  return (
    <div className="flows-view flow-change-preview" data-testid="flow-preview">
      <FlowStage
        contract={contract}
        flow={flow}
        step={step}
        onStep={setStep}
        actions={
          change.kind === 'modified' ? (
            <SegmentedControl.Root className="flow-delete" size="1" value={side} onValueChange={(v) => { setSide(v as 'before' | 'after'); setStep(0); }} aria-label="Flow version">
              <SegmentedControl.Item value="before">Before</SegmentedControl.Item>
              <SegmentedControl.Item value="after">After</SegmentedControl.Item>
            </SegmentedControl.Root>
          ) : null
        }
      />
    </div>
  );
}
