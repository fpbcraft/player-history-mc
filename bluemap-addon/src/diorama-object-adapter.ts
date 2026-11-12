import type { DioramaSceneHost } from "./diorama-scene-host.js";
import type { DioramaApi, OverlayRegistration } from "./diorama-api.js";
import type { ObjectMapAdapter } from "./map-adapter.js";
import type { ObjectGeometryEntry, ObjectPose, ObjectRegistryEntry } from "./types.js";

/** Recorded object poses already use blocks. No mesh/archive requests are made here. */
export class DioramaObjectAdapter implements ObjectMapAdapter {
  private readonly layer = document.createElement("div");
  private readonly overlay: OverlayRegistration;
  private readonly markers = new Map<number, { element: HTMLButtonElement; pose: ObjectPose }>();
  private dimension: string | undefined;
  private readonly listeners = new AbortController();

  constructor(
    private readonly api: DioramaApi,
    private readonly scene?: DioramaSceneHost,
  ) {
    this.layer.className = "diorama-history-markers";
    this.overlay = api.registerOverlay("object-history", { element: this.layer });
    api.events.addEventListener("change", () => this.layout(), { signal: this.listeners.signal });
  }

  setObjects(
    poses: ObjectPose[],
    objects: ObjectRegistryEntry[],
    _geometries: ObjectGeometryEntry[],
    _base: string,
  ): void {
    this.dimension = this.api.getState()?.dimension;
    this.scene?.setHistorical(poses, objects, _geometries, _base);
    const keep = new Set<number>();
    for (const pose of poses.slice(0, 1000)) {
      const identity = objects.find((object) => object.id === pose.object);
      if (!identity) continue;
      keep.add(pose.object);
      let marker = this.markers.get(pose.object);
      if (!marker) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "diorama-history-marker diorama-object-marker";
        element.textContent = /train/i.test(identity.provider)
          ? "🚂"
          : /ship|sable|aeronaut/i.test(identity.provider)
            ? "⛵"
            : "⚙";
        marker = { element, pose };
        this.markers.set(pose.object, marker);
        this.layer.append(element);
      }
      marker.pose = pose;
      marker.element.title = `${identity.label || identity.sourceId} · recorded position\n${pose.x.toFixed(1)}, ${pose.y.toFixed(1)}, ${pose.z.toFixed(1)}`;
      marker.element.setAttribute("aria-label", marker.element.title);
    }
    for (const [id, marker] of this.markers)
      if (!keep.has(id)) {
        marker.element.remove();
        this.markers.delete(id);
      }
    this.layout();
  }

  private layout(): void {
    for (const { element, pose } of this.markers.values()) {
      element.hidden = this.dimension !== this.api.getState()?.dimension;
      element.dataset.model = String(this.scene?.hasHistorical(pose.object) ?? false);
      const pixel = this.api.screen(pose);
      if (!pixel) continue;
      element.style.transform = `translate(${pixel.x}px,${pixel.y}px) translate(-50%,-50%)`;
    }
  }
  clear(): void {
    this.scene?.clearHistorical();
    this.layer.replaceChildren();
    this.markers.clear();
  }
  dispose(): void {
    this.clear();
    this.listeners.abort();
    this.overlay.remove();
  }
}
