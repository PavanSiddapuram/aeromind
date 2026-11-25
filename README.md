# AeroMind

**A neuro-symbolic disaster-response simulation and validation platform.**

> Gemini proposes. Deterministic systems verify. The simulator executes only approved plans.

AeroMind explores how an AI mission planner can interpret an ambiguous urban search-and-rescue objective while a separate deterministic engine resolves routes and enforces explicit spatial and resource constraints.

**This repository contains a simulation and engineering prototype. It is not a certified flight controller and must not be connected to real aircraft.**

## Project status

Early foundation / MVP scaffold. The repository currently defines the product, architecture, contracts, safety invariants, development plan, and deployment approach. Implementations are intentionally staged; documentation does not imply that unimplemented capabilities already work.

## MVP scenario

A simulated drone receives a natural-language mission in a procedural, low-poly urban flood environment. Gemini returns a schema-constrained mission proposal referencing known targets and navigation nodes. The application validates that proposal, resolves routes over a navigation graph, checks the resulting route against obstacle, geofence, altitude, and energy constraints, and only then authorizes simulated movement.

When the environment changes, the active route approval is invalidated. The system pauses, re-verifies the remaining route, tries deterministic local rerouting where possible, and requests a bounded Gemini mission revision only when the objective/priority decision needs to change.

## Product principles

1. **AI proposes; deterministic code decides feasibility.**
2. **Schema validity is not domain validity or safety approval.**
3. **No movement without a current verification approval.**
4. **Environment changes invalidate stale route approvals.**
5. **Fail closed:** model/API/schema/verification failures never authorize execution.
6. **Simulation claims must be explicit:** the energy model and environment are simplified assumptions, not real-world flight guarantees.
7. **Inspectable behavior:** expose structured plans, decision summaries, verifier findings, state transitions, and event history—not hidden chain-of-thought.

## Planned technology

- TypeScript throughout
- React + Vite for the browser UI
- Three.js for the 3D simulation
- Node.js + Fastify for the API
- Google Gen AI SDK for real Gemini API calls
- Zod for runtime/domain validation
- A* over a bounded 3D navigation graph
- Deterministic segment/AABB and geofence checks
- Server-Sent Events (SSE) for application events
- Docker + Google Cloud Run for deployment

The exact Gemini model and API surface will be selected after a real integration smoke test against the account's available model capabilities. Keep credentials server-side.

## Repository map

```text
aeromind/
├── apps/
│   └── web/                  # React + Three.js client (planned)
├── server/
│   └── src/
│       ├── agent/             # Gemini adapter and planner (planned)
│       ├── api/               # HTTP/SSE routes (planned)
│       ├── energy/            # Deterministic energy estimates (planned)
│       ├── geometry/          # Spatial verification (planned)
│       ├── mission/           # Orchestration and execution gate (planned)
│       └── navigation/        # Graph and A* (planned)
├── shared/                    # Shared types and schemas (planned)
├── docs/
│   ├── PRD.md
│   ├── SYSTEM_DESIGN.md
│   ├── ENGINEERING_PLAN.md
│   ├── SAFETY_AND_THREAT_MODEL.md
│   ├── API_CONTRACTS.md
│   ├── TEST_PLAN.md
│   ├── DEPLOYMENT.md
│   └── decisions/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Quick start

The scaffold is documentation-first. Runtime commands become available as implementation lands.

Prerequisites planned for the MVP:
- Node.js 22 LTS
- npm
- A Google AI Studio / Gemini API key for backend integration
- Google Cloud CLI for Cloud Run deployment

```bash
git clone https://github.com/PavanSiddapuram/aeromind.git
cd aeromind
```

Copy `.env.example` to `.env` when the server integration is implemented. Never commit real keys.

## Documentation

- [Product Requirements Document](docs/PRD.md)
- [System Design](docs/SYSTEM_DESIGN.md)
- [Engineering Plan](docs/ENGINEERING_PLAN.md)
- [API Contracts](docs/API_CONTRACTS.md)
- [Safety and Threat Model](docs/SAFETY_AND_THREAT_MODEL.md)
- [Test Plan](docs/TEST_PLAN.md)
- [Cloud Run Deployment](docs/DEPLOYMENT.md)
- [Architecture Decision Records](docs/decisions/)

## Scope boundaries

The MVP simulates:
- One drone
- One bounded city-block scenario
- A small, explicit navigation graph
- A few rescue objectives
- Static and judge-injected obstacles
- Simplified energy consumption and return-to-base calculation
- Event-triggered still-image observations (optional MVP enhancement)

Out of scope: real drone control, GPS integration, certified autonomy, real-time video perception, fluid dynamics, multi-drone coordination, medical diagnosis, and operational emergency dispatch.

## License

No license has been selected yet. Until one is added, normal copyright restrictions apply; do not assume this repository is open-source licensed.
