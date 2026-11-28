# Local Development

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git
- A browser with WebGL enabled for the Three.js simulation viewport
- Optional: `GEMINI_API_KEY` in `.env` for live Gemini mission planning (deterministic automated tests run offline without credentials)

## Setup

```bash
git clone https://github.com/PavanSiddapuram/aeromind.git
cd aeromind
cp .env.example .env
# Edit .env to set GEMINI_API_KEY=<your-server-key> (keep GEMINI_MODEL=gemini-3.8-flash or another supported model)
npm ci
npm run dev
```

`npm run dev` compiles `@aeromind/shared` first and then runs three concurrent processes:
- `@aeromind/shared` TypeScript compiler in watch mode
- `@aeromind/server` Fastify API + SSE server on `http://localhost:8080`
- `@aeromind/web` Vite dev server on `http://localhost:5173` (proxying `/api` to `http://localhost:8080`)

Never place `GEMINI_API_KEY` in a `VITE_`-prefixed variable or commit `.env` to Git.

## Commands

```bash
npm ci                                             # Clean reproducible install from package-lock.json
npm run dev                                        # Start full local development stack
npm run typecheck                                  # Typecheck shared, server (including tests), and web
npm test                                           # Run deterministic unit, regression, API & E2E suites
npm run build                                      # Build shared, server, and Vite static bundle
npm run smoke:gemini --workspace @aeromind/server  # Run opt-in live Gemini smoke test (requires GEMINI_API_KEY)
```

## Verification boundaries

- **Offline deterministic (`npm test`)**: Exercises vector math, AABB/segment collisions, canonical scenario invariants, 3D A* and RTH routing, energy estimation, `verifyRoute`, Zod/allowlist plan validation, state machine transitions, `ApprovalGate`, all 10 remaining-route recovery stages, REST error/tampering handling, static serving, and SSE streaming using injected test planners.
- **Live Gemini (`npm run smoke:gemini --workspace @aeromind/server`)**: Exercises real `@google/genai` network authentication, structured JSON generation, allowlist validation, A* resolution, deterministic verification, and approval issuance.
- **Prototype boundary**: In-memory mission state resets when the server restarts. Geometry (expanded AABBs) and battery models (configurable percentage-point coefficients) are conservative simulation controls, not real-aircraft flight guarantees.
