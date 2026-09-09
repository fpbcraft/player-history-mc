import type { HtmlMarker } from "./bluemap-types.js";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP = 8;

const horizontallyOverlaps = (left: Box, right: Box): boolean =>
  Math.abs(left.x - right.x) < (left.width + right.width) / 2 + GAP;

const applyOffset = (marker: HtmlMarker, x: number, y: number, bounds: DOMRect): void => {
  marker.offsetX = x;
  marker.offsetY = y;
  marker.element.style.translate = `${x}px ${y}px`;
  const distance = Math.hypot(x, y);
  const horizontal = distance ? Math.abs(x / distance) : 0;
  const vertical = distance ? Math.abs(y / distance) : 0;
  const edge = Math.min(
    horizontal ? bounds.width / 2 / horizontal : Infinity,
    vertical ? bounds.height / 2 / vertical : Infinity,
  );
  marker.element.style.setProperty?.("--connector-start", `${Math.min(edge, distance)}px`);
  marker.element.style.setProperty?.("--connector-length", `${Math.max(0, distance - edge)}px`);
  marker.element.style.setProperty?.("--connector-angle", `${Math.atan2(-y, -x)}rad`);
};

export const layoutEventMarkers = (markers: Iterable<HtmlMarker>): void => {
  const bubbles: Array<{
    marker: HtmlMarker;
    bounds: DOMRect;
    originX: number;
    originY: number;
    time: number;
  }> = [];
  for (const marker of markers) {
    const bounds = marker.element.getBoundingClientRect();
    const originX = bounds.left + bounds.width / 2 - (marker.offsetX ?? 0);
    const originY = bounds.top + bounds.height / 2 - (marker.offsetY ?? 0);
    applyOffset(marker, 0, 0, bounds);
    if (
      String(marker.element.className).includes("history-chat-bubble") &&
      bounds.width &&
      bounds.height
    )
      bubbles.push({
        marker,
        bounds,
        originX,
        originY,
        time: Number(marker.element.dataset.historyTime ?? 0),
      });
  }

  bubbles.sort((left, right) => left.time - right.time);
  const occupied: Box[] = [];
  for (const { marker, bounds, originX, originY } of bubbles) {
    const candidate: Box = { x: originX, y: originY, width: bounds.width, height: bounds.height };
    for (let pass = 0; pass <= occupied.length; pass++) {
      const collision = occupied.find(
        (previous) =>
          horizontallyOverlaps(previous, candidate) &&
          candidate.y - candidate.height / 2 < previous.y + previous.height / 2 + GAP &&
          candidate.y + candidate.height / 2 > previous.y - previous.height / 2 - GAP,
      );
      if (!collision) break;
      candidate.y = collision.y + (collision.height + candidate.height) / 2 + GAP;
    }
    occupied.push(candidate);
    applyOffset(marker, 0, candidate.y - originY, bounds);
  }
};
