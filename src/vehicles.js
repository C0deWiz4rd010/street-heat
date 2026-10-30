import * as THREE from "three";

export function createMaterial(color, options = {}) {
    return new THREE.MeshStandardMaterial({
        color,
        roughness: options.roughness ?? 0.38,
        metalness: options.metalness ?? 0.25,
        emissive: options.emissive ?? "#000000",
        emissiveIntensity: options.emissiveIntensity ?? 0,
        transparent: options.transparent ?? false,
        opacity: options.opacity ?? 1,
    });
}

export function addBox(group, size, position, material, cast = true, receive = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size.x, size.y, size.z), material);
    mesh.position.set(position.x, position.y, position.z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    group.add(mesh);
    return mesh;
}

const geometryCache = new Map();

function cached(key, build) {
    let entry = geometryCache.get(key);
    if (!entry) {
        entry = build();
        entry.userData.shared = true;
        geometryCache.set(key, entry);
    }
    return entry;
}

/** Extrudes a side profile (x = along the car, y = up) across the car's width. */
function extrudeProfile(points, width, bevel = 0.05) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(0.05, width - bevel * 2),
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 1,
        curveSegments: 1,
    });
    geometry.rotateY(-Math.PI / 2);
    geometry.translate(width / 2 - bevel, 0, 0);
    return geometry;
}

const ROOF_SHAPES = {
    coupe: { from: -0.3, to: 0.12, height: 0.42, rake: 0.1 },
    muscle: { from: -0.32, to: 0.08, height: 0.4, rake: 0.08 },
    sport: { from: -0.22, to: 0.12, height: 0.3, rake: 0.14 },
    van: { from: -0.44, to: 0.3, height: 0.66, rake: 0.03 },
};

function bodyGeometry(model) {
    return cached(`body:${model.roof}:${model.length}:${model.width}:${model.height}`, () => {
        const L = model.length;
        const h = model.height;
        const van = model.roof === "van";
        return extrudeProfile(
            [
                [-L / 2, -h / 2],
                [L / 2, -h / 2],
                [L / 2, -h / 2 + h * 0.5],
                [L * (van ? 0.42 : 0.3), h / 2],
                [-L * (van ? 0.46 : 0.4), h / 2],
                [-L / 2, h / 2 - h * 0.18],
            ],
            model.width
        );
    });
}

function cabinGeometry(model) {
    const roof = ROOF_SHAPES[model.roof] ?? ROOF_SHAPES.coupe;
    return cached(`cabin:${model.roof}:${model.length}:${model.width}:${model.height}`, () => {
        const L = model.length;
        const base = model.height / 2;
        const rake = roof.rake * L;
        return extrudeProfile(
            [
                [roof.from * L, base],
                [roof.to * L, base],
                [roof.to * L - rake, base + roof.height],
                [roof.from * L + rake * 0.8, base + roof.height],
            ],
            model.width * 0.88,
            0.03
        );
    });
}

let rimMaterial = null;

function wheelParts() {
    if (!rimMaterial) {
        rimMaterial = createMaterial("#c9d2dc", { roughness: 0.22, metalness: 0.85 });
        rimMaterial.userData.shared = true;
    }
    return {
        tire: cached("wheel:tire", () => new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14).rotateZ(Math.PI / 2)),
        rim: cached("wheel:rim", () => new THREE.CylinderGeometry(0.27, 0.27, 0.36, 8).rotateZ(Math.PI / 2)),
        rimMat: rimMaterial,
    };
}

export function createCar(model, sharedMaterials, options = {}) {
    const group = new THREE.Group();
    const chassis = new THREE.Group();
    group.add(chassis);
    const bodyMat = createMaterial(options.bodyColor ?? model.color, { roughness: 0.24, metalness: 0.36 });
    const trimMat = createMaterial(options.trimColor ?? model.trim, { roughness: 0.32, metalness: 0.42 });
    const glassMat = sharedMaterials.glass;
    const accentMat = createMaterial(options.police ? "#f5f7fb" : "#f7f1de", { roughness: 0.18, metalness: 0.45 });
    const headlightMat = createMaterial("#fff6a8", { emissive: "#ffe56b", emissiveIntensity: 0.8 });
    const tailMat = createMaterial("#ff394b", { emissive: "#ff394b", emissiveIntensity: 0.65 });
    const bumperMat = sharedMaterials.dark ?? trimMat;
    const L = model.length;
    const W = model.width;
    const H = model.height;

    const body = new THREE.Mesh(bodyGeometry(model), bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    chassis.add(body);

    const cabin = new THREE.Mesh(cabinGeometry(model), glassMat);
    cabin.castShadow = true;
    chassis.add(cabin);

    const roofShape = ROOF_SHAPES[model.roof] ?? ROOF_SHAPES.coupe;
    const roofLength = (roofShape.to - roofShape.from) * L - roofShape.rake * L * 1.9;
    addBox(
        chassis,
        { x: W * 0.84, y: 0.07, z: Math.max(0.4, roofLength) },
        { x: 0, y: H / 2 + roofShape.height + 0.02, z: ((roofShape.from + roofShape.to) / 2) * L - roofShape.rake * L * 0.1 },
        trimMat
    );

    addBox(chassis, { x: W * 1.02, y: 0.16, z: 0.22 }, { x: 0, y: -H / 2 + 0.12, z: L / 2 }, bumperMat);
    addBox(chassis, { x: W * 1.02, y: 0.16, z: 0.22 }, { x: 0, y: -H / 2 + 0.12, z: -L / 2 }, bumperMat);
    for (const side of [-1, 1]) {
        addBox(chassis, { x: 0.14, y: 0.1, z: 0.18 }, { x: side * (W * 0.5 + 0.08), y: H / 2 + 0.14, z: roofShape.to * L - 0.1 }, bodyMat, true, false);
        addBox(chassis, { x: W * 0.26, y: 0.13, z: 0.1 }, { x: side * W * 0.3, y: 0.02, z: L / 2 + 0.06 }, headlightMat, false, false);
        addBox(chassis, { x: W * 0.26, y: 0.13, z: 0.1 }, { x: side * W * 0.3, y: 0.06, z: -L / 2 - 0.05 }, tailMat, false, false);
    }

    if (model.roof === "sport") {
        addBox(chassis, { x: W * 0.94, y: 0.06, z: 0.38 }, { x: 0, y: H / 2 + 0.32, z: -L * 0.46 }, trimMat);
        for (const side of [-1, 1]) addBox(chassis, { x: 0.06, y: 0.28, z: 0.3 }, { x: side * W * 0.38, y: H / 2 + 0.16, z: -L * 0.46 }, trimMat);
    } else if (model.roof === "muscle") {
        addBox(chassis, { x: W * 0.36, y: 0.1, z: L * 0.22 }, { x: 0, y: H / 2 + 0.05, z: L * 0.2 }, accentMat);
    }

    // Wheels: pivot (steering) > spin (rolling) > tire + rim
    const { tire, rim, rimMat } = wheelParts();
    const wheels = [];
    const wheelX = W * 0.55;
    const wheelZ = L * 0.32;
    for (const [sx, sz, front] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
        const pivot = new THREE.Group();
        pivot.position.set(sx * wheelX, -0.22, sz * wheelZ);
        const spin = new THREE.Group();
        pivot.add(spin);
        spin.add(new THREE.Mesh(tire, sharedMaterials.tire));
        const rimMesh = new THREE.Mesh(rim, rimMat);
        rimMesh.position.x = sx * 0.01;
        spin.add(rimMesh);
        group.add(pivot);
        wheels.push({ pivot, spin, front });
    }

    const parts = { chassis, wheels, tailMat, headlightMat, wheelRadius: 0.42, tune: null, tuneKey: null, siren: null, spot: null };

    if (options.police) {
        const barY = H / 2 + roofShape.height + 0.12;
        addBox(chassis, { x: W * 0.75, y: 0.12, z: 0.46 }, { x: 0, y: barY, z: 0 }, accentMat, false, false);
        const blue = createMaterial("#326dff", { emissive: "#326dff", emissiveIntensity: 0.9 });
        const red = createMaterial("#ff344c", { emissive: "#ff344c", emissiveIntensity: 0.9 });
        addBox(chassis, { x: W * 0.35, y: 0.13, z: 0.4 }, { x: -W * 0.18, y: barY + 0.08, z: 0 }, blue, false, false);
        addBox(chassis, { x: W * 0.35, y: 0.13, z: 0.4 }, { x: W * 0.18, y: barY + 0.08, z: 0 }, red, false, false);
        parts.siren = { red, blue, offset: Math.random() * 2 };
    }

    if (options.taxi) {
        addBox(chassis, { x: W * 0.44, y: 0.18, z: 0.5 }, { x: 0, y: H / 2 + roofShape.height + 0.12, z: 0.05 }, createMaterial("#f7f1de", { emissive: "#ffc64d", emissiveIntensity: 0.35 }), false, false);
    }

    if (options.headlightSpot) {
        const spot = new THREE.SpotLight("#fff1c4", 0, 42, 0.5, 0.6, 1.2);
        spot.position.set(0, 0.3, L / 2);
        spot.target.position.set(0, -1.2, L / 2 + 14);
        chassis.add(spot);
        chassis.add(spot.target);
        parts.spot = spot;
    }

    group.userData.model = model;
    group.userData.parts = parts;
    group.userData.vis = { steer: 0, roll: 0, pitch: 0, prevSpeed: 0, accel: 0 };
    return group;
}

/** Adds or removes visible upgrade parts on the player car. Cheap no-op if nothing changed. */
export function applyTuning(car, upgrades = {}) {
    const parts = car.userData.parts;
    const model = car.userData.model;
    if (!parts || !model) return;
    const key = `${model.id ?? model.name}:${upgrades.engine ?? 0}:${upgrades.grip ?? 0}:${upgrades.nitro ?? 0}:${upgrades.armor ?? 0}`;
    if (parts.tuneKey === key) return;
    parts.tuneKey = key;
    if (parts.tune) {
        parts.chassis.remove(parts.tune);
        parts.tune.traverse((node) => {
            node.geometry?.dispose();
            node.material?.dispose();
        });
    }
    const tune = new THREE.Group();
    const L = model.length;
    const W = model.width;
    const H = model.height;
    const dark = createMaterial("#0c1016", { roughness: 0.4, metalness: 0.4 });
    if ((upgrades.grip ?? 0) >= 1) {
        for (const side of [-1, 1]) addBox(tune, { x: 0.1, y: 0.1, z: L * 0.42 }, { x: side * (W / 2 + 0.04), y: -H / 2 + 0.1, z: 0 }, dark);
    }
    if ((upgrades.engine ?? 0) >= 2) {
        addBox(tune, { x: W * 1.0, y: 0.07, z: 0.4 }, { x: 0, y: H / 2 + 0.52, z: -L * 0.5 }, dark);
        for (const side of [-1, 1]) addBox(tune, { x: 0.07, y: 0.4, z: 0.3 }, { x: side * W * 0.42, y: H / 2 + 0.3, z: -L * 0.5 }, dark);
    }
    if ((upgrades.engine ?? 0) >= 3) {
        addBox(tune, { x: W * 0.3, y: 0.14, z: L * 0.2 }, { x: 0, y: H / 2 + 0.07, z: L * 0.24 }, dark);
    }
    if ((upgrades.nitro ?? 0) >= 1) {
        const glow = new THREE.Mesh(
            new THREE.PlaneGeometry(W * 0.95, L * 0.85).rotateX(-Math.PI / 2),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.6, 2.4), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
        );
        glow.position.y = -0.62;
        tune.add(glow);
    }
    if ((upgrades.armor ?? 0) >= 2) {
        addBox(tune, { x: W * 1.06, y: 0.24, z: 0.3 }, { x: 0, y: -H / 2 + 0.16, z: L / 2 + 0.1 }, dark);
    }
    parts.tune = tune;
    parts.chassis.add(tune);
}

/**
 * Per-frame body animation. `speed` is signed forward speed (m/s); `steer`/`turn` are -1..1 (+ = left).
 * `tilt` enables body roll and pitch (player only); `night` (0..1) drives the headlight spot.
 */
export function updateCarVisuals(car, dt, { speed = 0, steer = 0, turn = 0, braking = false, night = 0, tilt = false } = {}) {
    const parts = car.userData.parts;
    const vis = car.userData.vis;
    if (!parts || !vis || dt <= 0) return;

    const spinStep = (speed * dt) / parts.wheelRadius;
    vis.steer += (steer * 0.45 - vis.steer) * Math.min(1, dt * 12);
    for (const wheel of parts.wheels) {
        wheel.spin.rotation.x += spinStep;
        if (wheel.front) wheel.pivot.rotation.y = vis.steer;
    }

    if (tilt) {
        const accel = (speed - vis.prevSpeed) / dt;
        vis.prevSpeed = speed;
        vis.accel += (accel - vis.accel) * Math.min(1, dt * 6);
        const speedFactor = Math.min(1, Math.abs(speed) / 10);
        const pitchTarget = Math.max(-0.07, Math.min(0.07, -vis.accel * 0.0045));
        const rollTarget = -turn * speedFactor * 0.09;
        vis.pitch += (pitchTarget - vis.pitch) * Math.min(1, dt * 7);
        vis.roll += (rollTarget - vis.roll) * Math.min(1, dt * 6);
        parts.chassis.rotation.x = vis.pitch;
        parts.chassis.rotation.z = vis.roll;
    }

    parts.tailMat.emissiveIntensity = braking ? 3 : 0.65;

    if (parts.spot) parts.spot.intensity = night * 70;
    if (parts.siren) {
        const t = performance.now() / 1000 * 7 + parts.siren.offset * 3;
        const phase = Math.floor(t) % 2 === 0;
        const pulse = 0.25 + 0.75 * Math.abs(Math.sin(t * Math.PI));
        parts.siren.red.emissiveIntensity = phase ? 0.2 + pulse * 3.2 : 0.15;
        parts.siren.blue.emissiveIntensity = phase ? 0.15 : 0.2 + pulse * 3.2;
    }
}

export function replaceCarModel(target, nextModel, sharedMaterials, options = {}) {
    const hadSpot = Boolean(target.userData.parts?.spot);
    target.traverse((node) => {
        if (node.geometry && !node.geometry.userData.shared) node.geometry.dispose();
        if (node.material && !node.material.userData.shared) node.material.dispose();
    });
    target.clear();
    const next = createCar(nextModel, sharedMaterials, { ...options, headlightSpot: hadSpot || options.headlightSpot });
    while (next.children.length > 0) {
        target.add(next.children[0]);
    }
    target.userData.model = nextModel;
    target.userData.parts = next.userData.parts;
    target.userData.vis = next.userData.vis;
}
