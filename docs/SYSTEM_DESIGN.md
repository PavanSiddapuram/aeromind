# System Design

## 1. Goals

- Separate model-based mission interpretation from deterministic route feasibility.
- Make the system inspectable through structured plans and events.
- Ensure environment mutations invalidate stale approvals.
- Keep the MVP deployable as one Cloud Run service.

## 2. Architecture choice

Use a modular monolith: one Node.js/TypeScript service hosts API, orchestration, navigation, verification and static web assets. Domain modules have explicit interfaces and can later be extracted if evidence justifies it. Avoid microservices for the sprint because internal service networking and separate deploy pipelines add cost without proving the core hypothesis.

## 3. System context

    Operator
       |
       v
    React mission console <----> Three.js simulation
       |
       | REST commands / SSE events
       v
    Node.js API
       |
       v
    Mission orchestrator
       |             |                |
       v             v                v
    Gemini adapter  A* navigation   Deterministic verifier
       |                              |
       v                              v
    Gemini API                    Energy estimator
       |
       v
    Structured proposal

The orchestrator also owns the state machine, retry budget and event publication. The backend is authoritative for approval. The browser renders state and captures user input; it does not grant execution permission.

## 4. Module responsibilities

| Module | Owns | Does not own |
|---|---|---|
| Web UI | User input, scene rendering, event display | Safety approval |
| Scene model | Canonical environment snapshot and rendering mapping | Gemini decisions |
| Gemini adapter | Provider calls, response parsing, decision summary | Route approval |
| Plan validator | Schema and domain validation | Collision calculations |
| Navigation | Graph, edge eligibility, A* and waypoint resolution | Mission priority semantics |
| Geometry | Bounds, clearance, segment/volume intersection | Natural-language interpretation |
| Energy | Configured energy estimates and reserve checks | Physical battery guarantees |
| Verifier | Aggregated hard-constraint result | Model prompting |
| Orchestrator | Workflow sequencing, retry budget and event publication | Bypassing verifier |
| State machine | Legal transitions and execution gating | Rendering |
| Event stream | Ordered application events | Durable storage guarantee |

## 5. Data flow

1. Client submits mission request and scenario identifier.
2. Backend loads and validates canonical scenario snapshot.
3. Backend creates mission version and emits mission.received.
4. Gemini receives mission text, scalar mission telemetry/constraints (battery percentage, current altitude, wind speed, max altitude, minimum landing reserve, energy coefficients), and discrete catalogues of known target IDs and navigation-node IDs. Optional event/operator-triggered scene JPEG context is bounded on the server. Gemini never authors authoritative XYZ flight coordinates.
5. Gemini returns a schema-constrained proposal referencing known target and node IDs only.
6. Backend performs schema and domain validation; unknown IDs, invalid constraints or impossible target references are rejected.
7. Navigation resolves target sequence into graph paths and world-space waypoints.
8. Verifier checks the exact path to be executed: obstacle clearance, geofences, altitude and energy.
9. If rejected, attempt local deterministic reroute. If mission-level choices must change, send violations and updated state to Gemini with bounded retry count.
10. On approval, issue an approval record bound to mission ID, route ID, environment version and verifier policy version.
11. Simulation consumes the approved polyline. If smoothing is introduced, sample and re-verify the smoothed curve.
12. Any environment event pauses execution, increments environment version, invalidates outstanding approvals and triggers verification of the remaining path.

## 6. Approval model

A route approval is a version-bound record:

    type RouteApproval = {
      approvalId: string;
      missionId: string;
      routeId: string;
      environmentVersion: number;
      policyVersion: string;
      approvedAt: string;
      expiresAt?: string;
    };

Execution requires a matching mission, route, environment version and verifier policy version. The approval must not be revoked or consumed, and mission state must allow execution.

## 7. Navigation model

Use a bounded graph of named 3D nodes. Nodes are candidate flight positions. Edges are candidate connections and are pre-filtered or evaluated for clearance against the current environment. A* resolves the lowest-cost path among feasible edges.

Initial cost can be Euclidean edge length plus non-negative climb and configured risk costs. Hard violations are not soft penalties: blocked edges and forbidden volumes are excluded.

For a small graph, straightforward A* with an admissible Euclidean heuristic is sufficient. Recalculate affected edges after an obstacle event. Avoid building a general-purpose planner in the sprint.

## 8. Geometry model

- Coordinate convention: X east/west, Y altitude (up), Z north/south.
- World unit: synthetic metre.
- Drone reference point: vehicle centre.
- Obstacles: world-space AABBs in MVP.
- Safety envelope: expand obstacle bounds by drone radius plus configured clearance.
- Check each traversed line segment against each expanded AABB.
- Check no-fly volumes separately (or use equivalent conservative inflation).
- Check altitude for all route segments.
- Re-check the actual path representation used by the executor.

An expanded AABB is a conservative simplification for axis-aligned obstacles. Complex geometry, moving obstacles and dynamic vehicle orientation require stronger collision models.

## 9. Energy model

Use a transparent configurable model, not a physical battery simulator:

    E_total = E_travel + E_climb + E_wind + E_operation
    E_required = E_remaining_mission + E_return + E_reserve
    feasible = battery_available >= E_required

All terms use battery percentage points. Coefficients are scenario configuration and must be visible in documentation/UI. Recompute from current drone state after every material event. Never imply calibrated real aircraft performance.

## 10. Replanning and remaining-route policy

1. Validate incoming environment mutations atomically before changing state; invalid mutations return `400` without pausing execution, bumping `environmentVersion`, or revoking approvals.
2. Pause active simulation on material environment change (`EXECUTING -> PAUSED`).
3. Increment `environmentVersion` and invalidate cached graph eligibility.
4. Revoke approvals bound to prior environment versions.
5. Derive the exact stage-aware remaining trajectory (`deriveRemainingMissionRoute`):
   - `READY` before execution: full planned outbound path + full RTH path.
   - `EXECUTING`/`PAUSED` on outbound leg: live 3D drone position + unflown outbound waypoints + still-pending targets + RTH path (excluding already-visited targets and completed segments).
   - `EXECUTING`/`PAUSED` on return-to-home leg (or all targets visited): `0 m` outbound leg + live 3D drone position through remaining RTH waypoints to `N-BASE` (`0` target dwell).
6. Re-verify the derived remaining trajectory against the mutated environment.
7. Tier 1: Try deterministic local A* reroute to the same remaining pending targets (or pure RTH to `N-BASE` when `0` targets remain) with zero Gemini calls.
8. Tier 2: If pending targets remain and local routing is unreachable or energy-infeasible (or a new priority target was discovered), ask Gemini for a revised proposal with structured violation/unreachability details (maximum two repair attempts per trigger). Target abandonments (`abortedObjectives`) are committed only once a candidate route passes verification.
9. Fallback: If no route is approved within the retry budget (or RTH itself is blocked/infeasible), enter `SAFE_HOLD` with zero execution approval.

## 11. Failure handling

- Gemini timeout/API error: safe hold; no new approval.
- Malformed output: reject and optionally one format-correction request within retry budget.
- Unknown IDs: reject as domain-invalid.
- No graph route: report unreachable; consider mission-level replanning.
- Verifier error: fail closed.
- Stale approval: reject execution.
- SSE disconnect: client reconnects and fetches current state.
- Cloud Run restart: MVP in-memory state is lost; acceptable only for a single-instance demo with explicit reset semantics. Production requires durable storage and idempotency.

## 12. Deployment topology

One Cloud Run container serves Vite-built static assets, Fastify API and SSE endpoint, plus the Gemini adapter. No database is required for the sprint. If persistence becomes a requirement, evaluate Firestore or another managed store separately.

## 13. Observability

Log mission ID, event sequence, environment version, planner latency and outcome, route ID/distance, verifier policy version and violation codes, repair attempt count and state transitions. Do not log API keys, raw secrets or unnecessary personal data.
