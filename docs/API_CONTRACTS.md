# API and Domain Contracts

Status: proposed contract. Only GET /api/health is implemented in the initial scaffold.

## 1. Conventions

- JSON request/response bodies.
- Positions use world-space X/Y/Z with Y as altitude.
- Distances use metres in the synthetic scenario.
- Battery uses percentage points in the simplified MVP model.
- Every mission mutation carries a mission ID and expected environment version.
- Client-provided environment state is untrusted input and must be validated/bounded.
- Backend is authoritative for route approval.

## 2. Health

GET /api/health returns status, service, environment and timestamp.

## 3. Start mission

POST /api/mission/plan

Request:

    {
      "missionId": "mission-demo-001",
      "scenarioId": "flood-block-a",
      "instruction": "Survey the eastern block and prioritize rooftop targets.",
      "constraints": {
        "maxAltitudeMeters": 40,
        "minLandingReservePercent": 20
      },
      "expectedEnvironmentVersion": 1
    }

Response:

    {
      "missionId": "mission-demo-001",
      "status": "planning",
      "eventStream": "/api/mission/mission-demo-001/events"
    }

## 4. Mission plan proposal

The Gemini adapter should request an object matching this conceptual contract:

    type MissionPlan = {
      missionStatus: "planned" | "partial" | "aborted";
      targetOrder: string[];
      searchPattern:
        | "perimeter_scan"
        | "grid_scan"
        | "direct_inspection";
      preferredNodeSequence: string[];
      abortedObjectives: string[];
      decisionSummary: string;
    };

Do not accept arbitrary world coordinates from the model in the MVP. Resolve known target IDs and graph node IDs against the canonical scenario. Reject unknown IDs, unavailable targets and domain-invalid sequences.

## 5. Verification

POST /api/mission/verify accepts mission ID, route ID, environment version, drone state, waypoints and constraints.

Response contains:
- approved boolean
- typed violation list
- estimated mission energy percentage
- estimated return energy percentage
- projected landing reserve percentage

Violation codes:
- OBSTACLE_COLLISION
- NO_FLY_ZONE
- ALTITUDE_LIMIT
- ENERGY_INFEASIBLE
- INVALID_WAYPOINT

## 6. Environment events

POST /api/mission/event

Request:

    {
      "missionId": "mission-demo-001",
      "expectedEnvironmentVersion": 4,
      "event": {
        "type": "obstacle.spawned",
        "obstacleId": "crane-01"
      }
    }

The server applies the event atomically, increments environment version, pauses execution, revokes stale approvals and emits an event. If the expected version is stale, return a conflict instead of overwriting newer state.

MVP event types:
- obstacle.spawned
- battery.changed
- target.discovered
- wind.changed

## 7. Execute

POST /api/mission/execute accepts mission ID, route ID, approval ID and expected environment version.

The backend checks that the approval exists, matches mission/route/environment/policy version, is not revoked or consumed, and the mission state allows execution. Simulation-only.

## 8. SSE events

GET /api/mission/:missionId/events

Each event includes eventId, missionId, monotonic sequence, occurredAt, type, environmentVersion and payload.

Suggested types:
- mission.received
- planning.started
- plan.generated
- route.resolved
- verification.started
- verification.rejected
- verification.passed
- replanning.started
- execution.authorized
- simulation.started
- simulation.paused
- simulation.completed
- mission.safe_hold
- mission.failed

SSE disconnection does not cancel or authorize a mission. Provide a state snapshot endpoint for reconnect recovery.

## 9. Error envelope

    {
      "error": {
        "code": "STALE_ENVIRONMENT_VERSION",
        "message": "The environment changed after this route was verified.",
        "requestId": "req-123"
      }
    }

Use 400 for malformed requests, 404 for unknown resources, 409 for stale state/invalid transition, 422 for domain-invalid plans, 429 for rate limiting and 5xx for unexpected provider/server failures. Do not leak credentials in errors.
