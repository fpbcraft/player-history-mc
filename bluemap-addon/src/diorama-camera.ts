import * as T from "three";
import type { DioramaViewport } from "./diorama-api.js";

export const cameraOrigin = (state: DioramaViewport): T.Vector3 => {
  const z = state.v / state.projection.sin,
    x = state.u,
    f = state.projection.facing;
  return new T.Vector3(
    f === 1 ? -z : f === 2 ? -x : f === 3 ? z : x,
    0,
    f === 1 ? x : f === 2 ? -z : f === 3 ? -x : z,
  );
};
export const turnDirection = (vector: T.Vector3, facing: number): T.Vector3 => {
  const { x, y, z } = vector;
  return new T.Vector3(
    facing === 1 ? -z : facing === 2 ? -x : facing === 3 ? z : x,
    y,
    facing === 1 ? x : facing === 2 ? -z : facing === 3 ? -x : z,
  );
};
export const updateVehicleCamera = (
  camera: T.OrthographicCamera,
  state: DioramaViewport,
): T.Vector3 => {
  const origin = cameraOrigin(state),
    { sin, cos, facing } = state.projection;
  camera.left = -state.width / state.scale / 2;
  camera.right = -camera.left;
  camera.top = state.height / state.scale / 2;
  camera.bottom = -camera.top;
  camera.near = 0;
  camera.far = 65536;
  camera.position.copy(turnDirection(new T.Vector3(0, sin, cos), facing)).multiplyScalar(32768);
  camera.up.copy(turnDirection(new T.Vector3(0, cos, -sin), facing));
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return origin;
};
