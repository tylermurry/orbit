import { useEffect, useState } from 'react';
import { localDateString, msUntilNextLocalMidnight } from '../logic/localDate';

/**
 * The current local calendar date. Re-evaluated when the window regains focus, when the tab becomes
 * visible again, and at the next local midnight, so Today/Overdue stay correct without a refresh.
 */
export function useToday(now: () => Date = () => new Date()): string {
  const [today, setToday] = useState(() => localDateString(now()));
  useEffect(() => {
    const update = () => setToday(localDateString(now()));
    let timer: number;
    const arm = () => {
      timer = window.setTimeout(() => {
        update();
        arm();
      }, msUntilNextLocalMidnight(now()));
    };
    arm();
    update();
    window.addEventListener('focus', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, [now]);
  return today;
}
