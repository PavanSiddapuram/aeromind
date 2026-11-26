import { describe, expect, it } from "vitest";
import type { AABB } from "../index.js";
import { expandAABB } from "./aabb.js";
import { intersectSegmentAABB } from "./segment-aabb.js";

const box: AABB = {
  min: { x: 1, y: 1, z: 1 },
  max: { x: 3, y: 3, z: 3 },
};

describe("segment/AABB intersection", () => {
  it("detects a segment passing through a box", () => {
    const result = intersectSegmentAABB(
      { x: 0, y: 2, z: 2 },
      { x: 4, y: 2, z: 2 },
      box,
    );
    expect(result.intersects).toBe(true);
    expect(result.tEnter).toBeCloseTo(0.25);
    expect(result.point).toEqual({ x: 1, y: 2, z: 2 });
  });

  it("rejects a segment outside the box", () => {
    const result = intersectSegmentAABB(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 4 },
      box,
    );
    expect(result.intersects).toBe(false);
  });

  it("treats boundary contact as collision", () => {
    const result = intersectSegmentAABB(
      { x: 0, y: 3, z: 2 },
      { x: 4, y: 3, z: 2 },
      box,
    );
    expect(result.intersects).toBe(true);
  });

  it("handles a zero-length segment inside the box", () => {
    expect(intersectSegmentAABB(
      { x: 2, y: 2, z: 2 },
      { x: 2, y: 2, z: 2 },
      box,
    ).intersects).toBe(true);
  });

  it("expands by a scalar clearance margin", () => {
    expect(expandAABB(box, 2)).toEqual({
      min: { x: -1, y: -1, z: -1 },
      max: { x: 5, y: 5, z: 5 },
    });
  });

  it("rejects negative clearance", () => {
    expect(() => expandAABB(box, -1)).toThrow(RangeError);
  });
});
