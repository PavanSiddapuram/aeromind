# Product Requirements Document

- Product: AeroMind
- Version: 1.0 (MVP baseline)
- Status: Proposed
- Theme: Open Innovation / AI for India
- Scenario: Urban flood search and rescue
- Product class: Simulation and AI-agent validation prototype

## 1. Executive summary

AeroMind is a browser-based, neuro-symbolic disaster-response simulator. An operator describes a rescue mission in natural language. Gemini interprets intent and proposes a constrained mission plan. Deterministic software validates the plan, resolves collision-aware routes over a known navigation graph, estimates energy feasibility, and authorizes simulated movement only when all mandatory checks pass.

When the environment changes, stale route approvals are invalidated. The system attempts deterministic local rerouting and asks Gemini to reconsider mission-level priorities only when a local repair is insufficient.

AeroMind is a training/research prototype. It is not certified for physical aircraft control or operational emergency response.

## 2. Problem

Disaster-response missions combine ambiguous human priorities with hard spatial and resource constraints. Classical planners navigate known maps but do not inherently interpret human intent. Generative models interpret intent but cannot be trusted to produce geometrically valid coordinates or enforce hard safety constraints.

The product gap addressed by this prototype is the boundary between flexible mission interpretation and independently verifiable execution.

## 3. Product hypothesis

A system that separates probabilistic mission reasoning from deterministic feasibility checks can demonstrate more inspectable and recoverable agent behavior than a system that directly executes model-generated actions. This is a hypothesis to test in a controlled simulation, not a claim of proven real-world safety.

## 4. Users and jobs-to-be-done

Primary users:
- Robotics and autonomy developers testing mission planners.
- Researchers exploring AI-assisted disaster-response workflows.
- Technical evaluators examining agent reliability.

Jobs-to-be-done:
- Express a mission in ordinary language.
- Understand which targets and objectives the planner selected.
- See why a route was accepted or rejected.
- Introduce a controlled failure and observe recovery.
- Inspect a reproducible event history for the mission.

## 5. MVP journey

1. Load a predefined urban flood scenario.
2. Enter a mission instruction and hard constraints.
3. Submit instruction and bounded environment context to Gemini.
4. Validate the structured plan against runtime schemas and domain rules.
5. Resolve target/node sequence using deterministic graph search.
6. Verify each route segment and energy constraint.
7. Authorize execution only against the exact environment version that was verified.
8. Simulate movement along the verified route.
9. On a chaos event, pause, increment environment version, invalidate prior approval and re-check the remaining route.
10. Use deterministic local rerouting when possible; otherwise request bounded mission-level replanning.
11. If no valid plan is found, enter safe hold or a preconfigured safe fallback.

## 6. Functional requirements

| ID | Requirement | Priority |
|---|---|---|
| FR-01 | Render bounded 3D city, buildings, drone, base, targets and restricted zones | P0 |
| FR-02 | Accept natural-language mission and explicit constraints | P0 |
| FR-03 | Call Gemini server-side and receive schema-constrained output | P0 |
| FR-04 | Reject unknown target and graph-node identifiers | P0 |
| FR-05 | Resolve route using A* over a bounded graph | P0 |
| FR-06 | Verify obstacle clearance, geofence and altitude constraints | P0 |
| FR-07 | Estimate mission, return and reserve energy deterministically | P0 |
| FR-08 | Block movement unless a current approval exists | P0 |
| FR-09 | Invalidate approvals after environment changes | P0 |
| FR-10 | Attempt deterministic local rerouting | P0 |
| FR-11 | Request bounded Gemini replanning for mission-level changes | P0 |
| FR-12 | Expose event timeline and decision summary | P1 |
| FR-13 | Inject obstacle and battery events | P1 |
| FR-14 | Capture event-triggered drone POV still and submit to Gemini | P1 |
| FR-15 | Deploy public HTTPS service on Cloud Run | P0 |

## 7. Non-functional requirements

- TypeScript strict mode for application code.
- Provider keys remain server-side.
- Fail closed on model, schema, planner, verifier or state errors.
- Explicit coordinate convention and units.
- Deterministic geometry tests independent of Gemini.
- Bounded retries and bounded request payloads.
- No reliance on ephemeral container storage for mission durability.
- Browser reconnect must not change mission outcome.
- Logs must not expose secrets or unnecessary personal data.

## 8. MVP success criteria

- A real Gemini API request produces a plan used by the running application.
- The plan is validated before route resolution.
- A deterministic test route intersecting an expanded obstacle is rejected.
- No-fly-zone and altitude test cases are rejected.
- A route with insufficient modeled return reserve is rejected.
- A local route repair is demonstrated where an alternate graph path exists.
- An environment mutation invalidates the previous approval.
- A verified route is simulated.
- A failed replan cannot authorize movement.
- Public Cloud Run URL serves the app and API health endpoint.

The phrase “100% rejection” applies only to the finite, deliberately constructed test cases in this repository; it is not a proof over all possible geometries or real-world flight conditions.

## 9. Out of scope

- Physical aircraft commands or autopilot integration.
- GPS, telemetry, radio or sensor integration.
- Certified collision avoidance.
- Real-time continuous video inference.
- Fluid or weather simulation with physical fidelity.
- Multi-drone coordination.
- Medical diagnosis or victim identity inference.
- Integration with emergency-service dispatch systems.

## 10. Assumptions and constraints

- One drone, one bounded scenario, a small graph and a few targets.
- World units represent metres in a synthetic scenario.
- Buildings and static obstacles use conservative axis-aligned bounds in the MVP.
- Energy is a simplified percentage-point estimate calibrated for deterministic demonstrations.
- The short build window means visual polish must not displace safety-gate and deployment work.
