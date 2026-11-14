import type { VehiclePose } from "./vehicle-scene.js";

/** Subpixel craft use their existing waypoint pins instead of a full WebGL model pass. */
export const vehicleModelVisible = (row: VehiclePose, scale: number): boolean =>
  (row.size ?? 32) * scale >= 12;

export const vehiclePinVisible = (row: VehiclePose, includeUnnamed = false): boolean =>
  !row.shadow && (row.named === true || includeUnnamed);

/** One named train pin at distant zoom, while every carriage continues rendering independently. */
export const vehicleMarkers = (rows: readonly VehiclePose[], scale: number): VehiclePose[] => {
  const groups = new Map<string, VehiclePose[]>(),
    out: VehiclePose[] = [];
  for (const row of rows) {
    if (row.shadow) continue;
    const small = (row.size ?? 32) * scale < 64;
    if (row.named && small && row.group) {
      const key = `${row.dimension}|${row.group}`;
      const group = groups.get(key) ?? [];
      group.push(row);
      groups.set(key, group);
    } else out.push(row);
  }
  for (const group of groups.values()) {
    const first = group.toSorted((a, b) => a.id.localeCompare(b.id))[0];
    if (!first) continue;
    const pos = first.pos.map(
      (_, axis) => group.reduce((sum, row) => sum + (row.pos[axis] ?? 0), 0) / group.length,
    ) as VehiclePose["pos"];
    out.push({ ...first, id: `group:${first.dimension}:${first.group}`, pos });
  }
  return out;
};
export const updateVehiclePin = (marker: HTMLButtonElement, row: VehiclePose): void => {
  marker.classList.add("diorama-waypoint-pin");
  if (!marker.querySelector(".diorama-pin-initials")) {
    const image = document.createElement("img");
    image.alt = "";
    image.className = "diorama-pin-picture";
    const initials = document.createElement("span");
    initials.className = "diorama-pin-initials";
    const label = document.createElement("span");
    label.className = "diorama-pin-label";
    marker.replaceChildren(image, initials, label);
  }
  const image = marker.querySelector<HTMLImageElement>("img"),
    initials = marker.querySelector(".diorama-pin-initials"),
    label = marker.querySelector(".diorama-pin-label");
  if (image) {
    image.hidden = !row.icon;
    if (row.icon && image.src !== row.icon) image.src = row.icon;
  }
  if (initials)
    initials.textContent = row.named
      ? row.label
          .trim()
          .split(/\s+/)
          .map((word) => [...word][0] ?? "")
          .slice(0, 2)
          .join("")
          .toUpperCase()
      : /train|contraption/.test(row.id)
        ? "T"
        : "S";
  if (label) label.textContent = row.named ? row.label : "";
  marker.dataset.named = String(row.named === true);
};

interface LabelPin {
  element: HTMLButtonElement;
  x: number;
  y: number;
  name: string;
}
/** Place names around neighbouring pin heads without reading layout on each animation frame. */
export const arrangeVehicleLabels = (pins: LabelPin[], width: number, height: number): void => {
  const boxes = pins.map((pin) => ({ x: pin.x - 19, y: pin.y - 42, w: 38, h: 32 }));
  const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w + 2 && a.x + a.w + 2 > b.x && a.y < b.y + b.h + 2 && a.y + a.h + 2 > b.y;
  for (const pin of pins) {
    const label = pin.element.querySelector<HTMLElement>(".diorama-pin-label");
    if (!label) continue;
    const w = Math.min(180, pin.name.length * 7 + 10),
      dx = pin.x + 23 + w > width ? -w - 23 : 23;
    let top = 6;
    for (const offset of [0, -24, 24, -48, 48, -72, 72]) {
      const box = { x: pin.x + dx, y: pin.y - 36 + offset, w, h: 22 };
      if (box.y < 4 || box.y + box.h > height - 4 || boxes.some((other) => overlaps(box, other)))
        continue;
      boxes.push(box);
      top = 6 + offset;
      break;
    }
    label.style.left = `${dx + 19}px`;
    label.style.top = `${top}px`;
  }
};
