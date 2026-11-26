import { describe, expect, it } from "vitest";
import {
  add, cross, distance, dot, equals, length, lerp, normalize,
  subtract, vec3,
} from "./vector3.js";

describe("Vector3 operations", () => {
  it("adds and subtracts vectors without mutating inputs", () => {
    const a = vec3(1, 2, 3);
    const b = vec3(4, 5, 6);
    expect(add(a, b)).toEqual(vec3(5, 7, 9));
    expect(subtract(b, a)).toEqual(vec3(3, 3, 3));
    expect(a).toEqual(vec3(1, 2, 3));
  });

  it("computes dot and cross products", () => {
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32);
    expect(cross(vec3(1, 0, 0), vec3(0, 1, 0))).toEqual(vec3(0, 0, 1));
  });

  it("computes length, distance and normalized direction", () => {
    expect(length(vec3(3, 4, 0))).toBe(5);
    expect(distance(vec3(0, 0, 0), vec3(0, 3, 4))).toBe(5);
    expect(normalize(vec3(0, 3, 4))).toEqual(vec3(0, 0.6, 0.8));
  });

  it("rejects normalization of a zero vector", () => {
    expect(() => normalize(vec3())).toThrow(RangeError);
  });

  it("supports interpolation and tolerance comparison", () => {
    expect(lerp(vec3(0, 0, 0), vec3(10, 20, 30), 0.5)).toEqual(vec3(5, 10, 15));
    expect(equals(vec3(1, 1, 1), vec3(1.00001, 1, 1), 0.0001)).toBe(true);
  });
});
