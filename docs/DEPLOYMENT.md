# Deployment — Google Cloud Run

Status: deployment design. A Dockerfile and production static-asset serving are not part of the first scaffold commit yet.

## 1. Target topology

One Cloud Run service serves Vite-built frontend assets, Fastify API, SSE endpoints and Gemini adapter. The Gemini key is injected as a server-side secret. Never compile it into the Vite bundle.

## 2. Runtime contract

- Bind to 0.0.0.0.
- Listen on PORT (default 8080 locally).
- Expose GET /api/health.
- Handle SIGTERM gracefully.
- Prefer stateless request handling.
- Treat in-memory mission state as ephemeral and single-demo only.

## 3. Local development

From repository root:

    cp .env.example .env
    npm install
    npm run dev

Vite is expected on port 5173 and proxies /api to port 8080.

## 4. Production image plan

The production image should install root workspace dependencies, build shared contracts, build web assets, build server TypeScript, then run Fastify while serving static assets from the same origin. Use a runtime image with required production dependencies.

Do not put the Gemini key in Docker build arguments or image layers. Inject it at runtime through Secret Manager-backed environment variables or an equivalent protected secret mechanism.

## 5. Cloud Run checklist

- Select project and region.
- Enable Cloud Run and Artifact Registry APIs.
- Create/select a least-privilege runtime service account.
- Store Gemini API key in Secret Manager.
- Build and deploy container.
- Configure GEMINI_MODEL to a tested model ID.
- Configure timeout for expected Gemini and SSE use.
- Restrict CORS to deployed origin.
- Enable unauthenticated access only if public judging requires it.
- Verify /api/health.
- Run an actual Gemini-backed mission from the public URL.
- Verify SSE connection/reconnect.
- Confirm logs do not reveal secrets.

## 6. CLI outline

Replace placeholders with actual values. This assumes a Dockerfile/build configuration exists.

    gcloud config set project PROJECT_ID
    gcloud services enable run.googleapis.com artifactregistry.googleapis.com
    gcloud run deploy aeromind --source . --region REGION --allow-unauthenticated --set-env-vars NODE_ENV=production,GEMINI_MODEL=MODEL_ID --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest

## 7. Operational limitations

Cloud Run instances may restart or scale to zero; in-memory mission state is not durable. Long-lived SSE connections consume instance capacity; configure concurrency and timeouts. Browser refresh must retrieve state rather than assume local UI state is authoritative. Production/research use requires durable storage, event persistence, idempotency, authentication and explicit session ownership.
