# Contributing

## Engineering principles

- Keep mission reasoning, route finding, verification and execution authorization separate.
- Never let Gemini create an execution approval.
- Never execute unverified or stale trajectories.
- Add deterministic tests for geometry, navigation, energy and state transitions.
- Keep shared domain types independent of React, Fastify and Gemini SDK imports.
- Validate external inputs at runtime.
- Use explicit units in names, such as maxAltitudeMeters.
- Keep secrets out of source, logs, browser bundles and screenshots.

## Workflow

1. Create a focused branch.
2. Make a small, coherent change.
3. Add or update tests and documentation.
4. Run npm run typecheck, npm run build and npm test where applicable.
5. Explain behavioral changes and assumptions in the PR.

## Commit style

Use concise conventional prefixes where useful: feat, fix, docs, test, chore and refactor.

## Scope

Do not add real aircraft integration or imply production flight safety without a separately reviewed safety case and appropriate hardware/software validation.
