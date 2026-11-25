# Safety Invariants and Threat Model

## 1. Scope

AeroMind is a synthetic browser simulation. Its checks are engineering controls for the prototype, not certification, assurance or proof of safety for real aircraft. Never connect this MVP to physical flight-control interfaces.

## 2. Safety invariants

INV-01 — No unverified execution. The simulation executor accepts only a route with a valid approval record.

INV-02 — Approval is version-bound. An approval is bound to mission, route, environment version and verifier policy version. Any relevant mutation revokes it.

INV-03 — Fail closed. Gemini errors, malformed output, domain validation errors, navigation errors and verifier errors cannot create approval.

INV-04 — Hard constraints are not preferences. Collision, no-fly, altitude and modeled energy reserve constraints are hard gates. Gemini cannot override them.

INV-05 — Bounded model retries. At most two Gemini repair attempts are allowed per trigger.

INV-06 — The executor uses the verified path. Do not smooth or mutate a route after verification. If a new representation is created, verify that exact representation.

INV-07 — Dynamic changes pause and invalidate. A material event pauses execution, increments environment version, revokes old approval and causes the remaining route to be re-evaluated.

INV-08 — Backend is authoritative. Frontend checks are for presentation. Execution authorization is checked server-side.

## 3. Threats and mitigations

| Threat | Example | Mitigation |
|---|---|---|
| Prompt injection | Mission asks model to ignore constraints | Constraints are application-owned; verifier ignores model claims of safety |
| Hallucinated identifier | Model invents node/target ID | Schema and allowlist validation |
| Malformed JSON | Truncated/unexpected output | Strict parse and validation; no execution |
| Model/API outage | Gemini call times out | Safe hold; bounded timeout |
| Stale route | Judge adds obstacle after planning | Environment version and approval revocation |
| Client tampering | Browser submits approved=true | Server creates/checks approvals; never trust client flag |
| Race condition | Event arrives as route starts | Serialize transitions and recheck version at execution boundary |
| Resource exhaustion | Huge graph, image or body | Bound graph, payload, image bytes, rate and timeout |
| Secret leakage | Key in Vite bundle/log | Server-only secret; redact logs; never use VITE_ prefix |
| Geometry mismatch | Render transform differs from collision world | Canonical world-space model |
| Spline corner cutting | Smoothed curve clips obstacle | Verify actual sampled execution curve |
| Energy misuse | Estimate presented as real endurance | Label assumptions; prohibit physical-control claims |

## 4. Geometry assumptions

MVP obstacles use world-space axis-aligned boxes. Drone is approximated by conservative sphere/capsule clearance. Obstacle expansion uses drone radius plus configured clearance. Segment/AABB tests are deterministic for represented geometry. AABB over-approximation may reject some safe routes; this conservatism is acceptable for the prototype. It does not address all dynamic, articulated, uncertain or non-axis-aligned obstacles.

## 5. Energy assumptions

Energy coefficients are scenario-specific and deterministic. The model uses normalized battery percentage points; it is not calibrated to an aircraft, battery chemistry, motor, payload, wind field or temperature. Real deployment needs sensor-informed state estimation, uncertainty margins, independent autopilot failsafes and extensive validation.

## 6. Human factors

- Show why a route was rejected.
- Distinguish model decision summary from verifier facts.
- Use wording such as “passed configured simulation checks,” not an unqualified “safe.”
- Distinguish safe hold and aborted states from successful completion.
- Preserve an event trace with timestamps and environment versions.

## 7. Security

- Validate every client request.
- Limit request body and image size.
- Store provider secrets only server-side.
- Redact credentials from logs.
- Add rate limits before public exposure.
- Never evaluate model-generated JavaScript or accept arbitrary executable code from Gemini.
- Restrict CORS to known origins in deployment.
