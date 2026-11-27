import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  FLOOD_SCENARIO,
  getBoxDimensions,
  resolvePreviewWaypoints,
  type NoFlyZone,
  type RescueTarget,
  type RouteViolation,
  type ScenarioDefinition,
  type ScenarioObstacle,
  type Vector3 as DomainVec3,
} from "@aeromind/shared";

export type RouteVisualMode = "preview" | "approved" | "executing" | "rejected";

function toThreeVec3(v: DomainVec3): THREE.Vector3 {
  return new THREE.Vector3(v.x, v.y, v.z);
}

/**
 * Builds a quadcopter mesh whose outermost rotor tips fit within `radiusMeters`
 * (default 1.8 m) and whose arms connect the central body directly to each rotor mast.
 */
function makeDrone(radiusMeters: number): {
  group: THREE.Group;
  rotors: THREE.Mesh[];
} {
  const scale = radiusMeters / 1.8;
  const group = new THREE.Group();

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0xd9e7f1,
    metalness: 0.55,
    roughness: 0.34,
  });
  const darkMaterial = new THREE.MeshStandardMaterial({
    color: 0x172536,
    metalness: 0.7,
    roughness: 0.3,
  });
  const accentMaterial = new THREE.MeshStandardMaterial({
    color: 0x4be0cf,
    emissive: 0x0c4b47,
    metalness: 0.35,
    roughness: 0.25,
  });

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.15 * scale, 0.38 * scale, 0.88 * scale),
    bodyMaterial,
  );
  body.castShadow = true;
  group.add(body);

  const cameraPod = new THREE.Mesh(
    new THREE.SphereGeometry(0.24 * scale, 16, 12),
    darkMaterial,
  );
  cameraPod.position.set(0, -0.16 * scale, -0.44 * scale);
  group.add(cameraPod);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.1 * scale, 12, 10),
    accentMaterial,
  );
  lens.position.set(0, -0.16 * scale, -0.64 * scale);
  group.add(lens);

  // Mast positions at radial distance ~1.26 m; plus 0.48 m blade radius = 1.74 m <= 1.8 m.
  const rotorPositions = [
    [-0.95 * scale, 0.14 * scale, -0.82 * scale],
    [0.95 * scale, 0.14 * scale, -0.82 * scale],
    [-0.95 * scale, 0.14 * scale, 0.82 * scale],
    [0.95 * scale, 0.14 * scale, 0.82 * scale],
  ] as const;

  const upAxis = new THREE.Vector3(0, 1, 0);
  const armOrigin = new THREE.Vector3(0, 0.04 * scale, 0);
  const rotors: THREE.Mesh[] = [];

  for (const [rx, ry, rz] of rotorPositions) {
    const mastBase = new THREE.Vector3(rx, ry - 0.08 * scale, rz);
    const armVector = new THREE.Vector3().subVectors(mastBase, armOrigin);
    const armLength = armVector.length();

    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055 * scale, 0.065 * scale, armLength, 8),
      darkMaterial,
    );
    arm.position.copy(armOrigin).addScaledVector(armVector, 0.5);
    arm.quaternion.setFromUnitVectors(upAxis, armVector.clone().normalize());
    group.add(arm);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065 * scale, 0.065 * scale, 0.28 * scale, 10),
      darkMaterial,
    );
    mast.position.set(rx, ry, rz);
    group.add(mast);

    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(0.96 * scale, 0.04 * scale, 0.12 * scale),
      accentMaterial,
    );
    rotor.position.set(rx, ry + 0.16 * scale, rz);
    rotor.castShadow = true;
    group.add(rotor);
    rotors.push(rotor);
  }

  const beaconRing = new THREE.Mesh(
    new THREE.TorusGeometry(radiusMeters, 0.035, 8, 36),
    new THREE.MeshBasicMaterial({
      color: 0x4be0cf,
      transparent: true,
      opacity: 0.28,
    }),
  );
  beaconRing.rotation.x = Math.PI / 2;
  group.add(beaconRing);

  const tailLight = new THREE.PointLight(0x4be0cf, 0.9, 9);
  tailLight.position.set(0, 0.28 * scale, 0.55 * scale);
  group.add(tailLight);

  return { group, rotors };
}

function disposeGroupChildren(group: THREE.Group): void {
  while (group.children.length > 0) {
    const child = group.children[0];
    if (!child) break;
    group.remove(child);
    child.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => m.dispose());
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    });
  }
}

export class AeroMindScene {
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly controls: OrbitControls;
  private readonly drone: THREE.Group;
  private readonly rotors: THREE.Mesh[];
  private readonly clock = new THREE.Clock();
  private readonly animationFrame: { id: number | null } = { id: null };
  private readonly resizeObserver: ResizeObserver;

  private readonly environmentGroup = new THREE.Group();
  private readonly routeGroup = new THREE.Group();
  private readonly violationGroup = new THREE.Group();

  private droneAnchor: DomainVec3;
  private droneHeadingRad = 0;
  private hoverBobEnabled = true;
  private disposed = false;

  constructor(
    private readonly container: HTMLDivElement,
    initialScenario: ScenarioDefinition = FLOOD_SCENARIO,
  ) {
    this.droneAnchor = { ...initialScenario.initialDrone.position };

    this.scene.background = new THREE.Color(0x091522);
    this.scene.fog = new THREE.Fog(0x091522, 125, 250);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    this.camera.position.set(104, 86, 114);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x091522);
    this.renderer.domElement.className = "aeromind-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three-dimensional simulated urban flood environment with buildings, restricted zones, rescue targets and a drone",
    );
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 10, 0);
    this.controls.minDistance = 38;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.48;

    this.addLighting();
    this.addGround();

    this.scene.add(this.environmentGroup);
    this.scene.add(this.routeGroup);
    this.scene.add(this.violationGroup);

    const droneModel = makeDrone(initialScenario.initialDrone.radiusMeters);
    this.drone = droneModel.group;
    this.rotors = droneModel.rotors;
    this.drone.position.set(
      this.droneAnchor.x,
      this.droneAnchor.y,
      this.droneAnchor.z,
    );
    this.scene.add(this.drone);

    this.setScenario(initialScenario);
    this.setRoute(resolvePreviewWaypoints(initialScenario), "preview");

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
  }

  setScenario(
    scenario: ScenarioDefinition,
    targetsOverride?: RescueTarget[],
    obstaclesOverride?: ScenarioObstacle[],
  ): void {
    disposeGroupChildren(this.environmentGroup);

    const obstacles = obstaclesOverride ?? scenario.obstacles;
    const targets = targetsOverride ?? scenario.targets;

    for (const obstacle of obstacles) {
      this.addObstacleMesh(obstacle);
    }
    for (const zone of scenario.noFlyZones) {
      this.addNoFlyZoneMesh(zone);
    }
    for (const target of targets) {
      this.addTargetBeacon(target);
    }
    this.addHomeBase(scenario.homeBase.groundPosition);
    this.addGraphNodes(scenario);
  }

  setRoute(
    waypoints: DomainVec3[],
    mode: RouteVisualMode = "approved",
    returnWaypoints?: DomainVec3[],
  ): void {
    disposeGroupChildren(this.routeGroup);
    if (waypoints.length < 2) return;

    const palette: Record<RouteVisualMode, number> = {
      preview: 0x4be0cf,
      approved: 0x5cdda9,
      executing: 0x62f5d6,
      rejected: 0xf07167,
    };
    const routeColor = palette[mode];
    const points = waypoints.map(toThreeVec3);

    const material =
      mode === "preview" || mode === "rejected"
        ? new THREE.LineDashedMaterial({
            color: routeColor,
            dashSize: 2.2,
            gapSize: 1.2,
          })
        : new THREE.LineBasicMaterial({ color: routeColor });

    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      material,
    );
    if (material instanceof THREE.LineDashedMaterial) {
      line.computeLineDistances();
    }
    this.routeGroup.add(line);

    for (const point of points.slice(1)) {
      const wp = new THREE.Mesh(
        new THREE.SphereGeometry(0.68, 12, 10),
        new THREE.MeshBasicMaterial({ color: routeColor }),
      );
      wp.position.copy(point);
      this.routeGroup.add(wp);
    }

    if (returnWaypoints && returnWaypoints.length >= 2) {
      const rthPoints = returnWaypoints.map(toThreeVec3);
      const rthLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(rthPoints),
        new THREE.LineDashedMaterial({
          color: 0x7aa8e8,
          dashSize: 1.6,
          gapSize: 1.4,
          transparent: true,
          opacity: 0.72,
        }),
      );
      rthLine.computeLineDistances();
      this.routeGroup.add(rthLine);
    }
  }

  setViolations(violations: RouteViolation[], waypoints?: DomainVec3[]): void {
    disposeGroupChildren(this.violationGroup);

    for (const violation of violations) {
      if (violation.point) {
        const marker = new THREE.Mesh(
          new THREE.OctahedronGeometry(1.75, 0),
          new THREE.MeshStandardMaterial({
            color: 0xff5a52,
            emissive: 0x8a1c17,
            roughness: 0.25,
          }),
        );
        marker.position.set(
          violation.point.x,
          violation.point.y,
          violation.point.z,
        );
        this.violationGroup.add(marker);

        const halo = new THREE.Mesh(
          new THREE.TorusGeometry(2.8, 0.14, 8, 28),
          new THREE.MeshBasicMaterial({ color: 0xff6b63 }),
        );
        halo.position.copy(marker.position);
        halo.rotation.x = Math.PI / 2;
        this.violationGroup.add(halo);
      }

      if (
        waypoints &&
        violation.segmentIndex !== undefined &&
        violation.segmentIndex >= 0 &&
        violation.segmentIndex < waypoints.length - 1
      ) {
        const a = waypoints[violation.segmentIndex];
        const b = waypoints[violation.segmentIndex + 1];
        if (a && b) {
          const seg = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              toThreeVec3(a),
              toThreeVec3(b),
            ]),
            new THREE.LineBasicMaterial({ color: 0xff4d4d }),
          );
          this.violationGroup.add(seg);
        }
      }
    }
  }

  setDronePose(
    position: DomainVec3,
    headingRad?: number,
    isMoving = false,
  ): void {
    this.droneAnchor = { ...position };
    if (headingRad !== undefined && Number.isFinite(headingRad)) {
      this.droneHeadingRad = headingRad;
    }
    this.hoverBobEnabled = !isMoving;
    this.drone.position.set(position.x, position.y, position.z);
    this.drone.rotation.y = this.droneHeadingRad;
  }

  captureStillDataUrl(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL("image/jpeg", 0.78);
  }

  private addObstacleMesh(obstacle: ScenarioObstacle): void {
    const { center, width, height, depth } = getBoxDimensions(obstacle.bounds);

    if (obstacle.kind === "dynamic_hazard") {
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const core = new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: obstacle.colorHex,
          emissive: 0x5c1912,
          roughness: 0.45,
          metalness: 0.25,
          transparent: true,
          opacity: 0.82,
        }),
      );
      core.position.set(center.x, center.y, center.z);
      core.castShadow = true;
      core.userData = { obstacleId: obstacle.id };
      this.environmentGroup.add(core);

      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({ color: 0xffb38a }),
      );
      wire.position.copy(core.position);
      this.environmentGroup.add(wire);
      return;
    }

    // Keep decorative rooftop HVAC unit strictly inside obstacle.bounds.max.y
    const roofTrimHeight = Math.min(1.0, height * 0.08);
    const mainHeight = height - roofTrimHeight;
    const geometry = new THREE.BoxGeometry(width, mainHeight, depth);
    const material = new THREE.MeshStandardMaterial({
      color: obstacle.colorHex,
      roughness: 0.78,
      metalness: 0.12,
    });
    const building = new THREE.Mesh(geometry, material);
    building.position.set(center.x, obstacle.bounds.min.y + mainHeight / 2, center.z);
    building.castShadow = true;
    building.receiveShadow = true;
    building.userData = { obstacleId: obstacle.id };
    this.environmentGroup.add(building);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0x8da3b8,
        transparent: true,
        opacity: 0.27,
      }),
    );
    edges.position.copy(building.position);
    this.environmentGroup.add(edges);

    const roofUnit = new THREE.Mesh(
      new THREE.BoxGeometry(width * 0.26, roofTrimHeight, depth * 0.24),
      new THREE.MeshStandardMaterial({ color: 0x26384c, roughness: 0.8 }),
    );
    roofUnit.position.set(
      center.x + width * 0.16,
      obstacle.bounds.max.y - roofTrimHeight / 2,
      center.z,
    );
    roofUnit.castShadow = true;
    this.environmentGroup.add(roofUnit);
  }

  private addNoFlyZoneMesh(zone: NoFlyZone): void {
    const { center, width, height, depth } = getBoxDimensions(zone.bounds);
    const geometry = new THREE.BoxGeometry(width, height, depth);
    const volume = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0xd94848,
        transparent: true,
        opacity: 0.11,
        depthWrite: false,
      }),
    );
    volume.position.set(center.x, center.y, center.z);
    volume.userData = { noFlyZoneId: zone.id };
    this.environmentGroup.add(volume);

    const border = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry),
      new THREE.LineBasicMaterial({
        color: 0xf26b6b,
        transparent: true,
        opacity: 0.55,
      }),
    );
    border.position.copy(volume.position);
    this.environmentGroup.add(border);
  }

  private addTargetBeacon(target: RescueTarget): void {
    const beacon = new THREE.Group();
    beacon.position.set(target.position.x, target.position.y, target.position.z);

    const color =
      target.status === "visited"
        ? 0x5cdda9
        : target.status === "abandoned"
          ? 0x7d8ea3
          : 0xffc66d;
    const emissive =
      target.status === "visited"
        ? 0x114d36
        : target.status === "abandoned"
          ? 0x1e2836
          : 0x70400e;

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.16, 8, 32),
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        metalness: 0.3,
        roughness: 0.3,
      }),
    );
    ring.rotation.x = Math.PI / 2;
    beacon.add(ring);

    const stemLength = Math.max(
      2,
      target.position.y - target.rooftopElevationMeters,
    );
    const pin = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, stemLength, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.65,
      }),
    );
    pin.position.y = -stemLength / 2;
    beacon.add(pin);

    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 12, 10),
      new THREE.MeshBasicMaterial({ color }),
    );
    orb.position.y = 1.6;
    beacon.add(orb);

    beacon.userData = { targetId: target.id };
    this.environmentGroup.add(beacon);
  }

  private addGraphNodes(scenario: ScenarioDefinition): void {
    for (const node of scenario.nodes) {
      if (node.kind !== "corridor") continue;
      const dot = new THREE.Mesh(
        new THREE.SphereGeometry(0.36, 8, 8),
        new THREE.MeshBasicMaterial({
          color: 0x6ea8c9,
          transparent: true,
          opacity: 0.42,
        }),
      );
      dot.position.set(node.position.x, node.position.y, node.position.z);
      this.environmentGroup.add(dot);
    }
  }

  private addLighting(): void {
    this.scene.add(new THREE.HemisphereLight(0xb9d7ec, 0x152436, 1.45));

    const sun = new THREE.DirectionalLight(0xd5e9ff, 2.25);
    sun.position.set(-45, 105, 55);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x3b9fba, 0.6);
    fill.position.set(65, 35, -65);
    this.scene.add(fill);
  }

  private addGround(): void {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(190, 190),
      new THREE.MeshStandardMaterial({
        color: 0x123b4b,
        roughness: 0.28,
        metalness: 0.25,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.35;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(180, 36, 0x3b8392, 0x255363);
    grid.position.y = -0.25;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.24;
    this.scene.add(grid);

    for (let index = 0; index < 7; index += 1) {
      const points: THREE.Vector3[] = [];
      const z = -55 + index * 17;
      for (let x = -86; x <= 86; x += 4) {
        points.push(
          new THREE.Vector3(
            x,
            -0.12,
            z + Math.sin(x * 0.055 + index) * 1.3,
          ),
        );
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({
          color: 0x3d9eae,
          transparent: true,
          opacity: 0.25,
        }),
      );
      this.scene.add(line);
    }
  }

  private addHomeBase(groundPosition: DomainVec3): void {
    const base = new THREE.Group();
    base.position.set(groundPosition.x, groundPosition.y, groundPosition.z);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.5, 32),
      new THREE.MeshStandardMaterial({
        color: 0x1f5260,
        metalness: 0.35,
        roughness: 0.5,
      }),
    );
    pad.position.y = 0.1;
    pad.receiveShadow = true;
    base.add(pad);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(5, 0.18, 8, 40),
      new THREE.MeshBasicMaterial({ color: 0x4be0cf }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.45;
    base.add(ring);

    this.environmentGroup.add(base);
  }

  private resize(): void {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  private animate = (): void => {
    if (this.disposed) return;

    const delta = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;

    if (this.hoverBobEnabled) {
      this.drone.position.set(
        this.droneAnchor.x,
        this.droneAnchor.y + Math.sin(elapsed * 1.6) * 0.32,
        this.droneAnchor.z,
      );
      this.drone.rotation.y =
        this.droneHeadingRad + Math.sin(elapsed * 0.35) * 0.03;
    }

    for (const rotor of this.rotors) {
      rotor.rotation.y += delta * 28;
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame.id = window.requestAnimationFrame(this.animate);
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    if (this.animationFrame.id !== null) {
      window.cancelAnimationFrame(this.animationFrame.id);
    }
    this.resizeObserver.disconnect();
    this.controls.dispose();

    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();

      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((material) => material.dispose());
      } else if (mesh.material) {
        mesh.material.dispose();
      }
    });

    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
