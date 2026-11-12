/** Signed distance along an object's dominant local horizontal axis. */
export const signedVehicleTravel = (
  dx: number,
  dy: number,
  dz: number,
  q: readonly [number, number, number, number],
): number => {
  const distance = Math.hypot(dx, dy, dz);
  // Rotate world delta by inverse(from rotation), yielding object-local motion.
  const ix = q[3] * dx - q[1] * dz + q[2] * dy;
  const iy = q[3] * dy - q[2] * dx + q[0] * dz;
  const iz = q[3] * dz - q[0] * dy + q[1] * dx;
  const iw = q[0] * dx + q[1] * dy + q[2] * dz;
  const lx = ix * q[3] + iw * q[0] + iy * q[2] - iz * q[1];
  const lz = iz * q[3] + iw * q[2] + ix * q[1] - iy * q[0];

  // Create carriages can be authored along local X or Z depending on bogey orientation.
  // The dominant horizontal component gives a stable signed odometer for both.
  const sign = Math.abs(lz) >= Math.abs(lx) ? Math.sign(lz) : Math.sign(lx);
  return distance * (sign || 1);
};
