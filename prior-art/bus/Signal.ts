/**
 * Reactive value container backed by the TC39 Signals proposal
 * (via signal-polyfill). Exposes .value get/set for compatibility
 * with Lit's signal integration, and a subscribe() helper built
 * on Signal.subtle.Watcher.
 */
import { Signal as S } from "signal-polyfill";

let needsEnqueue = true;
const watcher = new S.subtle.Watcher(() => {
  if (needsEnqueue) {
    needsEnqueue = false;
    queueMicrotask(processPending);
  }
});

function processPending(): void {
  needsEnqueue = true;
  for (const s of watcher.getPending()) {
    s.get();
  }
  watcher.watch();
}

export class Signal<T> {
  #state: S.State<T>;

  constructor(initial: T) {
    this.#state = new S.State(initial);
  }

  get value(): T {
    return this.#state.get();
  }

  set value(next: T) {
    this.#state.set(next);
  }

  /**
   * Subscribe to value changes. Returns an unsubscribe function.
   * Built on Signal.subtle.Watcher + Signal.Computed.
   */
  subscribe(fn: (value: T) => void): () => void {
    const computed = new S.Computed(() => {
      const v = this.#state.get();
      fn(v);
      return v;
    });
    watcher.watch(computed);
    computed.get();
    return () => watcher.unwatch(computed);
  }
}
