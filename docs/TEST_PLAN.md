# Test Plan

## 1. Strategy

Test deterministic logic independently from Gemini. Use unit tests for geometry, graph search and energy calculations; contract tests for model output; integration tests for orchestration; and a manual end-to-end Cloud Run demonstration.

## 2. Geometry tests

| ID | Setup | Expected |
|---|---|---|
| GEO-01 | Segment far from AABB | No intersection |
| GEO-02 | Segment passes through AABB | Intersection |
| GEO-03 | Segment touches AABB face | Treat as collision (conservative boundary rule) |
| GEO-04 | Segment touches expanded AABB edge | Treat as collision |
| GEO-05 | Zero-length segment outside box | No intersection |
| GEO-06 | Zero-length segment inside box | Intersection |
| GEO-07 | Invalid min/max bounds | Reject input |
| GEO-08 | Drone radius + clearance expansion | Expanded extents match |
| GEO-09 | Segment enters no-fly volume | Reject route |
| GEO-10 | Waypoint above max altitude | Reject route |

Boundary semantics must be documented and consistent. Prefer conservative collision treatment for touching boundaries.

## 3. Navigation tests

- Direct edge available: choose direct route.
- Direct edge blocked, alternate path exists: choose alternate route.
- All paths blocked: report unreachable.
- Unknown start or goal ID: reject.
- Disconnected graph: terminate without infinite loop.
- Equal-cost alternatives: deterministic tie-breaking.
- Non-negative costs only.
- Heuristic admissibility: Euclidean distance for distance-based costs; if costs are modified, ensure heuristic remains a lower bound.

## 4. Energy tests

- Mission + return + reserve exactly equals available battery: feasible only if policy allows equality.
- Required energy exceeds battery: infeasible.
- Battery event reduces feasibility: previous approval invalidated.
- Negative or NaN coefficients: reject configuration.
- Return path unavailable: no return-feasible approval.
- Wind/climb changes recompute cost from current state.

## 5. Mission/orchestration tests

- Valid Gemini proposal proceeds to navigation.
- Unknown node/target is rejected.
- Malformed model output fails closed.
- Collision causes approval rejection.
- Local reroute succeeds without unnecessary Gemini call.
- No local route triggers mission-level planner.
- Two failed repair attempts end in safe hold.
- Environment version change revokes prior approval.
- Stale approval cannot start execution.
- Verifier exception cannot produce approval.
- SSE disconnect does not change mission state.

## 6. API tests

- Health endpoint returns 200.
- Invalid request returns 400.
- Unknown mission returns 404.
- Stale environment version returns 409.
- Domain-invalid plan returns 422.
- Gemini timeout produces safe failure.
- SSE emits monotonic sequence.
- No API key appears in response or logs.

## 7. Manual demo scenario

1. Start the urban-flood fixture.
2. Submit a natural-language mission.
3. Confirm a real Gemini API call and structured plan.
4. Resolve a route on the graph.
5. Trigger an obstacle that blocks the preferred route.
6. Confirm verifier rejection and visible collision marker.
7. Confirm local A* reroute or Gemini mission revision.
8. Confirm second verification.
9. Inject battery reduction.
10. Confirm lower-priority objective is abandoned or system enters safe hold.
11. Confirm no stale route executes.
12. Refresh/reconnect and confirm state recovery within MVP state lifetime.

## 8. Test quality

- Never mock the verifier in execution-gate tests.
- Use fixed scenario fixtures and deterministic seeds.
- Keep live Gemini tests opt-in to avoid flaky CI and API charges.
- Provider fixtures are not proof of a live Gemini call.
- Record model name and schema version for integration test runs.
