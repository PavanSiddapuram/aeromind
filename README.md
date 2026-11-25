# AeroMind

**A neuro-symbolic disaster-response simulation and validation platform.**

> Gemini proposes. Deterministic systems verify. The simulator executes only approved plans.

AeroMind explores how an AI mission planner can interpret an ambiguous urban search-and-rescue objective while a separate deterministic engine resolves routes and enforces explicit spatial and resource constraints.

> **Safety boundary:** This is a synthetic simulation and engineering prototype. It is not a certified flight controller and must not be connected to physical aircraft.

## Current repository status

The repository now contains a runnable React/Vite application shell, a Fastify API with a health endpoint, shared starter domain types, an npm workspace, a Dockerfile, and architecture/product/engineering documentation.

The current app shell is **not yet** the complete AeroMind mission simulator. Gemini planning, A*, collision verification, energy estimation, mission orchestration, SSE mission events and the Three.js scene are planned implementation work. See [Development](docs/DEVELOPMENT.md) for the precise boundary.

## Product hypothesis

A system that separates probabilistic mission interpretation from deterministic feasibility checks can make AI-planned actions more inspectable and recoverable in a controlled simulation.

## MVP scenario

A simulated drone receives a natural-language mission in a procedural urban flood environment. Gemini is intended to return a schema-constrained proposal referencing known targets and navigation nodes. The application will validate that proposal, resolve routes over a navigation graph, check obstacle, geofence, altitude and energy constraints, and authorize simulated movement only after verification.

When the environment changes, active route approval must be invalidated. The system should pause, re-check the remaining route, try deterministic local rerouting where possible, and request bounded Gemini mission revision only when objective/priority decisions need to change.

## Product principles

1. **AI proposes; deterministic code decides feasibility.**
2. Schema validity is not domain validity or safety approval.
3. No movement without a current verification approval.
4. Environment changes invalidate stale route approvals.
5. Fail closed: model/API/schema/verification errors never authorize execution.
6. Energy and environment assumptions must be explicit and must not be presented as real-world flight guarantees.
7. Expose structured plans, decision summaries, verifier findings and event history—not hidden chain-of-thought.

## Technology

- TypeScript
- React + Vite
- Three.js (planned scene implementation)
- Node.js + Fastify
- Google Gen AI SDK (planned runtime integration)
- Zod (planned runtime/domain validation)
- A* over a bounded 3D navigation graph (planned)
- Deterministic segment/AABB and geofence checks (planned)
- Server-Sent Events (planned mission event stream)
- Docker + Google Cloud Run

The Gemini model ID must be configured and smoke-tested against the account's available API capabilities. Keep all credentials server-side.

## Repository map

    aeromind/
    ├── apps/web/                 # React/Vite client shell
    ├── server/src/               # Fastify API shell
    ├── shared/src/               # Shared domain types
    ├── docs/
    │   ├── PRD.md
    │   ├── SYSTEM_DESIGN.md
    │   ├── ENGINEERING_PLAN.md
    │   ├── API_CONTRACTS.md
    │   ├── SAFETY_AND_THREAT_MODEL.md
    │   ├── TEST_PLAN.md
    │   ├── DEVELOPMENT.md
    │   ├── DEPLOYMENT.md
    │   └── decisions/
    ├── .github/workflows/ci.yml
    ├── Dockerfile
    ├── .env.example
    └── package.json

## Quick start

Requirements: Node.js 22 or newer and npm 10 or newer.

    git clone https://github.com/PavanSiddapuram/aeromind.git
    cd aeromind
    cp .env.example .env
    npm install
    npm run dev

Open the Vite URL printed in the terminal (normally http://localhost:5173). The UI checks the API health endpoint. The API runs on port 8080 and can be checked at http://localhost:8080/api/health.

No Gemini API key is needed for the current scaffold. A key will be required when the Gemini adapter is implemented. Never put it in a Vite-prefixed variable or commit it to Git.

## Commands

    npm run dev
    npm run dev:api
    npm run dev:web
    npm run typecheck
    npm run build
    npm test

## Documentation

- [Product Requirements Document](docs/PRD.md)
- [System Design](docs/SYSTEM_DESIGN.md)
- [Engineering Plan](docs/ENGINEERING_PLAN.md)
- [API and Domain Contracts](docs/API_CONTRACTS.md)
- [Safety Invariants and Threat Model](docs/SAFETY_AND_THREAT_MODEL.md)
- [Test Plan](docs/TEST_PLAN.md)
- [Local Development](docs/DEVELOPMENT.md)
- [Cloud Run Deployment](docs/DEPLOYMENT.md)
- [Architecture Decision Records](docs/decisions/)

## MVP scope

One drone, one bounded synthetic city-block scenario, a small navigation graph, a few rescue objectives, static and judge-injected obstacles, simplified energy estimation, and optional event-triggered camera stills.

Out of scope: real drone control, GPS integration, certified autonomy, continuous video perception, fluid dynamics, multi-drone coordination, medical diagnosis and operational emergency dispatch.

## License

No license has been selected. Until a license is added, normal copyright restrictions apply; do not assume this repository is open-source licensed.
