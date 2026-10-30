import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { archetypeFor, archetypeId, sideContour, wheelLayout } from "./data/vehicles.js";
import { LIGHT_STYLES, PARTS, RIM_STYLES, TIRE_STYLES, box, partContext } from "./vehicleParts.js";

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

let beamMaterial = null;
function getBeamMaterial() {
    if (!beamMaterial) {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        const gradient = ctx.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, "rgba(255,244,200,0.9)");
        gradient.addColorStop(1, "rgba(255,244,200,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 32, 64);
        beamMaterial = new THREE.MeshBasicMaterial({
            map: new THREE.CanvasTexture(canvas),
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        beamMaterial.userData.shared = true;
    }
    return beamMaterial;
}

function getBeamGeometry(width, length) {
    return cached(`beam:${width}`, () => new THREE.PlaneGeometry(width * 0.95, 7).rotateX(-Math.PI / 2).rotateY(Math.PI));
}

/** 0 = day, 1 = full night: how visible the NPC headlight decals are. */
export function setHeadlightBeamLevel(level) {
    if (beamMaterial) beamMaterial.opacity = Math.max(0, Math.min(1, level)) * 0.55;
}

export function setPaint(car, color, chrome = false) {
    const parts = car.userData.parts;
    const model = car.userData.model;
    if (!parts?.bodyMat || !model) return;
    parts.bodyMat.color.set(color ?? model.color);
    parts.bodyMat.metalness = chrome ? 0.95 : 0.36;
    parts.bodyMat.roughness = chrome ? 0.12 : 0.24;
}

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

function bodyGeometry(model, archetype) {
    return cached(`body:${archetypeId(model)}:${model.length}:${model.width}:${model.height}`, () =>
        extrudeProfile(sideContour(archetype, model.length, model.height), model.width)
    );
}

function cabinGeometry(model, archetype) {
    const { from, to, height, rake } = archetype.cabin;
    return cached(`cabin:${archetypeId(model)}:${model.length}:${model.width}:${model.height}`, () => {
        const L = model.length;
        const base = model.height / 2;
        const slope = rake * L;
        return extrudeProfile(
            [
                [from * L, base],
                [to * L, base],
                [to * L - slope, base + height],
                [from * L + slope * 0.8, base + height],
            ],
            model.width * 0.88,
            0.03
        );
    });
}

function mergeAll(list) {
    if (!list.length) return null;
    const merged = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (list.length > 1) for (const g of list) g.dispose();
    return merged;
}

/**
 * Every static part of a model, merged per material group (paint, trim, dark, accent, lights).
 * One cache entry per body shape and size; cars of the same model share the geometry.
 */
const staticCache = new Map();
function staticGeometry(model, archetype) {
    const features = [...archetype.features, ...(model.features ?? [])];
    const lightStyle = model.lights ?? archetype.lights ?? "default";
    const key = `${archetype.id}:${model.length}:${model.width}:${model.height}:${features.join("+")}:${lightStyle}`;
    let entry = staticCache.get(key);
    if (entry) return entry;
    const ctx = partContext(model, archetype);
    const { L, W, H, cabin } = ctx;
    const groups = { paint: [bodyGeometry(model, archetype)], trim: [], dark: [], accent: [], head: [], tail: [] };

    groups.trim.push(box({ x: W * 0.84, y: 0.07, z: ctx.roofLength }, { x: 0, y: ctx.roofY, z: ctx.roofZ }));
    groups.dark.push(box({ x: W * 1.02, y: 0.16, z: 0.22 }, { x: 0, y: -H / 2 + 0.12, z: L / 2 }));
    groups.dark.push(box({ x: W * 1.02, y: 0.16, z: 0.22 }, { x: 0, y: -H / 2 + 0.12, z: -L / 2 }));
    for (const side of [-1, 1]) {
        groups.paint.push(box({ x: 0.14, y: 0.1, z: 0.18 }, { x: side * (W * 0.5 + 0.08), y: H / 2 + 0.14, z: cabin.to * L - 0.1 }));
    }

    const lights = (LIGHT_STYLES[lightStyle] ?? LIGHT_STYLES.default)(ctx);
    for (const [group, list] of Object.entries(lights)) groups[group].push(...list);
    for (const name of features) {
        const built = PARTS[name]?.(ctx);
        if (!built) continue;
        for (const [group, list] of Object.entries(built)) groups[group].push(...list);
    }

    entry = { glass: cabinGeometry(model, archetype) };
    for (const [name, list] of Object.entries(groups)) entry[name] = mergeAll(list);
    for (const geometry of Object.values(entry)) if (geometry) geometry.userData.shared = true;
    staticCache.set(key, entry);
    return entry;
}

// Materials that do not change per car are shared instead of created again for every vehicle.
const sharedPartMaterials = {};
function sharedPart(key, build) {
    if (!sharedPartMaterials[key]) {
        sharedPartMaterials[key] = build();
        sharedPartMaterials[key].userData.shared = true;
    }
    return sharedPartMaterials[key];
}

let rimMaterial = null;

function wheelParts(rimStyle = "disc", tireStyle = "standard") {
    if (!rimMaterial) {
        rimMaterial = createMaterial("#c9d2dc", { roughness: 0.22, metalness: 0.85 });
        rimMaterial.userData.shared = true;
    }
    const tireSpec = TIRE_STYLES[tireStyle] ?? TIRE_STYLES.standard;
    const rimBuilder = RIM_STYLES[rimStyle] ?? RIM_STYLES.disc;
    return {
        tire: cached(`wheel:tire:${tireStyle}`, () => new THREE.CylinderGeometry(tireSpec.radius, tireSpec.radius, tireSpec.width, 14).rotateZ(Math.PI / 2)),
        rim: cached(`wheel:rim:${rimStyle}`, () => rimBuilder()),
        rimMat: rimStyle === "neonRing" ? sharedPart("rim:neon", () => new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 2.6) })) : rimMaterial,
        radius: tireSpec.radius,
    };
}

export function createCar(model, sharedMaterials, options = {}) {
    const group = new THREE.Group();
    const chassis = new THREE.Group();
    group.add(chassis);
    const archetype = archetypeFor(model);
    const cabin = archetype.cabin;
    const bodyMat = createMaterial(options.bodyColor ?? model.color, { roughness: 0.24, metalness: 0.36 });
    const trimColor = options.trimColor ?? model.trim;
    const trimMat = sharedPart(`trim:${trimColor}`, () => createMaterial(trimColor, { roughness: 0.32, metalness: 0.42 }));
    const accentMat = sharedPart(options.police ? "accent:police" : "accent:cream", () =>
        createMaterial(options.police ? "#f5f7fb" : "#f7f1de", { roughness: 0.18, metalness: 0.45 })
    );
    const headlightMat = sharedPart("headlight", () => createMaterial("#fff6a8", { emissive: "#ffe56b", emissiveIntensity: 0.8 }));
    const tailMat = createMaterial("#ff394b", { emissive: "#ff394b", emissiveIntensity: 0.65 });
    const bumperMat = sharedMaterials.dark ?? trimMat;
    const L = model.length;
    const W = model.width;
    const H = model.height;

    // Static parts: a handful of merged meshes instead of one mesh per box.
    const fixed = staticGeometry(model, archetype);
    const addMerged = (geometry, material, cast, receive) => {
        if (!geometry) return;
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = cast;
        mesh.receiveShadow = receive;
        chassis.add(mesh);
    };
    addMerged(fixed.paint, bodyMat, true, true);
    addMerged(fixed.glass, sharedMaterials.glass, true, false);
    addMerged(fixed.trim, trimMat, true, true);
    addMerged(fixed.dark, bumperMat, true, true);
    addMerged(fixed.accent, accentMat, true, true);
    addMerged(fixed.head, headlightMat, false, false);
    addMerged(fixed.tail, tailMat, false, false);

    // Wheels: pivot (steering) > spin (rolling) > tire + rim
    const { tire, rim, rimMat, radius: tireRadius } = wheelParts(options.wheelStyle ?? model.wheelStyle ?? archetype.wheelStyle, model.tireStyle ?? archetype.tireStyle);
    const wheels = [];
    const wheelSpots = wheelLayout(archetype, W, L);
    for (const spot of wheelSpots) {
        const pivot = new THREE.Group();
        pivot.position.set(spot.x, spot.y, spot.z);
        if (spot.scale && spot.scale !== 1) pivot.scale.setScalar(spot.scale);
        const spin = new THREE.Group();
        pivot.add(spin);
        spin.add(new THREE.Mesh(tire, sharedMaterials.tire));
        const rimMesh = new THREE.Mesh(rim, rimMat);
        rimMesh.position.x = (spot.sx || 1) * 0.01;
        spin.add(rimMesh);
        group.add(pivot);
        wheels.push({ pivot, spin, front: spot.front });
    }

    const parts = { bodyMat, archetype: archetype.id, paintKey: null, beam: null, chassis, wheels, tailMat, headlightMat, wheelRadius: tireRadius * (wheelSpots[0]?.scale ?? 1), tune: null, tuneKey: null, siren: null, spot: null };

    if (options.police) {
        const barY = H / 2 + cabin.height + 0.12;
        addBox(chassis, { x: W * 0.75, y: 0.12, z: 0.46 }, { x: 0, y: barY, z: 0 }, accentMat, false, false);
        const blue = createMaterial("#326dff", { emissive: "#326dff", emissiveIntensity: 0.9 });
        const red = createMaterial("#ff344c", { emissive: "#ff344c", emissiveIntensity: 0.9 });
        addBox(chassis, { x: W * 0.35, y: 0.13, z: 0.4 }, { x: -W * 0.18, y: barY + 0.08, z: 0 }, blue, false, false);
        addBox(chassis, { x: W * 0.35, y: 0.13, z: 0.4 }, { x: W * 0.18, y: barY + 0.08, z: 0 }, red, false, false);
        parts.siren = { red, blue, offset: Math.random() * 2 };
    }

    if (options.taxi) {
        addBox(chassis, { x: W * 0.44, y: 0.18, z: 0.5 }, { x: 0, y: H / 2 + cabin.height + 0.12, z: 0.05 }, createMaterial("#f7f1de", { emissive: "#ffc64d", emissiveIntensity: 0.35 }), false, false);
    }

    if (options.headlightSpot) {
        const spot = new THREE.SpotLight("#fff1c4", 0, 42, 0.5, 0.6, 1.2);
        spot.position.set(0, 0.3, L / 2);
        spot.target.position.set(0, -1.2, L / 2 + 14);
        chassis.add(spot);
        chassis.add(spot.target);
        parts.spot = spot;
    }

    if (!options.headlightSpot) {
        // NPC cars light the road ahead with a soft additive decal instead of a real light.
        const beam = new THREE.Mesh(getBeamGeometry(W, L), getBeamMaterial());
        beam.position.set(0, -0.3, L / 2 + 3.6);
        beam.renderOrder = 1;
        group.add(beam);
        parts.beam = beam;
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
    const key = `${model.id ?? model.name}:${upgrades.engine ?? 0}:${upgrades.grip ?? 0}:${upgrades.nitro ?? 0}:${upgrades.armor ?? 0}:${upgrades.neon ? 1 : 0}`;
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
    if ((upgrades.nitro ?? 0) >= 1 || upgrades.neon) {
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
