# AeroMind Progress

Last updated: 2026-11-27

## Completed

- [x] Public repository initialized on main with reproducible `package-lock.json` and `npm ci` in CI/Docker.
- [x] Zero `npm audit` vulnerabilities (`@fastify/static`, `zod`, `vitest` upgraded).
- [x] PRD, system design, engineering plan, API contracts and safety/threat model.
- [x] Canonical shared scenario (`flood-block-a`) driving both Three.js rendering and collision verification (`ROOF-01` roof alignment, quadcopter arm geometry, 3.5 m expanded clearance envelope).
- [x] 3D navigation graph, mid-flight temporary start node attachment, environment-versioned cache invalidation, and deterministic A* search with admissible Euclidean heuristic.
- [x] Deterministic route verifier (expanded obstacle AABBs, inflated no-fly zones, altitude limits, waypoint bounds) and configurable energy + RTH reserve estimator (`>=` reserve policy).
- [x] `@google/genai` server-side planner adapter with structured JSON schema, optional 3D scene still multimodal input, bounded timeouts, secret redaction, and strict Zod + domain allowlist validation.
- [x] Authoritative mission state machine, single-use version-bound `RouteApproval` gate, deterministic local A* rerouting before bounded Gemini replanning (max 2 attempts), and server-side flight simulation.
- [x] Interactive React + Three.js mission console with chaos fault-injection controls (`crane-01`, `debris-north-01`, battery sag/critical, `ROOF-05` flare) and live monotonic SSE event timeline.
- [x] 47 automated unit, contract, and API/SSE integration tests across `@aeromind/shared` and `@aeromind/server`.

## Remaining external verification

- [ ] Add live `GEMINI_API_KEY` to `.env` (or Cloud Run Secret Manager) and run `npm run smoke:gemini --workspace @aeromind/server`.
- [ ] Confirm target GCP project/region and deploy container to Google Cloud Run.
