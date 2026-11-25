# ADR-002: Gemini selects from a bounded navigation graph

- Status: Accepted
- Date: 2026-11-25

## Context

A language model can generate plausible-looking coordinates that do not correspond to feasible positions in the scene. Arbitrary model-generated waypoint coordinates increase validation complexity and fragility.

## Decision

The model returns known target IDs and preferred navigation-node IDs. The deterministic navigation module resolves exact world-space waypoints using A* over the current graph.

## Consequences

Positive:
- Unknown IDs can be rejected cheaply.
- Deterministic route resolution is testable without Gemini.
- Model output is compact and constrained.
- Environment graph and geometry remain application-owned.

Negative:
- The MVP cannot discover arbitrary continuous-space routes outside the graph.
- Graph density and edge validity affect route quality.
- A small graph is a simulation abstraction, not a general drone planner.
