import type { HtmlMarker, MarkerSet } from "./bluemap-types.js";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Candidate {
  dx: number;
  dy: number;
}

const overlaps = (box: Box, x: number, y: number, width: number, height: number): boolean =>
  Math.abs(box.x - x) < (box.width + width) / 2 + 8 &&
  Math.abs(box.y - y) < (box.height + height) / 2 + 8;

const candidatesFor = (element: HTMLElement, bounds: DOMRect): Candidate[] => {
  const candidates: Candidate[] = [];
  if (
    element.classList?.contains("history-chat-bubble") ||
    String(element.className ?? "").includes("history-chat-bubble")
  ) {
    for (let column = -5; column <= 5; column++) {
      for (let row = -10; row <= 10; row++) {
        if (column || row)
          candidates.push({
            dx: column * (bounds.width + 10),
            dy: row * (bounds.height + 10),
          });
      }
    }
    return candidates.sort(
      (left, right) =>
        Math.hypot(left.dx, left.dy) - Math.hypot(right.dx, right.dy) ||
        Math.abs(left.dx) - Math.abs(right.dx),
    );
  }
  for (let ring = 0; ring < 12; ring++) {
    for (let slot = 0; slot < 16; slot++) {
      const angle = -Math.PI / 2 + (slot * Math.PI) / 8;
      candidates.push({
        dx: Math.cos(angle) * (48 + ring * 34),
        dy: Math.sin(angle) * (48 + ring * 34),
      });
    }
  }
  return candidates;
};

const reserveElement = (occupied: Box[], element?: Element | null, protectHead = false): void => {
  const bounds = element?.getBoundingClientRect();
  if (!bounds?.width || !bounds.height) return;
  const extra = protectHead ? 28 : 0;
  occupied.push({
    x: bounds.left + bounds.width / 2,
    y: bounds.top + (bounds.height + extra) / 2,
    width: bounds.width,
    height: bounds.height + extra,
  });
};

const applyConnector = (marker: HtmlMarker, candidate: Candidate, bounds: DOMRect): void => {
  marker.offsetX = candidate.dx;
  marker.offsetY = candidate.dy;
  marker.element.style.translate = `${candidate.dx}px ${candidate.dy}px`;
  const distance = Math.hypot(candidate.dx, candidate.dy);
  const horizontal = distance ? Math.abs(candidate.dx / distance) : 0;
  const vertical = distance ? Math.abs(candidate.dy / distance) : 0;
  const edge = Math.min(
    horizontal ? bounds.width / 2 / horizontal : Infinity,
    vertical ? bounds.height / 2 / vertical : Infinity,
  );
  marker.element.style.setProperty("--connector-start", `${Math.min(edge, distance)}px`);
  marker.element.style.setProperty("--connector-length", `${Math.max(0, distance - edge)}px`);
  marker.element.style.setProperty(
    "--connector-angle",
    `${Math.atan2(-candidate.dy, -candidate.dx)}rad`,
  );
};

export const layoutEventMarkers = (
  eventMarkers: Iterable<HtmlMarker>,
  playerMarkers?: MarkerSet,
): void => {
  const occupied: Box[] = [];
  for (const marker of playerMarkers?.markers.values() ?? []) {
    reserveElement(occupied, marker.element);
    reserveElement(occupied, marker.element.querySelector(".history-player-vitals"), true);
  }
  for (const marker of eventMarkers) {
    const bounds = marker.element.getBoundingClientRect();
    if (!bounds.width || !bounds.height) continue;
    const originX = bounds.left + bounds.width / 2 - (marker.offsetX ?? 0);
    const originY = bounds.top + bounds.height / 2 - (marker.offsetY ?? 0);
    const candidate = candidatesFor(marker.element, bounds).find(({ dx, dy }) => {
      const x = originX + dx;
      const y = originY + dy;
      if (
        x < bounds.width / 2 + 8 ||
        y < bounds.height / 2 + 8 ||
        x > innerWidth - bounds.width / 2 - 8 ||
        y > innerHeight - bounds.height / 2 - 8
      )
        return false;
      return !occupied.some((box) => overlaps(box, x, y, bounds.width, bounds.height));
    }) ?? { dx: 0, dy: -48 };
    occupied.push({
      x: originX + candidate.dx,
      y: originY + candidate.dy,
      width: bounds.width,
      height: bounds.height,
    });
    applyConnector(marker, candidate, bounds);
  }
};
