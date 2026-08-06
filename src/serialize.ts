// Pure serialization primitive (no vscode / node typings) so it is unit-testable.
// The store's saves are read -> parse -> apply -> serialize -> atomic-write cycles with an
// async gap in the middle; VSCode does not serialize async webview-message handlers, so a
// fan-out of patches (Save All) runs those cycles concurrently. Overlapping cycles lose
// updates (a later read sees pre-write state) and can collide on the shared temp file. This
// Mutex chains every write behind the previous one so the cycles run strictly one-at-a-time.
export class Mutex {
  // Never rejects: each link swallows its outcome so one failed op cannot break the chain
  // for later callers.
  private tail: Promise<void> = Promise.resolve();

  // Queue fn to run after all previously-queued ops settle; the returned promise mirrors
  // fn's own resolution/rejection so callers still see their result or error.
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(() => fn());
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
