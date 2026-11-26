import type { Vector3 } from "../index.js";

const EPSILON = 1e-9;

export const vec3 = (x = 0, y = 0, z = 0): Vector3 => ({ x, y, z });

export function isFiniteVector3(value: Vector3): boolean {
  return Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

export function assertFiniteVector3(value: Vector3, name = "vector"): void {
  if (!isFiniteVector3(value)) {
    throw new TypeError(`${name} must contain finite x, y and z coordinates`);
  }
}

export function add(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function subtract(a: Vector3, b: Vector3): Vector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function multiplyScalar(value: Vector3, scalar: number): Vector3 {
  if (!Number.isFinite(scalar)) throw new TypeError("scalar must be finite");
  return { x: value.x * scalar, y: value.y * scalar, z: value.z * scalar };
}

export function divideScalar(value: Vector3, scalar: number): Vector3 {
  if (!Number.isFinite(scalar) || Math.abs(scalar) <= EPSILON) {
    throw new RangeError("scalar must be finite and non-zero");
  }
  return { x: value.x / scalar, y: value.y / scalar, z: value.z / scalar };
}

export function dot(a: Vector3, b: Vector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSquared(value: Vector3): number {
  return dot(value, value);
}

export function length(value: Vector3): number {
  return Math.sqrt(lengthSquared(value));
}

export function distance(a: Vector3, b: Vector3): number {
  return length(subtract(a, b));
}

export function normalize(value: Vector3): Vector3 {
  const magnitude = length(value);
  if (magnitude <= EPSILON) {
    throw new RangeError("Cannot normalize a zero-length vector");
  }
  return divideScalar(value, magnitude);
}

export function lerp(a: Vector3, b: Vector3, t: number): Vector3 {
  if (!Number.isFinite(t)) throw new TypeError("Interpolation factor must be finite");
  return add(a, multiplyScalar(subtract(b, a), t));
}

export function equals(
  a: Vector3,
  b: Vector3,
  tolerance = EPSILON,
): boolean {
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new RangeError("tolerance must be a finite, non-negative number");
  }
  return (
    Math.abs(a.x - b.x) <= tolerance &&
    Math.abs(a.y - b.y) <= tolerance &&
    Math.abs(a.z - b.z) <= tolerance
  );
}
