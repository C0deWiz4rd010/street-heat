import * as THREE from "three";
import { CONFIG, DISTRICTS, POIS } from "./config.js";
import { markShared } from "./effects.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { createMaterial } from "./vehicles.js";

const WORLD_SEED = 0x57ee7;
const NEON_COLORS = [[3.2, 0.45, 1.7], [0.5, 2.6, 3.2], [1.9, 0.8, 3.4]];
const LAMP_TINTS = { downtown: "#ff7ad9", industrial: "#ff9a3c", park: "#ffd9a0", harbor: "#7fc4ff" };

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let random = mulberry32(WORLD_SEED);

// Collected while the world is built, then flushed into one InstancedMesh per kind.
let sink = null;
function createSink() {
    return {
        windows: [], neon: [], markings: [], crosswalks: [], sidewalks: [], trunks: [], crownsSphere: [], crownsCone: [],
        antennas: [], bollards: [], benches: [], beaconsA: [], beaconsB: [], puddles: [],
    };
}

const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

function flushInstances(scene, geometry, material, list, { shadow = false, receive = false } = {}) {
    if (!list.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((item, index) => {
        dummy.position.set(item.x, item.y, item.z);
        dummy.rotation.set(0, item.ry ?? 0, 0);
        dummy.scale.set(item.sx ?? 1, item.sy ?? 1, item.sz ?? 1);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        if (item.color) {
            if (Array.isArray(item.color)) tmpColor.setRGB(item.color[0], item.color[1], item.color[2]);
            else tmpColor.set(item.color);
            mesh.setColorAt(index, tmpColor);
        }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = shadow;
    mesh.receiveShadow = receive;
    mesh.frustumCulled = false;
    scene.add(mesh);
    return mesh;
}

function canvasTexture(size, draw) {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    draw(canvas.getContext("2d"), size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    return texture;
}

let hazardMaterial = null;
function getHazardMaterial() {
    if (!hazardMaterial) {
        const map = canvasTexture(64, (ctx, size) => {
            ctx.fillStyle = "#e8b923";
            ctx.fillRect(0, 0, size, size);
            ctx.fillStyle = "#16181b";
            for (let i = -size; i < size * 2; i += 32) {
                ctx.beginPath();
                ctx.moveTo(i, 0);
                ctx.lineTo(i + 16, 0);
                ctx.lineTo(i + 16 - size, size);
                ctx.lineTo(i - size, size);
                ctx.fill();
            }
        });
        map.repeat.set(1, 9);
        hazardMaterial = createMaterial("#ffffff", { roughness: 0.7, metalness: 0.04 });
        hazardMaterial.map = map;
    }
    return hazardMaterial;
}

function createWaterMaterial() {
    const bumpMap = canvasTexture(128, (ctx, size) => {
        const rng = mulberry32(7);
        ctx.fillStyle = "#808080";
        ctx.fillRect(0, 0, size, size);
        for (let i = 0; i < 260; i += 1) {
            const x = rng() * size;
            const y = rng() * size;
            const r = 3 + rng() * 9;
            const g = ctx.createRadialGradient(x, y, 0, x, y, r);
            const v = rng() < 0.5 ? 255 : 0;
            g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
            g.addColorStop(1, "rgba(128,128,128,0)");
            ctx.fillStyle = g;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
    });
    bumpMap.repeat.set(3, 3);
    return new THREE.MeshStandardMaterial({
        color: "#15506f",
        roughness: 0.12,
        metalness: 0.6,
        emissive: "#0a2c42",
        emissiveIntensity: 0.4,
        bumpMap,
        bumpScale: 2.2,
    });
}

export function createWorld(scene, sharedMaterials) {
    random = mulberry32(WORLD_SEED);
    sink = createSink();
    const buildings = [];
    const obstacles = [];
    const objects = [];
    const shortcutZones = [];
    const scannerZones = [];
    const districtMaterials = createDistrictMaterials(sharedMaterials);
    const waterMaterial = createWaterMaterial();
    districtMaterials.harborWater = waterMaterial;

    const ground = new THREE.Mesh(
        new THREE.BoxGeometry(CONFIG.map.size + 32, 0.28, CONFIG.map.size + 32),
        sharedMaterials.grass
    );
    ground.position.y = -0.16;
    ground.receiveShadow = true;
    scene.add(ground);

    for (const sx of CONFIG.map.streets) {
        const road = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.streetWidth, 0.08, CONFIG.map.size + 16), sharedMaterials.asphalt);
        road.position.set(sx, 0.01, 0);
        road.receiveShadow = true;
        scene.add(road);
        addRoadMarkings(true, sx);
    }

    for (const sz of CONFIG.map.streets) {
        const road = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.size + 16, 0.09, CONFIG.map.streetWidth), sharedMaterials.asphalt);
        road.position.set(0, 0.02, sz);
        road.receiveShadow = true;
        scene.add(road);
        addRoadMarkings(false, sz);
    }

    for (const bx of CONFIG.map.blockCenters) {
        for (const bz of CONFIG.map.blockCenters) {
            const district = getDistrictForPosition(bx, bz);
            const surface = createDistrictSurface(district, districtMaterials);
            surface.position.set(bx, surface.position.y, bz);
            scene.add(surface);

            if (district.id === "downtown") {
                decorateDowntownBlock(scene, objects, buildings, obstacles, districtMaterials, bx, bz);
            } else if (district.id === "industrial") {
                decorateIndustrialBlock(scene, objects, buildings, obstacles, districtMaterials, bx, bz);
            } else if (district.id === "park") {
                decorateParkBlock(scene, objects, buildings, obstacles, shortcutZones, districtMaterials, bx, bz);
            } else {
                decorateHarborBlock(scene, objects, buildings, obstacles, districtMaterials, bx, bz);
            }
        }
    }

    for (const sx of CONFIG.map.streets) {
        for (const sz of CONFIG.map.streets) {
            const district = getDistrictForPosition(sx, sz);
            const lampTint = LAMP_TINTS[district.id] ?? district.color;
            createLamp(scene, obstacles, sx + 8.8, sz + 8.8, lampTint);
            createLamp(scene, obstacles, sx - 8.8, sz - 8.8, lampTint);
        }
    }

    for (const poi of POIS) {
        const marker = createPoiMarker(poi);
        scene.add(marker);
        objects.push(marker);
    }

    // Harbor: large water base plane under the entire quadrant
    const harborBase = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.size / 2 - 4, 0.07, CONFIG.map.size / 2 - 4), waterMaterial);
    harborBase.position.set(-CONFIG.map.size / 4, -0.08, -CONFIG.map.size / 4);
    harborBase.receiveShadow = true;
    scene.add(harborBase);
    objects.push(harborBase);

    // Downtown: central landmark tower (skyline anchor)
    const downtownTower = createLandmarkTower(scene, 38, 38);
    objects.push(downtownTower);
    buildings.push({ x: 38, z: 38, hw: 5.5, hd: 5.5, h: 52 });

    // Industrial: tall smokestack with point light
    createSmokestack(scene, objects, -38, 38);

    // Park: large central lake
    const parkLake = new THREE.Mesh(new THREE.CylinderGeometry(10, 10.5, 0.1, 32), waterMaterial);
    parkLake.scale.z = 0.72;
    parkLake.position.set(35, -0.02, -35);
    parkLake.receiveShadow = true;
    scene.add(parkLake);
    objects.push(parkLake);

    // Harbor: extra dock water accent strips near edges
    const dockWaterEast = new THREE.Mesh(new THREE.BoxGeometry(6, 0.07, CONFIG.map.size / 2 - 2), waterMaterial);
    dockWaterEast.position.set(-CONFIG.map.size / 2 + 3, -0.06, -CONFIG.map.size / 4);
    scene.add(dockWaterEast);
    const dockWaterNorth = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.size / 2 - 2, 0.07, 6), waterMaterial);
    dockWaterNorth.position.set(-CONFIG.map.size / 4, -0.06, -CONFIG.map.size / 2 + 3);
    scene.add(dockWaterNorth);

    createShip(scene, objects);
    createScannerZones(scene, scannerZones);

    addStreetFurniture();
    const handles = flushWorldInstances(scene, sharedMaterials);
    const waterBump = waterMaterial.bumpMap;
    let visualTime = 0;
    const WINDOW_DAY = new THREE.Color(0.3, 0.42, 0.52);
    const WINDOW_NIGHT = new THREE.Color(2.4, 2.4, 2.4);

    /** night: 0 (day) .. 1 (night), wet: 0 .. 1. Cheap enough to call every frame. */
    function updateVisuals(dt, night, wet) {
        visualTime += dt;
        waterBump.offset.set(visualTime * 0.012, visualTime * 0.02);
        handles.windowMaterial.color.copy(WINDOW_DAY).lerp(WINDOW_NIGHT, night);
        const neon = 0.8 + night * 1.2;
        handles.neonMaterial.color.setRGB(neon, neon, neon);
        for (let i = 0; i < 2; i += 1) {
            const pulse = Math.sin(visualTime * 3.2 + i * Math.PI) > 0.2 ? 1 : 0.12;
            const level = (0.5 + night * 2.5) * pulse;
            handles.beaconMaterials[i].color.setRGB(level, level * 0.1, level * 0.1);
        }
        sharedMaterials.asphalt.roughness = 0.92 - wet * 0.62;
        sharedMaterials.asphalt.metalness = 0.03 + wet * 0.2;
        if (handles.puddleMaterial) handles.puddleMaterial.opacity = wet * 0.85;
    }

    const grid = {
        buildings: buildGrid(buildings, 6),
        obstacles: buildGrid(obstacles, 8),
    };

    return { buildings, obstacles, objects, pointsOfInterest: POIS, districts: DISTRICTS, shortcutZones, scannerZones, grid, updateVisuals };
}

// Uniform grid: each item is registered in every cell its (margin-expanded) box touches,
// so a lookup at (x, z) only needs the single cell containing that point.
const GRID_CELL = 8;
const GRID_OFFSET = 24;
const GRID_STRIDE = 64;
const EMPTY_CELL = [];

function gridKey(x, z) {
    return (Math.floor(x / GRID_CELL) + GRID_OFFSET) * GRID_STRIDE + Math.floor(z / GRID_CELL) + GRID_OFFSET;
}

function buildGrid(items, margin) {
    const cells = new Map();
    for (const item of items) {
        const hw = item.hw ?? item.radius ?? 0;
        const hd = item.hd ?? item.radius ?? 0;
        const minX = Math.floor((item.x - hw - margin) / GRID_CELL);
        const maxX = Math.floor((item.x + hw + margin) / GRID_CELL);
        const minZ = Math.floor((item.z - hd - margin) / GRID_CELL);
        const maxZ = Math.floor((item.z + hd + margin) / GRID_CELL);
        for (let cx = minX; cx <= maxX; cx += 1) {
            for (let cz = minZ; cz <= maxZ; cz += 1) {
                const key = (cx + GRID_OFFSET) * GRID_STRIDE + cz + GRID_OFFSET;
                const bucket = cells.get(key);
                if (bucket) bucket.push(item);
                else cells.set(key, [item]);
            }
        }
    }
    return cells;
}

export function buildingsNear(world, x, z) {
    if (!world.grid) return world.buildings; // still generating the world
    return world.grid.buildings.get(gridKey(x, z)) ?? EMPTY_CELL;
}

export function obstaclesNear(world, x, z) {
    if (!world.grid) return world.obstacles;
    return world.grid.obstacles.get(gridKey(x, z)) ?? EMPTY_CELL;
}

export function insideBuilding(world, x, z, radius) {
    for (const building of buildingsNear(world, x, z)) {
        const closestX = clamp(x, building.x - building.hw, building.x + building.hw);
        const closestZ = clamp(z, building.z - building.hd, building.z + building.hd);
        const dx = x - closestX;
        const dz = z - closestZ;
        if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
}

export function pushOutBuildings(world, pos, radius) {
    let hit = false;
    for (const building of buildingsNear(world, pos.x, pos.z)) {
        const cx = clamp(pos.x, building.x - building.hw, building.x + building.hw);
        const cz = clamp(pos.z, building.z - building.hd, building.z + building.hd);
        const dx = pos.x - cx;
        const dz = pos.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < radius * radius) {
            hit = true;
            if (d2 === 0) {
                const left = Math.abs(pos.x - (building.x - building.hw));
                const right = Math.abs((building.x + building.hw) - pos.x);
                const top = Math.abs(pos.z - (building.z - building.hd));
                const bottom = Math.abs((building.z + building.hd) - pos.z);
                const minX = Math.min(left, right);
                const minZ = Math.min(top, bottom);
                if (minX < minZ) pos.x = left < right ? building.x - building.hw - radius : building.x + building.hw + radius;
                else pos.z = top < bottom ? building.z - building.hd - radius : building.z + building.hd + radius;
                continue;
            }
            const distance = Math.sqrt(d2) || 1;
            const overlap = radius - distance;
            pos.x += (dx / distance) * overlap;
            pos.z += (dz / distance) * overlap;
        }
    }
    return hit;
}

export function obstacleAt(world, x, z, radius) {
    for (const obstacle of obstaclesNear(world, x, z)) {
        if (obstacle.destroyed) continue;
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        const rr = radius + obstacle.radius;
        if (dx * dx + dz * dz < rr * rr) return obstacle;
    }
    return null;
}

export function snapStreet(value) {
    let best = CONFIG.map.streets[0];
    let bestDist = Infinity;
    for (const street of CONFIG.map.streets) {
        const dist = Math.abs(value - street);
        if (dist < bestDist) {
            bestDist = dist;
            best = street;
        }
    }
    return best + (Math.random() - 0.5) * CONFIG.map.streetWidth * 0.55;
}

function createDistrictMaterials(sharedMaterials) {
    return {
        downtown: createMaterial("#909da9", { roughness: 0.82, metalness: 0.08 }),
        industrial: createMaterial("#74685a", { roughness: 0.9, metalness: 0.06 }),
        parkGrass: createMaterial("#3d7140", { roughness: 0.94, metalness: 0.02 }),
        parkPath: createMaterial("#b8ac92", { roughness: 0.88, metalness: 0.04 }),
        harborDock: createMaterial("#64707c", { roughness: 0.86, metalness: 0.12 }),
        harborWater: createMaterial("#2a6380", { roughness: 0.24, metalness: 0.48, emissive: "#0b3146", emissiveIntensity: 0.26 }),
        harborEdge: createMaterial("#f7fbff", { roughness: 0.24, metalness: 0.5 }),
        skylineGlass: createMaterial("#9fdcff", { roughness: 0.12, metalness: 0.62, emissive: "#25506d", emissiveIntensity: 0.14 }),
        crane: createMaterial("#d29549", { roughness: 0.5, metalness: 0.22, emissive: "#6c461c", emissiveIntensity: 0.14 }),
        containerBlue: createMaterial("#4b8ab1", { roughness: 0.52, metalness: 0.18 }),
        containerRed: createMaterial("#a3554a", { roughness: 0.56, metalness: 0.14 }),
        containerGreen: createMaterial("#5f8b60", { roughness: 0.6, metalness: 0.1 }),
        ramp: createMaterial("#7e8d99", { roughness: 0.58, metalness: 0.18 }),
        kioskAccent: createMaterial("#63c8ff", { roughness: 0.22, metalness: 0.28, emissive: "#1d6f96", emissiveIntensity: 0.32 }),
    };
}

function createDistrictSurface(district, materials) {
    let material = materials.downtown;
    if (district.id === "industrial") material = materials.industrial;
    else if (district.id === "park") material = materials.parkGrass;
    else if (district.id === "harbor") material = materials.harborDock;

    const base = new THREE.Mesh(
        new THREE.BoxGeometry(CONFIG.map.blockSize, 0.16, CONFIG.map.blockSize),
        material
    );
    base.position.y = 0.09;
    base.receiveShadow = true;
    return base;
}

function decorateDowntownBlock(scene, objects, buildings, obstacles, materials, bx, bz) {
    const slots = shuffle([
        { x: -4.6, z: -4.8 },
        { x: 4.5, z: -4.7 },
        { x: -4.8, z: 4.6 },
        { x: 4.6, z: 4.5 },
    ]);
    const buildingCount = 2 + Math.floor(random() * 2) + (random() < 0.5 ? 1 : 0);

    for (let index = 0; index < buildingCount; index += 1) {
        const slot = slots[index];
        const width = 4.4 + random() * 2.1;
        const depth = 4.3 + random() * 2.4;
        const height = 14 + random() * 18;
        const x = bx + slot.x + (random() - 0.5) * 0.8;
        const z = bz + slot.z + (random() - 0.5) * 0.8;
        const tower = createBuilding(width, depth, height, x, z, {
            baseHue: 0.57 + random() * 0.05,
            saturation: 0.16,
            lightness: 0.34 + random() * 0.1,
            roofColor: "#0f141b",
            windowKind: "cool",
            neon: true,
            antenna: true,
        });
        scene.add(tower);
        objects.push(tower);
        buildings.push({ x, z, hw: width / 2 + 0.8, hd: depth / 2 + 0.8, h: height });
    }

    const median = new THREE.Mesh(
        new THREE.BoxGeometry(CONFIG.map.blockSize * 0.18, 0.22, CONFIG.map.blockSize * 0.74),
        createMaterial("#5d676f", { roughness: 0.78, metalness: 0.1 })
    );
    median.position.set(bx, 0.14, bz);
    median.receiveShadow = true;
    scene.add(median);
    objects.push(median);

    for (let index = 0; index < 3; index += 1) {
        const x = bx + (random() - 0.5) * (CONFIG.map.blockSize - 2.5);
        const z = bz + (random() - 0.5) * (CONFIG.map.blockSize - 2.5);
        if (!insideBuilding({ buildings }, x, z, 1.4)) {
            const prop = createStreetProp(x, z, index, materials.kioskAccent);
            scene.add(prop);
            objects.push(prop);
            appendObstacleFromMesh(obstacles, prop, x, z);
        }
    }
}

function decorateIndustrialBlock(scene, objects, buildings, obstacles, materials, bx, bz) {
    const stripeMat = getHazardMaterial();
    for (const offset of [-3.8, 0, 3.8]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, CONFIG.map.blockSize * 0.8), stripeMat);
        stripe.position.set(bx + offset, 0.11, bz);
        stripe.receiveShadow = true;
        scene.add(stripe);
    }

    {
        const tankX = bx + (random() < 0.5 ? -6.2 : 6.2);
        const tankZ = bz + (random() < 0.5 ? -6.4 : 6.4);
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 3.6, 18), createMaterial("#8b939a", { roughness: 0.4, metalness: 0.55 }));
        tank.position.set(tankX, 1.9, tankZ);
        tank.castShadow = true;
        scene.add(tank);
        objects.push(tank);
        obstacles.push({ x: tankX, z: tankZ, radius: 1.7, type: "tank", label: "Tank", reward: 0, color: "#8b939a", mesh: tank });
    }

    const warehouseCount = 1 + Math.floor(random() * 2);
    const warehouseSlots = shuffle([
        { x: -3.6, z: 0.8 },
        { x: 3.2, z: -2.4 },
        { x: 0, z: 3.1 },
    ]);

    for (let index = 0; index < warehouseCount; index += 1) {
        const slot = warehouseSlots[index];
        const width = 8.4 + random() * 3.5;
        const depth = 6.4 + random() * 2.7;
        const height = 5.4 + random() * 3.6;
        const x = bx + slot.x;
        const z = bz + slot.z;
        const warehouse = createBuilding(width, depth, height, x, z, {
            baseHue: 0.08 + random() * 0.04,
            saturation: 0.1,
            lightness: 0.38 + random() * 0.06,
            roofColor: "#252a30",
            windowKind: "warm",
        });
        scene.add(warehouse);
        objects.push(warehouse);
        buildings.push({ x, z, hw: width / 2 + 0.8, hd: depth / 2 + 0.8, h: height });
        const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, width, 8), createMaterial("#b8692f", { roughness: 0.5, metalness: 0.5 }));
        pipe.rotation.z = Math.PI / 2;
        pipe.position.set(x, 2.4, z + depth / 2 + 0.28);
        scene.add(pipe);
        objects.push(pipe);
    }

    const stacks = 3 + Math.floor(random() * 2);
    for (let index = 0; index < stacks; index += 1) {
        const x = bx + (random() - 0.5) * (CONFIG.map.blockSize - 5);
        const z = bz + (random() - 0.5) * (CONFIG.map.blockSize - 5);
        if (insideBuilding({ buildings }, x, z, 1.6)) continue;
        const stack = createContainerStack(x, z, materials, 2 + Math.floor(random() * 2));
        scene.add(stack.mesh);
        objects.push(stack.mesh);
        obstacles.push({ x, z, radius: stack.radius, type: "containerStack", label: "Container", reward: 0, color: "#7fa0b2", mesh: stack.mesh });
    }

    for (let index = 0; index < 4; index += 1) {
        const x = bx + (random() - 0.5) * (CONFIG.map.blockSize - 3);
        const z = bz + (random() - 0.5) * (CONFIG.map.blockSize - 3);
        if (insideBuilding({ buildings }, x, z, 1.2)) continue;
        const prop = random() < 0.55
            ? createCrateStackProp(x, z, 2 + Math.floor(random() * 2))
            : createConstructionBeacon(x, z, index);
        scene.add(prop);
        objects.push(prop);
        appendObstacleFromMesh(obstacles, prop, x, z);
    }

    const fence = createFenceSegment(bx, bz - 6.1, "x", 4 + Math.floor(random() * 2));
    scene.add(fence);
    objects.push(fence);
    appendObstacleFromMesh(obstacles, fence, bx, bz - 6.1);
}

function decorateParkBlock(scene, objects, buildings, obstacles, shortcutZones, materials, bx, bz) {
    const pathOffsetZ = (random() - 0.5) * 2;
    const pathX = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 0.9, 0.04, 2.4), materials.parkPath);
    pathX.position.set(bx, 0.12, bz + pathOffsetZ);
    pathX.receiveShadow = true;
    scene.add(pathX);
    shortcutZones.push({ x: bx, z: bz + pathOffsetZ, width: CONFIG.map.blockSize * 0.9, depth: 2.8 });

    const pathOffsetX = (random() - 0.5) * 2;
    const pathZ = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, CONFIG.map.blockSize * 0.9), materials.parkPath);
    pathZ.position.set(bx + pathOffsetX, 0.12, bz);
    pathZ.receiveShadow = true;
    scene.add(pathZ);
    shortcutZones.push({ x: bx + pathOffsetX, z: bz, width: 2.8, depth: CONFIG.map.blockSize * 0.9 });

    if (random() < 0.55) {
        const pond = new THREE.Mesh(
            new THREE.CylinderGeometry(2.2, 2.8, 0.08, 22),
            materials.harborWater
        );
        pond.scale.z = 1.35;
        pond.position.set(bx + (random() - 0.5) * 5, 0.08, bz + (random() - 0.5) * 5);
        pond.receiveShadow = true;
        scene.add(pond);
        objects.push(pond);
    }

    if (random() < 0.4) {
        const pavilion = createPavilion(bx + (random() - 0.5) * 3, bz + (random() - 0.5) * 3);
        scene.add(pavilion);
        objects.push(pavilion);
        obstacles.push({
            x: pavilion.position.x,
            z: pavilion.position.z,
            radius: 2.3,
            type: "pavilion",
            label: "Pavillon",
            reward: 0,
            color: "#d7cfb8",
            mesh: pavilion,
        });
    }

    for (const [bxo, bzo, ry] of [[3.4, 4.2, 0], [-4.2, -3.6, Math.PI]]) {
        const benchX = bx + bxo;
        const benchZ = bz + bzo;
        if (insideBuilding({ buildings }, benchX, benchZ, 1.2)) continue;
        sink.benches.push({ x: benchX, y: 0.2, z: benchZ, ry });
        obstacles.push({ x: benchX, z: benchZ, radius: 0.9, type: "bench", label: "Bank", reward: 0, color: "#8a6a44" });
    }

    const treeCount = 6 + Math.floor(random() * 4);
    for (let index = 0; index < treeCount; index += 1) {
        const x = bx + (random() - 0.5) * (CONFIG.map.blockSize - 2);
        const z = bz + (random() - 0.5) * (CONFIG.map.blockSize - 2);
        if (!insideBuilding({ buildings }, x, z, 1.7)) {
            addTree(x, z);
            obstacles.push({ x, z, radius: 1.8, type: "tree" });
        }
    }

    if (random() < 0.55) {
        const fence = createFenceSegment(bx + (random() - 0.5) * 4, bz + (random() - 0.5) * 4, random() < 0.5 ? "x" : "z", 3);
        scene.add(fence);
        objects.push(fence);
        appendObstacleFromMesh(obstacles, fence, fence.position.x, fence.position.z);
    }
}

function decorateHarborBlock(scene, objects, buildings, obstacles, materials, bx, bz) {
    const isWestEdge = bx < -20;
    const isNorthEdge = bz < -20;

    if (isWestEdge) {
        const water = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 0.34, 0.05, CONFIG.map.blockSize * 1.02), materials.harborWater);
        water.position.set(bx - 5.8, 0.03, bz);
        scene.add(water);

        for (let i = -3; i <= 3; i += 1) sink.bollards.push({ x: bx - 2.9, y: 0.4, z: bz + i * 2.6 });
        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, CONFIG.map.blockSize * 0.96), materials.harborEdge);
        edge.position.set(bx - 2.6, 0.18, bz);
        edge.castShadow = true;
        scene.add(edge);
    }

    if (isNorthEdge) {
        const water = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 1.02, 0.05, CONFIG.map.blockSize * 0.34), materials.harborWater);
        water.position.set(bx, 0.03, bz - 5.8);
        scene.add(water);

        for (let i = -3; i <= 3; i += 1) sink.bollards.push({ x: bx + i * 2.6, y: 0.4, z: bz - 2.9 });
        const edge = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 0.96, 0.26, 0.28), materials.harborEdge);
        edge.position.set(bx, 0.18, bz - 2.6);
        edge.castShadow = true;
        scene.add(edge);
    }

    const warehouseWidth = 8 + random() * 2.4;
    const warehouseDepth = 6.2 + random() * 2;
    const warehouseHeight = 5.6 + random() * 2.6;
    const warehouseX = bx + 3.3;
    const warehouseZ = bz + 2.2;
    const warehouse = createBuilding(warehouseWidth, warehouseDepth, warehouseHeight, warehouseX, warehouseZ, {
        baseHue: 0.56,
        saturation: 0.11,
        lightness: 0.42,
        roofColor: "#24303a",
        windowKind: "cool",
    });
    scene.add(warehouse);
    objects.push(warehouse);
    buildings.push({ x: warehouseX, z: warehouseZ, hw: warehouseWidth / 2 + 0.8, hd: warehouseDepth / 2 + 0.8, h: warehouseHeight });

    const stacks = 2 + Math.floor(random() * 3);
    for (let index = 0; index < stacks; index += 1) {
        const x = bx + (random() - 0.5) * 8 - 2;
        const z = bz + (random() - 0.5) * 7 + 1;
        if (insideBuilding({ buildings }, x, z, 1.6)) continue;
        const stack = createContainerStack(x, z, materials, 2 + Math.floor(random() * 2));
        scene.add(stack.mesh);
        objects.push(stack.mesh);
        obstacles.push({ x, z, radius: stack.radius, type: "dockContainer", label: "Dock-Container", reward: 0, color: "#5a8ba8", mesh: stack.mesh });
    }

    if (random() < 0.8) {
        const crane = createDockCrane(bx - 3.6, bz + 3.5, materials.crane);
        scene.add(crane);
        objects.push(crane);
        sink.beaconsA.push({ x: bx - 3.6 + 4.9, y: 7.6, z: bz + 3.5 });
        sink.beaconsB.push({ x: bx - 3.6, y: 8.1, z: bz + 3.5 });
        obstacles.push({ x: bx - 3.6, z: bz + 3.5, radius: 1.45, type: "crane", label: "Kran", reward: 0, color: "#d29549", mesh: crane });
    }

    if (random() < 0.7) {
        const ramp = createDockRamp(bx - 0.4, bz - 3.6, materials.ramp);
        scene.add(ramp);
        objects.push(ramp);
    }

    for (let index = 0; index < 3; index += 1) {
        const x = bx + (random() - 0.5) * 9 - 1.5;
        const z = bz + (random() - 0.5) * 7 + 0.5;
        if (insideBuilding({ buildings }, x, z, 1.1)) continue;
        const crate = createHarborCrateProp(x, z, index);
        scene.add(crate);
        objects.push(crate);
        appendObstacleFromMesh(obstacles, crate, x, z);
    }
}

function addRoadMarkings(vertical, pos) {
    for (let value = -CONFIG.map.size / 2; value <= CONFIG.map.size / 2; value += 6) {
        sink.markings.push({
            x: vertical ? pos : value,
            y: 0.09,
            z: vertical ? value : pos,
            ry: vertical ? 0 : Math.PI / 2,
        });
    }
}

function addStreetFurniture() {
    const width = CONFIG.map.streetWidth;
    const barCount = Math.floor(width / 0.95);
    for (const sx of CONFIG.map.streets) {
        for (const sz of CONFIG.map.streets) {
            for (const dir of [-1, 1]) {
                const offset = width / 2 + 1.5;
                for (let i = 0; i < barCount; i += 1) {
                    const across = (i - (barCount - 1) / 2) * 0.95;
                    sink.crosswalks.push({ x: sx + dir * offset, y: 0.12, z: sz + across, ry: 0 });
                    sink.crosswalks.push({ x: sx + across, y: 0.12, z: sz + dir * offset, ry: Math.PI / 2 });
                }
            }
        }
    }
    const half = CONFIG.map.blockSize / 2;
    for (const bx of CONFIG.map.blockCenters) {
        for (const bz of CONFIG.map.blockCenters) {
            const id = getDistrictForPosition(bx, bz).id;
            if (id === "park") continue;
            const inset = 0.55;
            const shade = id === "harbor" ? "#7c8791" : "#9a978f";
            sink.sidewalks.push({ x: bx, y: 0.19, z: bz - half + inset, sx: CONFIG.map.blockSize, sz: 1.1, color: shade });
            sink.sidewalks.push({ x: bx, y: 0.19, z: bz + half - inset, sx: CONFIG.map.blockSize, sz: 1.1, color: shade });
            sink.sidewalks.push({ x: bx - half + inset, y: 0.19, z: bz, sx: 1.1, sz: CONFIG.map.blockSize - 2.2, color: shade });
            sink.sidewalks.push({ x: bx + half - inset, y: 0.19, z: bz, sx: 1.1, sz: CONFIG.map.blockSize - 2.2, color: shade });
        }
    }
    for (let i = 0; i < 46; i += 1) {
        const onVertical = random() < 0.5;
        const street = CONFIG.map.streets[Math.floor(random() * CONFIG.map.streets.length)];
        const along = (random() - 0.5) * (CONFIG.map.size - 16);
        const across = (random() - 0.5) * (width - 1.6);
        const size = 0.9 + random() * 1.4;
        sink.puddles.push({
            x: onVertical ? street + across : along,
            y: 0.115,
            z: onVertical ? along : street + across,
            ry: random() * Math.PI,
            sx: size * (1.2 + random() * 0.8),
            sz: size,
        });
    }
}

function flushWorldInstances(scene, sharedMaterials) {
    const handles = {};

    handles.markings = flushInstances(scene, new THREE.BoxGeometry(0.22, 0.045, 2.8), sharedMaterials.line, sink.markings, { receive: true });

    const crosswalkMat = new THREE.MeshStandardMaterial({ color: "#d8d4c6", roughness: 0.6 });
    handles.crosswalks = flushInstances(scene, new THREE.BoxGeometry(1.7, 0.03, 0.5), crosswalkMat, sink.crosswalks, { receive: true });

    const sidewalkMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.78, metalness: 0.02 });
    handles.sidewalks = flushInstances(scene, new THREE.BoxGeometry(1, 0.06, 1), sidewalkMat, sink.sidewalks, { receive: true });

    // One shared emissive-style material for every window; colour is raised at night so bloom picks it up.
    const windowMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    handles.windowMaterial = windowMaterial;
    handles.windows = flushInstances(scene, new THREE.BoxGeometry(0.55, 0.85, 0.08), windowMaterial, sink.windows);

    const neonMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", side: THREE.DoubleSide });
    handles.neonMaterial = neonMaterial;
    handles.neon = flushInstances(scene, new THREE.PlaneGeometry(1, 1), neonMaterial, sink.neon);

    const darkMetal = new THREE.MeshStandardMaterial({ color: "#2a323a", roughness: 0.5, metalness: 0.6 });
    flushInstances(scene, new THREE.CylinderGeometry(0.05, 0.08, 1, 6), darkMetal, sink.antennas, { shadow: true });

    const beaconGeometry = new THREE.SphereGeometry(0.22, 8, 6);
    handles.beaconMaterials = [
        new THREE.MeshBasicMaterial({ color: "#ff2a2a" }),
        new THREE.MeshBasicMaterial({ color: "#ff2a2a" }),
    ];
    flushInstances(scene, beaconGeometry, handles.beaconMaterials[0], sink.beaconsA);
    flushInstances(scene, beaconGeometry, handles.beaconMaterials[1], sink.beaconsB);

    flushInstances(scene, new THREE.CylinderGeometry(0.2, 0.32, 2.2, 8), new THREE.MeshStandardMaterial({ color: "#77583a", roughness: 0.8 }), sink.trunks, { shadow: true });
    const crownMat = new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.78 });
    flushInstances(scene, new THREE.SphereGeometry(1.7, 12, 10), crownMat, sink.crownsSphere, { shadow: true, receive: true });
    flushInstances(scene, new THREE.ConeGeometry(1.4, 3.6, 10), crownMat, sink.crownsCone, { shadow: true, receive: true });

    flushInstances(scene, new THREE.CylinderGeometry(0.18, 0.22, 0.8, 8), new THREE.MeshStandardMaterial({ color: "#c9a23a", roughness: 0.5, metalness: 0.4 }), sink.bollards, { shadow: true });

    const benchGeometry = mergeGeometries([
        new THREE.BoxGeometry(1.6, 0.12, 0.5).translate(0, 0.28, 0),
        new THREE.BoxGeometry(1.6, 0.5, 0.1).translate(0, 0.6, -0.24),
        new THREE.BoxGeometry(0.1, 0.3, 0.45).translate(-0.7, 0.1, 0),
        new THREE.BoxGeometry(0.1, 0.3, 0.45).translate(0.7, 0.1, 0),
    ]);
    flushInstances(scene, benchGeometry, new THREE.MeshStandardMaterial({ color: "#8a6a44", roughness: 0.8 }), sink.benches, { shadow: true });

    const puddleMat = new THREE.MeshStandardMaterial({
        color: "#0a0f16",
        roughness: 0.04,
        metalness: 0.3,
        transparent: true,
        opacity: 0,
        depthWrite: false,
    });
    handles.puddleMaterial = puddleMat;
    handles.puddles = flushInstances(scene, new THREE.CircleGeometry(1, 16).rotateX(-Math.PI / 2), puddleMat, sink.puddles, { receive: true });
    if (handles.puddles) handles.puddles.renderOrder = 2;
    return handles;
}

function createBuilding(width, depth, height, x, z, style = {}) {
    const group = new THREE.Group();
    const baseHue = style.baseHue ?? 0.54 + random() * 0.1;
    const saturation = style.saturation ?? 0.18;
    const lightness = style.lightness ?? 0.38 + random() * 0.16;
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(baseHue, saturation, lightness),
            roughness: style.roughness ?? 0.55,
            metalness: style.metalness ?? 0.12,
        })
    );
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const floors = Math.max(1, Math.floor(height / 2.4));
    const columns = Math.max(1, Math.floor(width / 2.2));
    const sideColumns = Math.max(1, Math.floor(depth / 2.2));
    const kind = style.windowKind ?? "mixed";

    const addWindow = (wx, wy, wz, ry) => {
        const warm = kind === "warm" || (kind === "mixed" && random() < 0.35);
        const on = random() > 0.28;
        const base = warm ? [1, 0.72, 0.38] : [0.55, 0.85, 1];
        const k = on ? 0.6 + random() * 0.4 : 0.12;
        sink.windows.push({ x: x + wx, y: wy, z: z + wz, ry, color: [base[0] * k, base[1] * k, base[2] * k] });
    };

    for (let floor = 0; floor < floors; floor += 1) {
        const wy = 1.35 + floor * 2.25;
        for (let column = 0; column < columns; column += 1) {
            const wx = -width / 2 + 1 + column * 2.1;
            if (wx > width / 2 - 0.7 || random() < 0.22) continue;
            addWindow(wx, wy, depth / 2 + 0.045, 0);
            addWindow(wx, wy, -depth / 2 - 0.045, 0);
        }
        for (let column = 0; column < sideColumns; column += 1) {
            const wz = -depth / 2 + 1 + column * 2.1;
            if (wz > depth / 2 - 0.7 || random() < 0.22) continue;
            addWindow(width / 2 + 0.045, wy, wz, Math.PI / 2);
            addWindow(-width / 2 - 0.045, wy, wz, Math.PI / 2);
        }
    }

    if (style.neon) {
        const signCount = 1 + Math.floor(random() * 2);
        for (let i = 0; i < signCount; i += 1) {
            const color = NEON_COLORS[Math.floor(random() * NEON_COLORS.length)];
            const onFront = random() < 0.5;
            const wy = 4 + random() * Math.max(2, height - 9);
            sink.neon.push({
                x: x + (onFront ? (random() - 0.5) * (width - 2) : width / 2 + 0.12),
                y: wy,
                z: onFront ? z + depth / 2 + 0.12 : z + (random() - 0.5) * (depth - 2),
                ry: onFront ? 0 : Math.PI / 2,
                sx: 1.2 + random() * 1.2,
                sy: 0.45 + random() * 0.35,
                color,
            });
        }
    }

    if (style.antenna) {
        const antennaHeight = 2.6 + random() * 2.2;
        sink.antennas.push({ x, y: height + 0.34 + antennaHeight / 2, z, sy: antennaHeight });
        (random() < 0.5 ? sink.beaconsA : sink.beaconsB).push({ x, y: height + 0.34 + antennaHeight + 0.1, z });
    }

    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(width + 0.9, 0.34, depth + 0.9),
        createMaterial(style.roofColor ?? "#10151c", { roughness: 0.45, metalness: 0.25 })
    );
    roof.position.y = height + 0.18;
    roof.castShadow = true;
    group.add(roof);
    group.position.set(x, 0, z);
    return group;
}

function addTree(x, z) {
    const cone = random() < 0.4;
    const scale = 0.85 + random() * 0.6;
    const color = new THREE.Color().setHSL(0.3 + random() * 0.06, 0.45, 0.22 + random() * 0.1);
    sink.trunks.push({ x, y: 1.1, z, sy: scale });
    if (cone) {
        sink.crownsCone.push({ x, y: 1.6 + 2.4 * scale, z, sx: scale, sy: scale, sz: scale, color });
    } else {
        sink.crownsSphere.push({ x, y: 2.7 * scale, z, sx: scale, sy: scale * 0.76, sz: scale, color });
    }
}

function createStreetProp(x, z, variant, kioskAccentMaterial) {
    const group = new THREE.Group();
    const roll = random();

    if (roll < 0.34) {
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.72, 1.05), createMaterial("#26313a", { roughness: 0.64, metalness: 0.18 }));
        base.position.y = 0.38;
        base.castShadow = true;
        group.add(base);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.12, 1.18), kioskAccentMaterial ?? createMaterial("#63c8ff", {
            roughness: 0.26,
            metalness: 0.3,
            emissive: "#1d6f96",
            emissiveIntensity: 0.34,
        }));
        top.position.y = 0.82;
        group.add(top);
        group.userData = {
            radius: 1.15,
            type: "kiosk",
            label: "Kiosk",
            reward: 90,
            color: "#63c8ff",
            destructible: true,
            minImpact: 8.5,
            hitDamageScale: 0.42,
            speedDamping: 0.42,
            particleCount: 16,
        };
    } else if (roll < 0.68) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.9, 8), createMaterial("#151a21", { roughness: 0.5, metalness: 0.4 }));
        post.position.y = 1.45;
        post.castShadow = true;
        group.add(post);
        const sign = new THREE.Mesh(new THREE.BoxGeometry(2.3, 1.0, 0.14), createMaterial(variant % 2 ? "#ffc64d" : "#ff6a4f", {
            roughness: 0.24,
            metalness: 0.22,
            emissive: variant % 2 ? "#6d4914" : "#7b2217",
            emissiveIntensity: 0.42,
        }));
        sign.position.y = 2.6;
        sign.rotation.y = random() * Math.PI;
        group.add(sign);
        group.userData = {
            radius: 0.95,
            type: "sign",
            label: "Werbeschild",
            reward: 70,
            color: variant % 2 ? "#ffc64d" : "#ff6a4f",
            destructible: true,
            minImpact: 5.4,
            hitDamageScale: 0.18,
            speedDamping: 0.7,
            particleCount: 12,
        };
    } else {
        const skip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.88, 1.35), createMaterial("#7b8790", { roughness: 0.72, metalness: 0.08 }));
        skip.position.y = 0.45;
        skip.castShadow = true;
        group.add(skip);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.12, 1.45), createMaterial("#10151c", { roughness: 0.5, metalness: 0.28 }));
        lid.position.y = 0.94;
        group.add(lid);
        group.userData = {
            radius: 1.55,
            type: "dumpster",
            label: "Muellcontainer",
            reward: 80,
            color: "#7b8790",
            destructible: true,
            minImpact: 10.2,
            hitDamageScale: 0.74,
            speedDamping: 0.24,
            particleCount: 20,
            shake: 0.65,
        };
    }

    group.position.set(x, 0, z);
    group.rotation.y = random() * Math.PI;
    return group;
}

function createContainerStack(x, z, materials, levels = 2) {
    const group = new THREE.Group();
    const palettes = [materials.containerBlue, materials.containerRed, materials.containerGreen];
    const rows = 1 + Math.floor(random() * 2);
    const cols = 1 + Math.floor(random() * 2);
    let maxX = 0;
    let maxZ = 0;

    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const levelCount = Math.max(1, levels - Math.floor(random() * 2));
            for (let level = 0; level < levelCount; level += 1) {
                const mesh = new THREE.Mesh(
                    new THREE.BoxGeometry(2.3, 1.1, 1.18),
                    palettes[(row + col + level) % palettes.length]
                );
                mesh.position.set((col - (cols - 1) / 2) * 2.45, 0.56 + level * 1.12, (row - (rows - 1) / 2) * 1.35);
                mesh.castShadow = true;
                mesh.receiveShadow = true;
                group.add(mesh);
                maxX = Math.max(maxX, Math.abs(mesh.position.x) + 1.2);
                maxZ = Math.max(maxZ, Math.abs(mesh.position.z) + 0.7);
            }
        }
    }

    group.position.set(x, 0, z);
    return { mesh: group, radius: Math.max(1.4, Math.max(maxX, maxZ)) };
}

function createCrateStackProp(x, z, levels = 2) {
    const group = new THREE.Group();
    const woodMat = createMaterial("#9a6d42", { roughness: 0.84, metalness: 0.04 });
    for (let level = 0; level < levels; level += 1) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.72, 1.15), woodMat);
        mesh.position.set((level % 2) * 0.18, 0.36 + level * 0.74, (level % 2 ? -0.14 : 0.14));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
    }
    group.position.set(x, 0, z);
    group.rotation.y = random() * Math.PI;
    group.userData = {
        radius: 1.05,
        type: "crate",
        label: "Kistenstapel",
        reward: 65,
        color: "#d9a06a",
        destructible: true,
        minImpact: 4.8,
        hitDamageScale: 0.1,
        speedDamping: 0.76,
        particleCount: 18,
    };
    return group;
}

function createHarborCrateProp(x, z, variant) {
    const group = createCrateStackProp(x, z, 2 + (variant % 2));
    group.userData = {
        ...group.userData,
        type: "harborCrate",
        label: "Hafenkiste",
        reward: 78,
        color: "#8bc7df",
        minImpact: 5.6,
        hitDamageScale: 0.14,
        speedDamping: 0.68,
        particleCount: 20,
        shake: 0.3,
    };
    return group;
}

function createFenceSegment(x, z, axis = "x", sections = 4) {
    const group = new THREE.Group();
    const postMat = createMaterial("#3e454d", { roughness: 0.66, metalness: 0.16 });
    const railMat = createMaterial("#9eb2bd", { roughness: 0.38, metalness: 0.24 });
    const spacing = 1.15;
    const total = (sections - 1) * spacing;
    for (let index = 0; index < sections; index += 1) {
        const offset = index * spacing - total / 2;
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.2, 0.14), postMat);
        if (axis === "x") post.position.set(offset, 0.6, 0);
        else post.position.set(0, 0.6, offset);
        post.castShadow = true;
        group.add(post);
    }
    for (const height of [0.48, 0.84]) {
        const rail = new THREE.Mesh(
            axis === "x" ? new THREE.BoxGeometry(total + 0.35, 0.09, 0.12) : new THREE.BoxGeometry(0.12, 0.09, total + 0.35),
            railMat
        );
        rail.position.y = height;
        rail.castShadow = true;
        group.add(rail);
    }
    group.position.set(x, 0, z);
    group.userData = {
        radius: Math.max(0.8, total / 2 + 0.3),
        type: "fence",
        label: "Zaun",
        reward: 58,
        color: "#c2d2da",
        destructible: true,
        minImpact: 6.2,
        hitDamageScale: 0.2,
        speedDamping: 0.62,
        particleCount: 16,
    };
    return group;
}

function createConstructionBeacon(x, z, variant) {
    const group = new THREE.Group();
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.82, 12), createMaterial("#ff9c45", { roughness: 0.48, metalness: 0.08 }));
    cone.position.y = 0.41;
    cone.castShadow = true;
    group.add(cone);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.12, 12), createMaterial(variant % 2 ? "#f7fbff" : "#10151c", { roughness: 0.3, metalness: 0.16 }));
    band.position.y = 0.45;
    group.add(band);
    group.position.set(x, 0, z);
    group.userData = {
        radius: 0.48,
        type: "constructionBeacon",
        label: "Baustellenbake",
        reward: 32,
        color: "#ffb25c",
        destructible: true,
        minImpact: 2.8,
        hitDamageScale: 0.04,
        speedDamping: 0.9,
        particleCount: 10,
    };
    return group;
}

function createPavilion(x, z) {
    const group = new THREE.Group();
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.35, 1.1, 8), createMaterial("#7f5f3c", { roughness: 0.72, metalness: 0.08 }));
    roof.position.y = 2.6;
    roof.castShadow = true;
    group.add(roof);

    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 0.22, 20), createMaterial("#d9cfb0", { roughness: 0.82, metalness: 0.04 }));
    deck.position.y = 0.18;
    deck.receiveShadow = true;
    group.add(deck);

    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2.2, 8), createMaterial("#ece4cf", { roughness: 0.46, metalness: 0.06 }));
        post.position.set(Math.cos(angle) * 1.55, 1.15, Math.sin(angle) * 1.55);
        post.castShadow = true;
        group.add(post);
    }

    group.position.set(x, 0, z);
    return group;
}

function createDockCrane(x, z, material) {
    const group = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7.8, 0.9), material);
    tower.position.y = 3.9;
    tower.castShadow = true;
    group.add(tower);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.48, 0.48), material);
    arm.position.set(2.3, 7.1, 0);
    arm.castShadow = true;
    group.add(arm);

    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.4, 0.12), createMaterial("#f7fbff", { roughness: 0.16, metalness: 0.62 }));
    hook.position.set(4.7, 5.7, 0);
    group.add(hook);
    group.position.set(x, 0, z);
    return group;
}

function createDockRamp(x, z, material) {
    const group = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.3, 5.2), material);
    deck.position.y = 0.6;
    deck.rotation.x = -0.34;
    deck.castShadow = true;
    deck.receiveShadow = true;
    group.add(deck);

    const support = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.46, 1.2), createMaterial("#424d58", { roughness: 0.68, metalness: 0.12 }));
    support.position.set(0, 0.24, -2.1);
    group.add(support);
    group.position.set(x, 0, z);
    return group;
}

let lampPoolGeometry = null;
let lampPoolTexture = null;
const lampPoolMaterials = new Map();

function getLampPoolGeometry() {
    if (!lampPoolGeometry) {
        lampPoolGeometry = new THREE.PlaneGeometry(10, 10);
        markShared(lampPoolGeometry);
    }
    return lampPoolGeometry;
}

function getLampPoolMaterial(tint) {
    if (!lampPoolTexture) {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const context = canvas.getContext("2d");
        const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, "rgba(255,255,255,0.9)");
        gradient.addColorStop(0.45, "rgba(255,255,255,0.28)");
        gradient.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = gradient;
        context.fillRect(0, 0, 64, 64);
        lampPoolTexture = new THREE.CanvasTexture(canvas);
    }
    let material = lampPoolMaterials.get(tint);
    if (!material) {
        material = new THREE.MeshBasicMaterial({
            color: tint,
            map: lampPoolTexture,
            transparent: true,
            opacity: 0.42,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        markShared(material);
        lampPoolMaterials.set(tint, material);
    }
    return material;
}

function createLamp(scene, obstacles, x, z, tint = "#ffc64d") {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.5, 8), createMaterial("#10151c", { roughness: 0.45, metalness: 0.25 }));
    pole.position.y = 2.25;
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), createMaterial("#ffe9b0", { emissive: tint, emissiveIntensity: 0.82 }));
    lamp.position.y = 4.55;
    group.add(lamp);
    // Fake light pool on the ground instead of a PointLight: ~50 real lights made every
    // material shader loop over all of them (and recompile when a lamp was destroyed).
    const pool = new THREE.Mesh(getLampPoolGeometry(), getLampPoolMaterial(tint));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.16;
    pool.renderOrder = 1;
    group.add(pool);
    group.position.set(x, 0, z);
    scene.add(group);
    obstacles.push({
        x,
        z,
        radius: 0.75,
        type: "lamp",
        label: "Laterne",
        reward: 45,
        color: tint,
        destructible: true,
        minImpact: 6.8,
        hitDamageScale: 0.34,
        speedDamping: 0.58,
        particleCount: 18,
        shake: 0.48,
        mesh: group,
    });
}

function createPoiMarker(poi) {
    const group = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 0.18, 28), createMaterial(poi.color, {
        roughness: 0.32,
        metalness: 0.36,
        emissive: poi.color,
        emissiveIntensity: 0.28,
    }));
    pad.receiveShadow = true;
    group.add(pad);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.1, 0.13, 10, 32), createMaterial("#f7fbff", {
        roughness: 0.18,
        metalness: 0.7,
        emissive: poi.color,
        emissiveIntensity: 0.25,
    }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    group.add(ring);
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 5.6, 10), createMaterial("#f7fbff", {
        emissive: poi.color,
        emissiveIntensity: 0.7,
    }));
    beacon.position.y = 2.9;
    group.add(beacon);
    group.position.set(poi.x, 0.12, poi.z);
    group.userData.poi = poi;
    return group;
}

function getDistrictForPosition(x, z) {
    const sx = x < 0 ? -1 : 1;
    const sz = z < 0 ? -1 : 1;
    return DISTRICTS.find((district) => district.x === sx && district.z === sz) ?? DISTRICTS[0];
}

function shuffle(items) {
    const next = [...items];
    for (let index = next.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(random() * (index + 1));
        const value = next[index];
        next[index] = next[swapIndex];
        next[swapIndex] = value;
    }
    return next;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function createScannerZones(scene, scannerZones) {
    const definitions = [
        { x: 26, z: 26, radius: 8.4, districtId: "downtown", label: "Downtown Scan", heatBoost: 0.9, color: "#63c8ff" },
        { x: -26, z: 26, radius: 9.2, districtId: "industrial", label: "Werkhof Scan", heatBoost: 1.05, color: "#ffb25c" },
        { x: -26, z: -26, radius: 8.8, districtId: "harbor", label: "Harbor Customs", heatBoost: 1.15, color: "#7fd6ff" },
    ];

    for (const zone of definitions) {
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(zone.radius, 0.2, 12, 42),
            createMaterial(zone.color, {
                roughness: 0.18,
                metalness: 0.56,
                emissive: zone.color,
                emissiveIntensity: 0.24,
                transparent: true,
                opacity: 0.42,
            })
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.set(zone.x, 0.18, zone.z);
        scene.add(ring);

        const core = new THREE.Mesh(
            new THREE.CylinderGeometry(zone.radius * 0.78, zone.radius * 0.78, 0.04, 28),
            createMaterial(zone.color, {
                roughness: 0.92,
                metalness: 0.04,
                transparent: true,
                opacity: 0.08,
            })
        );
        core.position.set(zone.x, 0.05, zone.z);
        scene.add(core);

        scannerZones.push({ ...zone, ring, core, pulse: random() * Math.PI * 2 });
    }
}

function createLandmarkTower(scene, x, z) {
    const group = new THREE.Group();

    // Wide base section
    const base = new THREE.Mesh(
        new THREE.BoxGeometry(9.5, 18, 9.5),
        new THREE.MeshStandardMaterial({ color: "#1a2438", roughness: 0.32, metalness: 0.55 })
    );
    base.position.y = 9;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    // Mid section with glass
    const mid = new THREE.Mesh(
        new THREE.BoxGeometry(7, 16, 7),
        new THREE.MeshStandardMaterial({ color: "#1e3558", roughness: 0.22, metalness: 0.65 })
    );
    mid.position.y = 26;
    mid.castShadow = true;
    group.add(mid);

    // Glass facade accents
    for (const side of [-1, 1]) {
        const glass = new THREE.Mesh(
            new THREE.BoxGeometry(5.6, 14, 0.1),
            new THREE.MeshStandardMaterial({ color: "#63c8ff", roughness: 0.08, metalness: 0.72, emissive: "#1a4d6e", emissiveIntensity: 0.3, transparent: true, opacity: 0.72 })
        );
        glass.position.set(0, 26, side * 3.55);
        group.add(glass);
        const glassX = glass.clone();
        glassX.position.set(side * 3.55, 26, 0);
        glassX.rotation.y = Math.PI / 2;
        group.add(glassX);
    }

    // Narrow upper tower
    const top = new THREE.Mesh(
        new THREE.BoxGeometry(4, 14, 4),
        new THREE.MeshStandardMaterial({ color: "#10192e", roughness: 0.18, metalness: 0.72 })
    );
    top.position.y = 41;
    top.castShadow = true;
    group.add(top);

    // Neon crown — red emissive ring
    const crownMat = createMaterial("#ff3055", { emissive: "#ff3055", emissiveIntensity: 1.2, roughness: 0.14, metalness: 0.4 });
    const crown = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.6, 5.2), crownMat);
    crown.position.y = 48.5;
    group.add(crown);

    // Spire
    const spire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.5, 7, 8),
        createMaterial("#e0e8f0", { roughness: 0.24, metalness: 0.68 })
    );
    spire.position.y = 52.5;
    spire.castShadow = true;
    group.add(spire);

    // Point light at crown
    const crownLight = new THREE.PointLight("#ff3055", 1.4, 48);
    crownLight.position.y = 50;
    group.add(crownLight);

    group.position.set(x, 0, z);
    scene.add(group);
    return group;
}

function createSmokestack(scene, objects, x, z) {
    const group = new THREE.Group();

    // Chimney body
    const chimney = new THREE.Mesh(
        new THREE.CylinderGeometry(1.05, 1.55, 26, 14),
        createMaterial("#2a2522", { roughness: 0.82, metalness: 0.12 })
    );
    chimney.position.y = 13;
    chimney.castShadow = true;
    group.add(chimney);

    // Red warning band
    const band = new THREE.Mesh(
        new THREE.CylinderGeometry(1.12, 1.12, 0.6, 14),
        createMaterial("#c23030", { roughness: 0.42, metalness: 0.18 })
    );
    band.position.y = 23.5;
    group.add(band);

    // Warning light at top
    const warningLight = new THREE.PointLight("#ff4444", 0.7, 28);
    warningLight.position.y = 28;
    group.add(warningLight);

    // Base platform
    const basePlatform = new THREE.Mesh(
        new THREE.BoxGeometry(5.5, 1.8, 5.5),
        createMaterial("#38322e", { roughness: 0.78, metalness: 0.14 })
    );
    basePlatform.position.y = 0.9;
    basePlatform.castShadow = true;
    group.add(basePlatform);

    group.position.set(x, 0, z);
    scene.add(group);
    objects.push(group);
    return group;
}

function appendObstacleFromMesh(obstacles, mesh, x, z) {
    obstacles.push({
        x,
        z,
        mesh,
        ...mesh.userData,
    });
}

function createShip(scene, objects) {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4, 2.4, 24), createMaterial("#7a2b2b", { roughness: 0.6, metalness: 0.3 }));
    hull.position.y = 0.6;
    hull.castShadow = true;
    group.add(hull);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.2, 22), createMaterial("#3a3f45", { roughness: 0.8 }));
    deck.position.y = 1.9;
    group.add(deck);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 4), createMaterial("#e6ebef", { roughness: 0.5 }));
    cabin.position.set(0, 3.5, 8);
    cabin.castShadow = true;
    group.add(cabin);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 2.2, 10), createMaterial("#d9a43a", { roughness: 0.5 }));
    funnel.position.set(0, 5.6, 8.6);
    group.add(funnel);
    group.position.set(-CONFIG.map.size / 2 - 4.5, 0, -14);
    scene.add(group);
    objects.push(group);
}
