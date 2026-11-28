# Three.js Scene

`AeroMindScene.ts` renders the interactive 3D urban flood viewport directly from the shared canonical scenario (`FLOOD_SCENARIO` in `@aeromind/shared`) and live server `MissionSnapshot` state.

## Coordinate convention

- **X**: east/west (metres)
- **Y**: altitude / up (metres)
- **Z**: north/south (metres)

Building meshes, dynamic chaos obstacles (`crane-01`, `debris-north-01`), restricted airspace (`NFZ-01`), helipad (`BASE-HOME`), graph corridor dots, and rescue target beacons (`ROOF-01`..`ROOF-05`) are generated from the exact same world-space bounds used by the deterministic A* navigator and route verifier.

## Visual layers

- **Quadcopter (`AM-01`)**: Scaled within its `1.8 m` physical radius (`+ 1.7 m` safety clearance = `3.5 m` obstacle expansion) with arms oriented directly to each rotor mast and live server pose/heading sync.
- **Routes**: Dashed teal preview route (idle), solid green approved outbound route, bright cyan executing route, dashed blue Return-to-Home (RTH) leg (including RTH-only recovery paths), and dashed red rejected routes.
- **Violation markers**: Red octahedron + torus halo at the first segment/volume contact point and red segment highlight on the violating outbound or RTH leg.
- **Multimodal capture**: `captureStillDataUrl()` exports a bounded JPEG frame when the operator opts into attaching a 3D scene still to a mission planning request.
