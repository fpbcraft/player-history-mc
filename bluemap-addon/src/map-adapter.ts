import type { RosterPlayer } from "./player-roster.js";
import type {
  HistoryEvent,
  HistoryPoint,
  HistoryRegistry,
  PlayerState,
  PointSegment,
  ObjectGeometryEntry,
  ObjectPose,
  ObjectRegistryEntry,
} from "./types.js";

/** Coordinates at this boundary use protocol units (32 per block). */
export interface MapAdapter {
  readonly mapId: string | undefined;
  stateDetails?: (player: number, time: number) => Promise<string>;
  navigatePlayer?: (point: HistoryPoint) => Promise<void>;
  focusPoint(point: HistoryPoint): boolean;
  setPlayers(
    points: HistoryPoint[],
    names: Map<number, string>,
    players: HistoryRegistry["players"],
    live?: boolean,
  ): void;
  setRoster(rows: readonly RosterPlayer[]): void;
  setOfflineLocations(rows: readonly RosterPlayer[]): void;
  setPlayerVitals(player: number, state?: PlayerState, items?: HistoryRegistry["items"]): void;
  setTrails(segments: PointSegment[], names?: Map<number, string>): void;
  setEvents(
    events: HistoryEvent[],
    names: Map<number, string>,
    seek?: (time: number) => void,
    registry?: Partial<HistoryRegistry>,
  ): void;
  layoutEvents(): void;
  setHeatmap(rows: [number, number, number, number, number][], size: number, opacity: number): void;
  clearHeatmap(): void;
  dispose(): void;
}

export interface ObjectMapAdapter {
  setObjects(
    poses: ObjectPose[],
    objects: ObjectRegistryEntry[],
    geometries: ObjectGeometryEntry[],
    base: string,
  ): void;
  clear(): void;
  dispose(): void;
}
