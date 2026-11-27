import { describe, expect, it } from "vitest";
import type { AABB } from "../index.js";
import { assertValidAABB, expandAABB } from "./aabb.js";
import { intersectSegmentAABB } from "./segment-aabb.js";

const box: AABB = {
  min: { x: 1, y: 1, z: 1 },
  max: { x: 3, y: 3, z: 3 },
};

describe("segment/AABB intersection (GEO-01..GEO-08)", () => {
  it("GEO-01: rejects a segment far from the box", () => {
    const result = intersectSegmentAABB(
      { x: 0, y: 0, z: 0 },
      { x: 4, y: 0, z: 4 },
      box,
    );
    expect(result.intersects).toBe(false);
  });

  it("GEO-02: detects a segment passing through a box", () => {
    const result = intersectSegmentAABB(
      { x: 0, y: 2, z: 2 },
      { x: 4, y: 2, z: 2 },
      box,
    );
    expect(result.intersects).toBe(true);
    expect(result.tEnter).toBeCloseTo(0.25);
    expect(result.point).toEqual({ x: 1, y: 2, z: 2 });
  });

  it("GEO-03: treats boundary face contact as collision", () => {
    const result = intersectSegmentAABB(
      { x: 0, y: 3, z: 2 },
      { x: 4, y: 3, z: 2 },
      box,
    );
    expect(result.intersects).toBe(true);
  });

  it("GEO-04: treats touching an expanded AABB edge as collision", () => {
    const expanded = expandAABB(box, 1.5);
    // expanded max.y = 4.5, max.z = 4.5 -> grazing that exact top-front edge
    const result = intersectSegmentAABB(
      { x: 0, y: 4.5, z: 4.5 },
      { x: 4, y: 4.5, z: 4.5 },
      expanded,
    );
    expect(result.intersects).toBe(true);
  });

  it("GEO-05: rejects a zero-length segment outside the box", () => {
    expect(
      intersectSegmentAABB(
        { x: 10, y: 10, z: 10 },
        { x: 10, y: 10, z: 10 },
        box,
      ).intersects,
    ).toBe(false);
  });

  it("GEO-06: detects a zero-length segment inside the box", () => {
    expect(
      intersectSegmentAABB(
        { x: 2, y: 2, z: 2 },
        { x: 2, y: 2, z: 2 },
        box,
      ).intersects,
    ).toBe(true);
  });

  it("GEO-07: rejects invalid min/max bounds", () => {
    expect(() =>
      assertValidAABB({
        min: { x: 5, y: 0, z: 0 },
        max: { x: 2, y: 4, z: 4 },
      }),
    ).toThrow(RangeError);
  });

  it("GEO-08: expands by drone radius + clearance and rejects negative margins", () => {
    expect(expandAABB(box, 2)).toEqual({
      min: { x: -1, y: -1, z: -1 },
      max: { x: 5, y: 5, z: 5 },
    });
    expect(() => expandAABB(box, -1)).toThrow(RangeError);
  });
});
