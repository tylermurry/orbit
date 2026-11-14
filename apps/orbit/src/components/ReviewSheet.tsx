import { useEffect, useState } from 'react';
import { Text } from '@radix-ui/themes';
import { useApp, useDispatch } from '../state/context';
import { ChangeDetail, ChangeList } from './Changes';
import { Sheet } from './common';

export function ReviewSheet() {
  const review = useApp((s) => s.review);
  const d = useDispatch();
  const [sel, setSel] = useState<string | null>(null);
  useEffect(() => setSel(null), [review]);
  const change = review?.diff.changes.find((c) => c.key === sel) ?? null;
  return (
    <Sheet open={!!review} onOpenChange={(o) => !o && d({ type: 'review', review: null })} title="Review differences" description={review ? `${review.title} · ${review.diff.changes.length} semantic change${review.diff.changes.length === 1 ? '' : 's'}` : ''} width={680}>
      {review && (
        <>
          {review.diff.changes.length === 0 ? (
            <Text size="2" color="gray">
              The two versions are semantically identical (formatting and ordering are ignored).
            </Text>
          ) : (
            <ChangeList diff={review.diff} selectedKey={sel} onSelect={setSel} group="all" query="" category={null} />
          )}
          {change && (
            <div style={{ marginTop: 16 }}>
              <ChangeDetail diff={review.diff} change={change} />
            </div>
          )}
        </>
      )}
    </Sheet>
  );
}
