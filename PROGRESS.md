# AeroMind Progress

Last updated: 2026-11-28

## Implemented and deterministically tested

- [x] Reproducible `package-lock.json`, `npm ci` in GitHub Actions and `Dockerfile`, and `0` `npm audit` vulnerabilities.
- [x] Canonical shared scenario (`flood-block-a`) driving both Three.js rendering and server collision checks (`1.8 m` drone radius + `1.7 m` clearance = `3.5 m` obstacle expansion; `1.8 m` `NFZ-01` inflation; verified rooftop target placement).
- [x] Constrained 3D navigation graph, temporary mid-flight start node (`__TEMP_DRONE_START__`), parameter- and version-keyed cache invalidation, deterministic Euclidean A*, and pure Return-to-Home (`targetOrder: []`) resolution.
- [x] Configurable energy & RTH landing-reserve estimator (`travel + climb + wind + inspection dwell`) with `>=` reserve boundary enforcement.
- [x] Independent fail-closed `verifyRoute` checking outbound and RTH polylines for finite bounds, max altitude, expanded obstacle AABBs, inflated no-fly zones, valid RTH chain, and reserve feasibility.
- [x] Server-side `@google/genai` planner adapter (`GeminiMissionPlanner`) with structured JSON response schema, bounded timeout, optional multimodal 3D scene JPEG input, and `AIza*`/`AQ.*`/env secret redaction.
- [x] Runtime `MissionPlanSchema` (Zod) and scenario allowlist validator rejecting malformed JSON, duplicate IDs, non-pending targets, target/abort overlaps, and unknown target/node IDs.
- [x] Explicit mission state machine, single-use version-bound `ApprovalGate`, serialized per-mission mutex, atomic pre-validation of environment mutations, and deferred commitment of `abortedObjectives` until route verification passes.
- [x] Stage-aware `deriveRemainingMissionRoute` covering `READY` pre-flight, `EXECUTING` outbound, `EXECUTING` RTH, and `PAUSED` mid-segment/waypoint recovery without repeating completed legs or double-charging visited targets.
- [x] Two-tier dynamic recovery: Tier 1 deterministic local A* reroute (zero LLM calls) attempted before Tier 2 bounded Gemini mission replanning (max 2 attempts), with fail-closed `SAFE_HOLD` fallback.
- [x] Interactive React + Three.js Mission Console with live telemetry, outbound/RTH/violation overlays, chaos triggers, rejected-path inspector, mission reset, and monotonic SSE event stream.

## Live provider & deployment verification status

- **Live Gemini API (`smoke:gemini`)**: Verified locally end-to-end against `gemini-3.8-flash` using server-side `.env` credentials (automated `npm test` uses deterministic injected planners and never requires network/API keys).
- **Cloud Run deployment**: Deployed and verified live on Google Cloud Run (`asia-south1`, project `aeromind-gemini-sprint`) at https://aeromind-769443186508.asia-south1.run.app with Google Cloud Secret Manager (`GEMINI_API_KEY`), least-privilege `aeromind-runner` service account, static UI serving (`GET /`), `/api/health`, live Gemini mission planning, and SSE streaming.

## Known prototype limitations (by design)

- Mission state is held in-memory per Node.js process (`MissionOrchestrator`) and does not persist across container restarts or horizontal scaling.
- Obstacles and geofences use conservative axis-aligned bounding boxes (AABBs); energy uses synthetic configurable percentage-point coefficients rather than calibrated aircraft physics.
