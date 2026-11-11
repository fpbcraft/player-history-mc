export async function mapConcurrent<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  load: (item: Item) => Promise<Result>,
  onProgress?: (completed: number, total: number) => void,
): Promise<Result[]> {
  const results = new Array<Result>(items.length);
  let next = 0;
  let completed = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await load(item);
      onProgress?.(++completed, items.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, worker),
  );
  return results;
}

/** Consume in recording order, retaining at most one batch of decoded chunks. */
export async function consumeConcurrent<Item, Result>(
  items: readonly Item[],
  concurrency: number,
  load: (item: Item) => Promise<Result>,
  consume: (result: Result, index: number) => void,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  const width = Math.max(1, Math.floor(concurrency) || 1);
  for (let offset = 0; offset < items.length; offset += width) {
    const batch = await Promise.all(items.slice(offset, offset + width).map(load));
    for (let index = 0; index < batch.length; index++) {
      consume(batch[index] as Result, offset + index);
      onProgress?.(offset + index + 1, items.length);
    }
  }
}
