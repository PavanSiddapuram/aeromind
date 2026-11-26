# Local Development

## Requirements
- Node.js 22 or newer
- npm 10 or newer
- Git
- A browser with WebGL enabled for the Three.js scene

A Gemini API key is not needed to run the current local scaffold. It will be required when the Gemini planner is integrated.

## Setup

    git clone https://github.com/PavanSiddapuram/aeromind.git
    cd aeromind
    cp .env.example .env
    npm install
    npm run dev

The API runs on port 8080. The Vite client runs on port 5173 and proxies /api requests to the API.

Open http://localhost:5173. You should see the AeroMind shell and procedural Three.js flood-zone preview. Drag to orbit and scroll to zoom. The API endpoint can also be checked directly at http://localhost:8080/api/health.

## Useful commands

    npm run dev
    npm run dev:api
    npm run dev:web
    npm run typecheck
    npm run build
    npm test

After the first install, commit the generated package-lock.json so local and CI dependency resolution are repeatable.

## Implemented

- npm workspaces and strict TypeScript configuration
- React/Vite application shell
- Fastify API startup and GET /api/health
- Production static asset serving when apps/web/dist exists
- Shared domain types
- Vector3 operations: add, subtract, scalar multiply/divide, dot, cross, length, distance, normalization, interpolation and approximate equality
- Validated AABB representation, expansion, point containment and AABB overlap
- Slab-based segment/AABB intersection (face/edge/corner contact is conservatively treated as collision)
- Unit tests for vector math, AABB expansion and segment intersection
- Procedural Three.js scene preview: synthetic flooded ground plane, seven building volumes, rooftop markers, home pad, quadcopter visual, animated rotors, dashed illustrative route, lighting and orbit controls

## Explicit limitations

The scene route and telemetry are visual fixtures. They are not produced by A*, Gemini or the verifier. The drone does not follow a mission or respond to a physical model. Buildings in the scene are not yet sourced from a canonical collision-world scenario.

Not yet implemented:
- Canonical scenario model shared between renderer and verifier
- Navigation graph and A*
- Route-level collision/geofence/altitude verification
- Energy estimator
- Gemini planner and real API integration
- Mission orchestrator, state machine and version-bound execution gate
- SSE mission events
- Judge chaos panel
- End-to-end tests and Cloud Run release validation

Do not describe the current preview as an autonomous drone or a functioning rescue planner.
