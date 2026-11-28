# AeroMind

**A neuro-symbolic disaster-response simulation and validation platform.**

> Gemini proposes. Deterministic systems verify. The simulator executes only approved plans.

**Live Cloud Run Deployment:** https://aeromind-769443186508.asia-south1.run.app

AeroMind demonstrates how a probabilistic mission planner can interpret natural-language urban search-and-rescue objectives into discrete symbolic target priorities while deterministic software independently resolves 3D air corridors, verifies spatial and energy constraints, and gates simulated execution on version-bound approvals.

> **Safety boundary:** AeroMind is a synthetic browser/server simulation and engineering validation prototype. Its collision envelopes and battery formulas are conservative configurable approximations, not certified aircraft flight-control software. Never connect this software to physical aircraft.

## Implementation status

| Subsystem | Status | Verification coverage |
|---|---|---|
| Shared geometry (`Vector3`, `AABB`, conservative slab segment/AABB) | **Implemented** | Deterministic unit tests |
| Canonical flood scenario (`flood-block-a`) shared by Three.js & verifier | **Implemented** | Scenario invariant & clearance tests |
| 3D navigation graph, mid-flight start node, versioned cache & Euclidean A* | **Implemented** | Deterministic unit tests (including RTH-only routing) |
| Configurable travel/climb/wind/dwell + Return-to-Home reserve estimator | **Implemented** | Deterministic unit tests |
| Fail-closed route verifier (`3.5 m` obstacle expansion, `1.8 m` NFZ inflation, altitude, reserve) | **Implemented** | Deterministic unit tests |
| Gemini SDK adapter (`@google/genai`) + Zod schema & ID allowlist validator | **Implemented** | Deterministic contract tests + opt-in live `smoke:gemini` script |
| Mission state machine, single-use version-bound `ApprovalGate`, stage-aware `deriveRemainingMissionRoute`, two-tier recovery (local A* -> max 2 AI repairs -> `SAFE_HOLD`) | **Implemented** | Unit, 10-case remaining-route regression, API, and HTTP+SSE E2E tests |
| React + Three.js Mission Console, chaos controls & live SSE timeline | **Implemented** | Built static serving & API/SSE integration tests |
| Single-container Cloud Run packaging (`Dockerfile`) | **Deployed** | Live on Cloud Run (`asia-south1`), verified with HTTPS health, SSE & live Gemini smoke checks |

## Architectural principles

1. **Neuro-symbolic boundary:** Gemini receives the operator instruction, scalar mission telemetry/constraints (battery %, altitude m, wind m/s, energy coefficients), and canonical target/node catalogues, and returns symbolic IDs only. It never authors authoritative XYZ flight coordinates or safety approvals.
2. **Schema validity is not safety approval:** Every proposal passes strict JSON/Zod validation, target/node allowlist validation, 3D A* graph resolution, and independent segment/energy verification before an approval record can exist.
3. **Single-use, version-bound execution gate:** `RouteApproval` tokens bind `{ missionId, routeId, environmentVersion, policyVersion }`, are consumed on execution, and are revoked immediately whenever the environment mutates.
4. **Two-tier dynamic recovery:** Material environment changes (`obstacle.spawned`, `battery.changed`, `target.discovered`, `wind.changed`) atomically pause flight, increment `environmentVersion`, re-verify the exact remaining outbound/return trajectory via `deriveRemainingMissionRoute`, try deterministic local A* rerouting first (zero LLM calls), and invoke bounded Gemini replanning (max 2 attempts) only when mission-level objectives must change—falling back to `SAFE_HOLD` with zero approval if infeasible.
5. **Ephemeral demo state:** Mission sessions live in process memory for single-instance demonstration. Container restarts clear in-memory state.

## Repository map

    aeromind/
    ├── apps/web/                 # React 19 + Vite 6 console & Three.js simulation viewport
    ├── server/src/
    │   ├── app.ts                # Fastify REST & SSE routes, validation, secret-redacted errors
    │   ├── planner/              # @google/genai adapter, Zod + allowlist validator, smoke script
    │   └── orchestrator/         # State machine, ApprovalGate, deriveRemainingMissionRoute, sim loop
    ├── shared/src/
    │   ├── math/                 # Immutable Vector3 operations
    │   ├── geometry/             # AABB validation, expansion, slab segment/AABB intersection
    │   ├── scenario/             # Canonical flood-block-a buildings, NFZ-01, targets, graph, presets
    │   ├── navigation/           # Versioned 3D graph builder, mid-flight start node, Euclidean A*
    │   ├── energy/               # Travel, climb, wind, target dwell & landing reserve estimator
    │   └── verification/         # Independent fail-closed route & RTH verifier
    ├── docs/                     # PRD, system design, API contracts, safety model, test & deploy docs
    ├── .github/workflows/ci.yml  # Reproducible npm ci, typecheck, build, test pipeline
    └── Dockerfile                # Single-service Node 22 container serving API, SSE & built web UI

## Quick start

Requirements: Node.js 22+ and npm 10+.

```bash
git clone https://github.com/PavanSiddapuram/aeromind.git
cd aeromind
cp .env.example .env
# Add GEMINI_API_KEY=<your-server-key> to .env for live AI planning
npm ci
npm run dev
```

- **Web console (Vite HMR):** `http://localhost:5173` (proxies `/api` to port `8080`)
- **API health check:** `http://localhost:8080/api/health`
- Without `GEMINI_API_KEY`, the UI, 3D scene, and deterministic test suite run normally, while live `/api/mission/plan` requests fail closed into `SAFE_HOLD` (`503 MISSING_CREDENTIALS`). Never expose `GEMINI_API_KEY` with a `VITE_` prefix or commit `.env`.

## Commands

```bash
npm run dev                                        # Build shared, then run shared/api/web watchers
npm run typecheck                                  # Strict TypeScript check across all workspaces
npm test                                           # Deterministic unit, regression, API & E2E tests
npm run build                                      # Build shared, server, and Vite production bundle
npm run smoke:gemini --workspace @aeromind/server  # Opt-in live Gemini end-to-end smoke check
```

## Documentation

- [Product Requirements Document](docs/PRD.md)
- [System Design](docs/SYSTEM_DESIGN.md)
- [Engineering Plan](docs/ENGINEERING_PLAN.md)
- [API and Domain Contracts](docs/API_CONTRACTS.md)
- [Safety Invariants and Threat Model](docs/SAFETY_AND_THREAT_MODEL.md)
- [Test Plan](docs/TEST_PLAN.md)
- [Local Development](docs/DEVELOPMENT.md)
- [Cloud Run Deployment](docs/DEPLOYMENT.md)
- [Implementation Progress](PROGRESS.md)
- [Architecture Decision Records](docs/decisions/)

## Out of scope

Real aircraft control, autopilot/MAVLink/GPS hardware integration, certified collision avoidance, continuous video perception, physical fluid/aerodynamic simulation, multi-drone coordination, and multi-instance durable database persistence.

## License

No license has been selected. Until a license is added, normal copyright restrictions apply.
