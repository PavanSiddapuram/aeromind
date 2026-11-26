import type { AABB, Vector3 } from "../index.js";
import { assertFiniteVector3 } from "../math/vector3.js";

export function assertValidAABB(bounds: AABB, name = "AABB"): void {
  assertFiniteVector3(bounds.min, `${name}.min`);
  assertFiniteVector3(bounds.max, `${name}.max`);

  if (
    bounds.min.x > bounds.max.x ||
    bounds.min.y > bounds.max.y ||
    bounds.min.z > bounds.max.z
  ) {
    throw new RangeError(`${name} minimum coordinates must not exceed maximum coordinates`);
  }
}

export function expandAABB(bounds: AABB, margin: number | Vector3): AABB {
  assertValidAABB(bounds);
  const offset = typeof margin === "number"
    ? { x: margin, y: margin, z: margin }
    : margin;

  assertFiniteVector3(offset, "margin");
  if (offset.x < 0 || offset.y < 0 || offset.z < 0) {
    throw new RangeError("AABB expansion margins must be non-negative");
  }

  return {
    min: {
      x: bounds.min.x - offset.x,
      y: bounds.min.y - offset.y,
      z: bounds.min.z - offset.z,
    },
    max: {
      x: bounds.max.x + offset.x,
      y: bounds.max.y + offset.y,
      z: bounds.max.z + offset.z,
    },
  };
}

export function containsPoint(
  bounds: AABB,
  point: Vector3,
  inclusive = true,
): boolean {
  assertValidAABB(bounds);
  assertFiniteVector3(point, "point");

  if (inclusive) {
    return (
      point.x >= bounds.min.x && point.x <= bounds.max.x &&
      point.y >= bounds.min.y && point.y <= bounds.max.y &&
      point.z >= bounds.min.z && point.z <= bounds.max.z
    );
  }

  return (
    point.x > bounds.min.x && point.x < bounds.max.x &&
    point.y > bounds.min.y && point.y < bounds.max.y &&
    point.z > bounds.min.z && point.z < bounds.max.z
  );
}

export function intersectsAABB(a: AABB, b: AABB): boolean {
  assertValidAABB(a, "a");
  assertValidAABB(b, "b");

  return (
    a.min.x <= b.max.x && a.max.x >= b.min.x &&
    a.min.y <= b.max.y && a.max.y >= b.min.y &&
    a.min.z <= b.max.z && a.max.z >= b.min.z
  );
}
