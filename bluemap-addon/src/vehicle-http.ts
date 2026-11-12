export const publicBytes = async (
  url: string,
  signal: AbortSignal,
  limit: number,
): Promise<ArrayBuffer> => {
  const response = await fetch(url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
    cache: "no-cache",
  });
  if (!response.ok || !response.body) throw Error(`Vehicle asset HTTP ${response.status}`);
  return readBoundedResponse(response, limit);
};
export const readBoundedResponse = async (
  response: Response,
  limit: number,
): Promise<ArrayBuffer> => {
  if (!response.body) throw Error("Vehicle response has no body");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw Error("Vehicle asset exceeds size limit");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output.buffer;
};
