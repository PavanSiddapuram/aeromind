# ADR-001: Use a modular monolith for the MVP

- Status: Accepted
- Date: 2026-11-25

## Context

The sprint prototype integrates browser UI, Gemini API, graph navigation, geometry verification, mission orchestration and Cloud Run deployment in a very short time.

## Decision

Use one Node.js/TypeScript service with explicit modules and one React client, packaged into one Cloud Run service.

## Consequences

Positive:
- One deployment unit and one public URL.
- No internal service networking.
- Shared TypeScript domain contracts.
- Faster debugging and integration.

Negative:
- Modules scale and deploy together.
- Server process must isolate concerns carefully.
- Future high-load or independently scaled components may require extraction.

Microservices are deferred until an independently deployable boundary is justified by evidence.
