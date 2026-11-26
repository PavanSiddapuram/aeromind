import type { AABB, Vector3 } from "../index.js";
import { assertValidAABB } from "./aabb.js";
import { assertFiniteVector3, subtract } from "../math/vector3.js";

export type SegmentIntersection = {
  intersects: boolean;
  /** Segment parameter t in [0, 1], when an intersection exists. */
  tEnter: number | null;
  tExit: number | null;
  /** First contact point, when an intersection exists. */
  point: Vector3 | null;
};

/**
 * Slab-based line-segment/AABB intersection.
 * Contact with a face, edge or corner counts as an intersection (conservative).
 * The function is deterministic and does not mutate inputs.
 */
export function intersectSegmentAABB(
  start: Vector3,
  end: Vector3,
  bounds: AABB,
  epsilon = 1e-9,
): SegmentIntersection {
  assertFiniteVector3(start, "segment start");
  assertFiniteVector3(end, "segment end");
  assertValidAABB(bounds);

  if (!Number.isFinite(epsilon) || epsilon < 0) {
    throw new RangeError("epsilon must be finite and non-negative");
  }

  const direction = subtract(end, start);
  let tMin = 0;
  let tMax = 1;

  const axes = [
    { origin: start.x, delta: direction.x, min: bounds.min.x, max: bounds.max.x },
    { origin: start.y, delta: direction.y, min: bounds.min.y, max: bounds.max.y },
    { origin: start.z, delta: direction.z, min: bounds.min.z, max: bounds.max.z },
  ];

  for (const axis of axes) {
    if (Math.abs(axis.delta) <= epsilon) {
      if (axis.origin < axis.min - epsilon || axis.origin > axis.max + epsilon) {
        return { intersects: false, tEnter: null, tExit: null, point: null };
      }
      continue;
    }

    const inverse = 1 / axis.delta;
    let t1 = (axis.min - axis.origin) * inverse;
    let t2 = (axis.max - axis.origin) * inverse;

    if (t1 > t2) [t1, t2] = [t2, t1];

    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);

    if (tMin > tMax + epsilon) {
      return { intersects: false, tEnter: null, tExit: null, point: null };
    }
  }

  if (tMax < -epsilon || tMin > 1 + epsilon) {
    return { intersects: false, tEnter: null, tExit: null, point: null };
  }

  const tEnter = Math.min(1, Math.max(0, tMin));
  const tExit = Math.min(1, Math.max(0, tMax));

  return {
    intersects: true,
    tEnter,
    tExit,
    point: {
      x: start.x + direction.x * tEnter,
      y: start.y + direction.y * tEnter,
      z: start.z + direction.z * tEnter,
    },
  };
}
