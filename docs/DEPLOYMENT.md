# Deployment — Google Cloud Run

Status: Dockerfile and single-container build path are present. The first application release still requires local build validation and a real Cloud Run smoke test.

## 1. Target topology

One Cloud Run service serves Vite-built frontend assets, Fastify API and (as implemented) the health endpoint. Future mission APIs, SSE and Gemini adapter will live in the same process for the MVP. The Gemini key must be injected as a server-side secret and must never enter the Vite bundle.

## 2. Runtime contract

- Bind to 0.0.0.0.
- Listen on PORT (default 8080 locally).
- Expose GET /api/health.
- Handle SIGTERM gracefully.
- Prefer stateless request handling.
- Treat in-memory mission state as ephemeral and demo-only.

## 3. Local development

Requirements: Node.js 22+ and npm 10+.

    cp .env.example .env
    npm install
    npm run dev

Vite runs on port 5173 and proxies /api to Fastify on port 8080. In production, Fastify serves the built web assets from apps/web/dist.

## 4. Container

The Dockerfile uses Node 22 Alpine, installs the npm workspace, builds shared/server/web packages, and starts the Fastify workspace. The image currently includes build dependencies for a simpler MVP build. A later hardening pass can use a multi-stage production-only runtime image.

Build and run locally:

    docker build -t aeromind:local .
    docker run --rm -p 8080:8080 aeromind:local

The API health endpoint should respond at http://localhost:8080/api/health.

## 5. Cloud Run checklist

- Select project and region.
- Enable Cloud Run and Artifact Registry APIs.
- Create/select a least-privilege runtime service account.
- Store Gemini API key in Secret Manager once Gemini integration exists.
- Build and deploy the container.
- Configure GEMINI_MODEL to a tested model ID.
- Configure timeout for expected Gemini and SSE use.
- Restrict CORS to known origins (same-origin serving should not require permissive CORS).
- Enable unauthenticated access only if public judging requires it.
- Verify /api/health.
- Run a real Gemini-backed mission from the public URL after that feature is implemented.
- Verify SSE connection/reconnect after the event-stream endpoint exists.
- Confirm logs do not reveal secrets.

## 6. CLI outline

Replace placeholders with actual values:

    gcloud config set project PROJECT_ID
    gcloud services enable run.googleapis.com artifactregistry.googleapis.com
    gcloud run deploy aeromind --source . --region REGION --allow-unauthenticated --set-env-vars NODE_ENV=production,GEMINI_MODEL=MODEL_ID --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest

The command assumes the required secret exists. Do not configure a placeholder/empty API key as if Gemini integration were operational.

## 7. Operational limitations

Cloud Run instances may restart or scale to zero; in-memory mission state is not durable. Long-lived SSE connections consume instance capacity; configure concurrency and timeouts. Browser refresh must retrieve state rather than assume local UI state is authoritative. Production/research use requires durable storage, event persistence, idempotency, authentication and explicit session ownership.
