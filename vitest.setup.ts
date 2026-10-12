/**
 * Polyfills browser APIs that jsdom lacks.
 *
 * `ResizeObserver` exists in all three Tauri webviews; only jsdom is missing
 * it, so it is stubbed here rather than guarded in components (`Segmented`,
 * `Tabs`). The stub never fires: jsdom measures everything as 0.
 */
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
