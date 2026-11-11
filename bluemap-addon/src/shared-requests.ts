/** Share pending reads without letting one cancelled consumer cancel the others. */
export class SharedRequests<Key, Value> {
  private readonly pending = new Map<
    Key,
    { controller: AbortController; promise: Promise<Value>; users: number }
  >();

  read(
    key: Key,
    load: (signal: AbortSignal) => Promise<Value>,
    signal?: AbortSignal,
  ): Promise<Value> {
    signal?.throwIfAborted();
    let entry = this.pending.get(key);
    if (!entry) {
      const controller = new AbortController();
      const shared: { controller: AbortController; users: number; promise: Promise<Value> } = {
        controller,
        users: 0,
        promise: Promise.resolve(undefined as Value),
      };
      shared.promise = Promise.resolve()
        .then(() => load(controller.signal))
        .finally(() => {
          if (this.pending.get(key) === shared) this.pending.delete(key);
        });
      entry = shared;
      this.pending.set(key, entry);
    }
    const shared = entry;
    shared.users++;
    return new Promise<Value>((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return false;
        done = true;
        signal?.removeEventListener("abort", cancel);
        if (--shared.users === 0 && this.pending.get(key) === shared) {
          this.pending.delete(key);
          shared.controller.abort();
        }
        return true;
      };
      const cancel = () => {
        if (finish()) reject(signal?.reason);
      };
      signal?.addEventListener("abort", cancel, { once: true });
      shared.promise.then(
        (value) => {
          if (finish()) resolve(value);
        },
        (error: unknown) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  clear(): void {
    for (const entry of this.pending.values()) entry.controller.abort();
    this.pending.clear();
  }
}
