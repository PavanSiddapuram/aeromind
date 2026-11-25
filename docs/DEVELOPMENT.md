# Local Development

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- Git

A Gemini API key is not needed to start the current UI/API scaffold. It will be required when the Gemini planner is implemented.

## Setup

    git clone https://github.com/PavanSiddapuram/aeromind.git
    cd aeromind
    cp .env.example .env
    npm install
    npm run dev

The API runs on port 8080. The Vite client runs on port 5173 and proxies /api requests to the API.

Open http://localhost:5173. The UI should report API health. The API endpoint can also be checked directly at http://localhost:8080/api/health.

## Useful commands

    npm run dev
    npm run dev:api
    npm run dev:web
    npm run typecheck
    npm run build
    npm test

## Current implementation boundary

Implemented:
- npm workspace structure
- React/Vite application shell
- Fastify API startup
- GET /api/health
- production static asset serving when apps/web/dist exists
- shared initial domain types

Not yet implemented:
- Three.js scene and drone model
- scenario graph and A*
- geometry verifier
- energy estimator
- Gemini planner and real API integration
- mission orchestration, state machine and SSE mission events
- end-to-end tests and production release validation

Do not describe the current scaffold as a functioning autonomous planner until these items are implemented and tested.
