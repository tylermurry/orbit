// Tiny channel so other parts of the UI can ask the Raw JSON editor to move the caret.
export interface RawJump {
  line: number;
  column: number;
}
let pending: RawJump | null = null;
const EVT = 'orbit:raw-jump';

export function requestRawJump(j: RawJump): void {
  pending = j;
  window.dispatchEvent(new CustomEvent<RawJump>(EVT, { detail: j }));
}
export function takePendingRawJump(): RawJump | null {
  const p = pending;
  pending = null;
  return p;
}
export function onRawJump(fn: (j: RawJump) => void): () => void {
  const h = (e: Event) => {
    pending = null;
    fn((e as CustomEvent<RawJump>).detail);
  };
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}
