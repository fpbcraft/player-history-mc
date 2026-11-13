import { slerp } from "./object-replay.js";
import type { VehiclePose } from "./vehicle-scene.js";

/** Continue from the displayed pose, without restarting on repeated HTTP snapshots. */
export class VehicleMotion {
  private generated = -Infinity;
  private received = 0;
  private duration = 100;
  private targets: VehiclePose[] = [];
  private from = new Map<string, VehiclePose>();
  update(generated: number, rows: VehiclePose[], now: number, interval: number): void {
    if (generated < this.generated) return;
    if (generated === this.generated) {
      // Geometry can finish after its pose was captured. Do not rewind its movement.
      this.targets = rows;
      return;
    }
    this.from = new Map(this.sample(now).map((row) => [row.id, row]));
    const gap = generated - this.generated;
    this.duration = Math.max(50, Math.min(150, Number.isFinite(gap) ? gap : interval));
    this.generated = generated;
    this.received = now;
    this.targets = rows;
  }
  sample(now: number, reduced = false): VehiclePose[] {
    const alpha = reduced ? 1 : Math.max(0, Math.min(1, (now - this.received) / this.duration));
    return this.targets.map((row) => {
      const before = this.from.get(row.id);
      // Ground-composited shadows are world anchored; moving them smears roofs/terrain.
      if (
        row.shadow ||
        before?.dimension !== row.dimension ||
        Math.hypot(...row.pos.map((v, i) => v - (before.pos[i] ?? v))) >= 128
      )
        return row;
      return {
        ...row,
        pos: row.pos.map(
          (v, i) => (before.pos[i] ?? v) + (v - (before.pos[i] ?? v)) * alpha,
        ) as VehiclePose["pos"],
        rot: slerp(before.rot, row.rot, alpha),
        travel: (before.travel ?? 0) + ((row.travel ?? 0) - (before.travel ?? 0)) * alpha,
      };
    });
  }
}
