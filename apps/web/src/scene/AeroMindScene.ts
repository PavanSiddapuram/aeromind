import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type BuildingSpec = {
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  color: number;
};

const BUILDINGS: BuildingSpec[] = [
  { x: -34, z: -28, width: 13, depth: 15, height: 24, color: 0x52677d },
  { x: -8, z: -34, width: 16, depth: 12, height: 34, color: 0x60758a },
  { x: 21, z: -34, width: 15, depth: 14, height: 19, color: 0x50677a },
  { x: 37, z: -5, width: 12, depth: 16, height: 29, color: 0x61768a },
  { x: 20, z: 26, width: 17, depth: 13, height: 25, color: 0x546b80 },
  { x: -10, z: 33, width: 15, depth: 14, height: 31, color: 0x64788b },
  { x: -38, z: 9, width: 12, depth: 18, height: 20, color: 0x53687d },
];

const RESCUE_TARGETS = [
  new THREE.Vector3(-25, 25, -28),
  new THREE.Vector3(20, 26, 26),
  new THREE.Vector3(-10, 32, 33),
];

function makeDrone(): { group: THREE.Group; rotors: THREE.Mesh[] } {
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

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.85, 2.2), bodyMaterial);
  body.castShadow = true;
  group.add(body);

  const cameraPod = new THREE.Mesh(
    new THREE.SphereGeometry(0.52, 16, 12),
    darkMaterial,
  );
  cameraPod.position.set(0, -0.28, -1.1);
  group.add(cameraPod);

  const lens = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 12, 10),
    accentMaterial,
  );
  lens.position.set(0, -0.27, -1.52);
  group.add(lens);

  const rotorPositions = [
    [-2.7, 0.35, -2.2],
    [2.7, 0.35, -2.2],
    [-2.7, 0.35, 2.2],
    [2.7, 0.35, 2.2],
  ] as const;

  const rotors: THREE.Mesh[] = [];
  for (const [x, y, z] of rotorPositions) {
    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 3.1, 8),
      darkMaterial,
    );
    arm.rotation.z = Math.PI / 2;
    arm.position.set(x * 0.52, 0, z * 0.52);
    group.add(arm);

    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 0.55, 10),
      darkMaterial,
    );
    mast.position.set(x, y, z);
    group.add(mast);

    const rotor = new THREE.Mesh(
      new THREE.BoxGeometry(2.25, 0.08, 0.24),
      accentMaterial,
    );
    rotor.position.set(x, y + 0.32, z);
    rotor.castShadow = true;
    group.add(rotor);
    rotors.push(rotor);
  }

  const tailLight = new THREE.PointLight(0x4be0cf, 0.8, 7);
  tailLight.position.set(0, 0.35, 1.35);
  group.add(tailLight);

  return { group, rotors };
}

function addBuilding(
  scene: THREE.Scene,
  spec: BuildingSpec,
  index: number,
): void {
  const geometry = new THREE.BoxGeometry(spec.width, spec.height, spec.depth);
  const material = new THREE.MeshStandardMaterial({
    color: spec.color,
    roughness: 0.78,
    metalness: 0.12,
  });
  const building = new THREE.Mesh(geometry, material);
  building.position.set(spec.x, spec.height / 2, spec.z);
  building.castShadow = true;
  building.receiveShadow = true;
  building.userData = { obstacleId: `BLDG-${String(index + 1).padStart(2, "0")}` };
  scene.add(building);

  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry),
    new THREE.LineBasicMaterial({ color: 0x8da3b8, transparent: true, opacity: 0.27 }),
  );
  edges.position.copy(building.position);
  scene.add(edges);

  // Simple rooftop accents make height and scale legible without external assets.
  const roofUnit = new THREE.Mesh(
    new THREE.BoxGeometry(spec.width * 0.27, 1.1, spec.depth * 0.24),
    new THREE.MeshStandardMaterial({ color: 0x26384c, roughness: 0.8 }),
  );
  roofUnit.position.set(spec.x + spec.width * 0.16, spec.height + 0.55, spec.z);
  roofUnit.castShadow = true;
  scene.add(roofUnit);
}

function addTarget(scene: THREE.Scene, position: THREE.Vector3, index: number): void {
  const beacon = new THREE.Group();
  beacon.position.copy(position);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.3, 0.16, 8, 32),
    new THREE.MeshStandardMaterial({
      color: 0xffc66d,
      emissive: 0x70400e,
      metalness: 0.3,
      roughness: 0.3,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  beacon.add(ring);

  const pin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.08, 4, 8),
    new THREE.MeshBasicMaterial({ color: 0xffc66d }),
  );
  pin.position.y = -2;
  beacon.add(pin);

  const label = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc66d }),
  );
  label.position.y = 2.6;
  beacon.add(label);
  beacon.userData = { targetId: `ROOF-${String(index + 1).padStart(2, "0")}` };
  scene.add(beacon);
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
  private readonly routeLine: THREE.Line;
  private disposed = false;

  constructor(private readonly container: HTMLDivElement) {
    this.scene.background = new THREE.Color(0x091522);
    this.scene.fog = new THREE.Fog(0x091522, 115, 230);

    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 500);
    this.camera.position.set(105, 88, 112);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.setClearColor(0x091522);
    this.renderer.domElement.className = "aeromind-canvas";
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Interactive three-dimensional simulated urban flood environment with buildings, rescue targets and a drone",
    );
    this.container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.target.set(0, 8, 0);
    this.controls.minDistance = 45;
    this.controls.maxDistance = 210;
    this.controls.maxPolarAngle = Math.PI * 0.48;

    this.addLighting();
    this.addGround();
    BUILDINGS.forEach((building, index) => addBuilding(this.scene, building, index));
    RESCUE_TARGETS.forEach((target, index) => addTarget(this.scene, target, index));

    const droneModel = makeDrone();
    this.drone = droneModel.group;
    this.rotors = droneModel.rotors;
    this.drone.position.set(-47, 17, 43);
    this.scene.add(this.drone);

    this.routeLine = this.addDemoRoute();
    this.addHomeBase();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
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

    // Flood-zone current lines are a visual layer only, not a fluid simulation.
    for (let index = 0; index < 7; index += 1) {
      const points: THREE.Vector3[] = [];
      const z = -55 + index * 17;
      for (let x = -86; x <= 86; x += 4) {
        points.push(new THREE.Vector3(x, -0.12, z + Math.sin(x * 0.055 + index) * 1.3));
      }
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0x3d9eae, transparent: true, opacity: 0.25 }),
      );
      this.scene.add(line);
    }
  }

  private addHomeBase(): void {
    const base = new THREE.Group();
    base.position.set(-47, 0, 43);

    const pad = new THREE.Mesh(
      new THREE.CylinderGeometry(6, 6, 0.5, 32),
      new THREE.MeshStandardMaterial({ color: 0x1f5260, metalness: 0.35, roughness: 0.5 }),
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

    this.scene.add(base);
  }

  private addDemoRoute(): THREE.Line {
    const points = [
      new THREE.Vector3(-47, 17, 43),
      new THREE.Vector3(-49, 22, 15),
      new THREE.Vector3(-25, 26, -8),
      new THREE.Vector3(3, 29, -18),
      new THREE.Vector3(28, 23, -7),
    ];
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(points),
      new THREE.LineDashedMaterial({
        color: 0x4be0cf,
        dashSize: 2.2,
        gapSize: 1.2,
        linewidth: 1,
      }),
    );
    line.computeLineDistances();
    this.scene.add(line);

    for (const point of points.slice(1)) {
      const waypoint = new THREE.Mesh(
        new THREE.SphereGeometry(0.75, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x4be0cf }),
      );
      waypoint.position.copy(point);
      this.scene.add(waypoint);
    }
    return line;
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

    this.drone.position.y = 17 + Math.sin(elapsed * 1.5) * 0.45;
    this.drone.rotation.y = Math.sin(elapsed * 0.35) * 0.035;
    for (const rotor of this.rotors) {
      rotor.rotation.y += delta * 26;
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
