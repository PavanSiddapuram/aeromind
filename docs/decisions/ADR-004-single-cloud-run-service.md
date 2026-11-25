# ADR-004: Deploy one web and API service to Cloud Run

- Status: Accepted for MVP
- Date: 2026-11-25

## Context

The event requires a publicly reachable Cloud Run URL. The MVP needs a browser application, API and streamed application events. Separate services would increase deployment and CORS complexity.

## Decision

Build the web workspace and serve its static output from the Fastify process. Package both in one container and deploy one Cloud Run service.

## Consequences

Positive:
- One public URL and same-origin API.
- No separate frontend hosting configuration.
- Simpler sprint deployment and credential boundary.

Negative:
- Frontend and backend are released together.
- Long-lived SSE connections require timeout/concurrency testing.
- In-memory mission state is not durable across instance restarts.
- Production use would need durable state and stronger operational controls.
