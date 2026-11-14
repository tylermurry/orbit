export function setWindowTitle(title: string): void {
  document.title = title;
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    import('@tauri-apps/api/window')
      .then((m) => m.getCurrentWindow().setTitle(title))
      .catch(() => undefined);
  }
}
