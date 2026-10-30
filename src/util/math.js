export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const lerp = (a, b, t) => a + (b - a) * t;

/** Wraps an angle into (-PI, PI]. */
export function wrapAngle(angle) {
    const turn = Math.PI * 2;
    let wrapped = angle % turn;
    if (wrapped > Math.PI) wrapped -= turn;
    else if (wrapped <= -Math.PI) wrapped += turn;
    return wrapped;
}

export function distanceSq(ax, az, bx, bz) {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
}

/** Turns `rotation` toward the point (tx, tz) from (x, z), by at most `maxStep` radians. Heading 0 = +z. */
export function turnToward(rotation, x, z, tx, tz, maxStep) {
    const diff = wrapAngle(Math.atan2(tx - x, tz - z) - rotation);
    return rotation + Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
}

/** Velocity of something driving along a street axis ("x" or "z"); direction is +1 or -1. */
export function axisVelocity(axis, speed, direction) {
    return { vx: axis === "x" ? speed * direction : 0, vz: axis === "z" ? speed * direction : 0 };
}

/** Yaw (rotation.y) of a car travelling along an axis in the given direction. */
export function axisYaw(axis, direction) {
    return axis === "x" ? (direction * Math.PI) / 2 : direction > 0 ? 0 : Math.PI;
}
