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
