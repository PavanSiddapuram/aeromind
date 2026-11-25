# ADR-003: Fail closed and bind approvals to environment versions

- Status: Accepted
- Date: 2026-11-25

## Context

A route can become invalid when an obstacle, geofence, battery state or other mission-relevant condition changes. A UI boolean is not sufficient authorization, and an old verification must not survive a changed environment.

## Decision

Only the backend verifier can issue an approval record. Each approval is bound to mission ID, route ID, environment version and verifier policy version. A relevant mutation pauses simulation, increments environment version and revokes prior approvals. Any error or missing approval blocks execution.

## Consequences

Positive:
- Stale route approvals can be detected.
- Execution permission has explicit provenance.
- Failure paths are safer and easier to test.

Negative:
- All environment mutations must be serialized/versioned.
- More state management is required.
- This software control is not a substitute for independent real-world flight safety systems.
