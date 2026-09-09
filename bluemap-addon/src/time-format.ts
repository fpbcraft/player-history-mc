export const formatDate = (time: number, seconds = true): string =>
  new Date(time).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    ...(seconds ? { second: "2-digit" } : {}),
  });
