import { Fragment } from 'react';
import { Text } from '@radix-ui/themes';
import type { ImpactPath } from '@orbit/contract';
import { REL_INFO } from '../lib/model';

/** "A —uses→ B —dependsOn→ C (changed)" rendered as an accessible chain. */
export function ImpactChain({ path, nameOf }: { path: ImpactPath; nameOf: (id: string) => string }) {
  const first = path.path[0];
  return (
    <span className="impact-chain" data-testid="impact-chain">
      <Text size="2" weight="medium">
        {nameOf(first ? first.sourceId : path.entityId)}
      </Text>
      {path.path.map((step, i) => (
        <Fragment key={step.relationshipId + i}>
          <span className="chain-arrow" aria-hidden>
            {' '}
            —{REL_INFO[step.type].verb}→{' '}
          </span>
          <span className="sr-only"> {REL_INFO[step.type].verb} </span>
          <Text size="2" weight={i === path.path.length - 1 ? 'bold' : 'medium'}>
            {nameOf(step.targetId)}
            {i === path.path.length - 1 ? ' (changed)' : ''}
          </Text>
        </Fragment>
      ))}
    </span>
  );
}
