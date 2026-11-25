# Engineering Plan

## 1. Delivery strategy

Build a single vertical slice, not disconnected demos. Prioritize independent verification, an end-to-end real Gemini request and public deployment. Visual polish is secondary.

## 2. Implementation milestones

### M0 — Repository/runtime foundation
- npm workspaces and strict TypeScript
- React/Vite client
- Fastify API and health endpoint
- shared domain contracts
- environment template and local scripts

Exit: web and API start locally; build and typecheck pass.

### M1 — Deterministic geometry
- Vector3 operations and units
- AABB validation and expansion
- segment/AABB intersection
- geofence intersection
- obstacle and clearance tests

Exit: independent tests demonstrate clear-path acceptance and constructed collision rejection.

### M2 — Navigation
- graph node and edge model
- edge clearance eligibility
- A* with Euclidean heuristic
- route reconstruction
- environment version and graph invalidation

Exit: route around a blocked edge or report unreachable.

### M3 — Energy feasibility
- scenario-configured coefficients
- travel, climb, wind and operation estimates
- remaining-route and return-home calculation
- reserve enforcement

Exit: feasible and infeasible deterministic fixtures pass.

### M4 — Gemini planner
- Google Gen AI SDK adapter
- model selection through configuration
- constrained output schema
- domain validation against target/node catalogue
- decision summary and bounded timeouts

Exit: real API call produces a plan used by route resolution; API errors fail closed.

### M5 — Mission orchestration
- explicit state machine
- local reroute before LLM replanning
- version-bound route approval
- max two Gemini repair attempts per trigger
- safe-hold path

Exit: complete plan → reject → repair → verify → execute path succeeds.

### M6 — 3D and judge experience
- low-poly city and water plane
- drone, base and target markers
- route and violation overlays
- telemetry and event timeline
- obstacle/battery chaos controls
- event-triggered POV image if time permits

Exit: judge understands system state without reading source.

### M7 — Cloud Run
- container build
- static asset serving
- health check
- server-side Gemini key
- public URL smoke test
- SSE test and timeout handling

Exit: deployed URL serves UI, API and a real Gemini-backed mission.

## 3. Sprint scope

P0 — must ship:
- One scenario, one drone, a small graph and a few targets.
- One real Gemini API call.
- Schema and domain validation.
- A* route resolution.
- Segment/AABB and geofence checks.
- Altitude and simplified energy/RTH checks.
- Execution authorization gate.
- One deterministic local repair or Gemini replanning path.
- Cloud Run deployment.

P1 — differentiators:
- Obstacle chaos injection.
- Battery event.
- New priority target.
- Event timeline and verifier overlay.
- Event-triggered drone POV still image.

P2 — cut first:
- Continuous vision loop.
- Complex mesh BVH.
- Multi-drone support.
- Sophisticated vehicle physics.
- Persistent mission database.
- Full wind-field simulation.
- Real hardware control.

## 4. Five-hour build plan

| Window | Goal | Cut line |
|---|---|---|
| 11:00–11:30 | Integrate existing scene and API baseline | No visual redesign |
| 11:30–12:15 | Real Gemini call and schema validation | Text mission first; vision later |
| 12:15–13:00 | Resolve graph route and draw path | Small fixed graph |
| 13:00–14:00 | Lunch | Preserve working build |
| 14:00–14:45 | Geometry, geofence, energy verification | AABB only |
| 14:45–15:30 | Failure/replan/approval orchestration | One repair scenario |
| 15:30–16:00 | Chaos controls and event timeline | Obstacle + battery only |
| 16:00–16:25 | End-to-end test | Fix P0 only |
| 16:25–17:00 | Cloud Run deploy, smoke test, submit URL | No feature work |

This schedule assumes the repository, local environment, Dockerfile and deployment permissions are prepared in advance. Confirm event timing with organizers because the supplied agenda contains conflicting sprint end times.

## 5. Risk-based work order

1. Cloud Run and credentials: prove the deployment path early.
2. Deterministic verifier: build and test without Gemini.
3. Gemini API: one real request, strict output parsing.
4. Orchestration: explicit state transitions and retry bounds.
5. 3D: visualization of already-correct state.
6. Chaos: invalidate and re-check the route.

## 6. Definition of done

A feature is done only when its acceptance test exists, its failure behavior is explicit, it cannot bypass the verifier, it is visible or inspectable in the demo, and its assumptions are documented.
