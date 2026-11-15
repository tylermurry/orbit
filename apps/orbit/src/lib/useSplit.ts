import { useEffect, useState } from 'react';
import { useAppState } from '../state/context';

/** Window width at which Capabilities and Impact are shown side by side. */
export const SPLIT_MIN_WIDTH = 1400;
const QUERY = `(min-width: ${SPLIT_MIN_WIDTH}px)`;

export function useWideWindow(): boolean {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

/** True when Capabilities (left) and Impact (right) are shown side by side. */
export function useSplit(): boolean {
  const s = useAppState();
  const wide = useWideWindow();
  return wide && !!s.filePath && !!s.contract && !s.rawMode && !!s.git?.available;
}
