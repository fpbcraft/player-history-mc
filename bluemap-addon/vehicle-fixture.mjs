export const vehicleFixture = () => {
  const atlas = new TextEncoder().encode("/assets/bluemap3d/white.png");
  const positions = [
    -6, 0, -2, 6, 0, -2, 6, 4, -2, -6, 4, -2, -6, 0, 2, 6, 0, 2, 6, 4, 2, -6, 4, 2,
  ];
  const indices = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2,
    6, 1, 6, 5,
  ];
  const padding = (atlas.length + 3) & ~3,
    bytes = new ArrayBuffer(20 + padding + 8 * 20 + indices.length * 4 + 24),
    view = new DataView(bytes);
  view.setUint32(0, 0x424d3344, false);
  view.setUint32(4, 1, true);
  view.setUint32(8, 8, true);
  view.setUint32(12, indices.length, true);
  view.setUint32(16, atlas.length, true);
  new Uint8Array(bytes, 20, atlas.length).set(atlas);
  let offset = 20 + padding;
  new Float32Array(bytes, offset, positions.length).set(positions);
  offset += positions.length * 4;
  new Float32Array(bytes, offset, 16).fill(0.5);
  offset += 64;
  new Uint32Array(bytes, offset, indices.length).set(indices);
  offset += indices.length * 4;
  for (let i = 0; i < 8; i++) new Uint8Array(bytes, offset + i * 3, 3).set([235, 145, 65]);
  return bytes;
};
export const whitePng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=",
  "base64",
);
