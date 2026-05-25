import * as THREE from "three";
import { CONFIG, DISTRICTS, POIS } from "./config.js";
import { createMaterial } from "./vehicles.js";

export function createWorld(scene, sharedMaterials) {
    const buildings = [];
    const obstacles = [];
    const objects = [];
    const shortcutZones = [];
    const districtMaterials = createDistrictMaterials(sharedMaterials);

    const ground = new THREE.Mesh(
        new THREE.BoxGeometry(CONFIG.map.size + 32, 0.28, CONFIG.map.size + 32),
        sharedMaterials.grass
    );
    ground.position.y = -0.16;
    ground.receiveShadow = true;
    scene.add(ground);

    for (const district of DISTRICTS) {
        const districtMat = createMaterial(district.color, {
            roughness: 0.9,
            metalness: 0.02,
            transparent: true,
            opacity: 0.15,
        });
        const marker = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.size / 2, 0.03, CONFIG.map.size / 2), districtMat);
        marker.position.set(district.x * CONFIG.map.size / 4, -0.005, district.z * CONFIG.map.size / 4);
        marker.receiveShadow = true;
        scene.add(marker);
    }

    for (const sx of CONFIG.map.streets) {
        const road = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.streetWidth, 0.08, CONFIG.map.size + 16), sharedMaterials.asphalt);
        road.position.set(sx, 0.01, 0);
        road.receiveShadow = true;
        scene.add(road);
        addRoadMarkings(scene, sharedMaterials, true, sx);
    }

    for (const sz of CONFIG.map.streets) {
        const road = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.size + 16, 0.09, CONFIG.map.streetWidth), sharedMaterials.asphalt);
        road.position.set(0, 0.02, sz);
        road.receiveShadow = true;
        scene.add(road);
        addRoadMarkings(scene, sharedMaterials, false, sz);
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
            createLamp(scene, obstacles, sx + 8.8, sz + 8.8, district.color);
            createLamp(scene, obstacles, sx - 8.8, sz - 8.8, district.color);
        }
    }

    for (const poi of POIS) {
        const marker = createPoiMarker(poi);
        scene.add(marker);
        objects.push(marker);
    }

    return { buildings, obstacles, objects, pointsOfInterest: POIS, districts: DISTRICTS, shortcutZones };
}

export function insideBuilding(world, x, z, radius) {
    for (const building of world.buildings) {
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
    for (const building of world.buildings) {
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
    for (const obstacle of world.obstacles) {
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
    const buildingCount = 2 + Math.floor(Math.random() * 2) + (Math.random() < 0.5 ? 1 : 0);

    for (let index = 0; index < buildingCount; index += 1) {
        const slot = slots[index];
        const width = 4.4 + Math.random() * 2.1;
        const depth = 4.3 + Math.random() * 2.4;
        const height = 14 + Math.random() * 18;
        const x = bx + slot.x + (Math.random() - 0.5) * 0.8;
        const z = bz + slot.z + (Math.random() - 0.5) * 0.8;
        const tower = createBuilding(width, depth, height, x, z, {
            baseHue: 0.57 + Math.random() * 0.05,
            saturation: 0.16,
            lightness: 0.34 + Math.random() * 0.1,
            roofColor: "#0f141b",
            windowMaterial: materials.skylineGlass,
        });
        scene.add(tower);
        objects.push(tower);
        buildings.push({ x, z, hw: width / 2 + 0.8, hd: depth / 2 + 0.8 });
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
        const x = bx + (Math.random() - 0.5) * (CONFIG.map.blockSize - 2.5);
        const z = bz + (Math.random() - 0.5) * (CONFIG.map.blockSize - 2.5);
        if (!insideBuilding({ buildings }, x, z, 1.4)) {
            const prop = createStreetProp(x, z, index, materials.kioskAccent);
            scene.add(prop);
            objects.push(prop);
            obstacles.push({
                x,
                z,
                radius: prop.userData.radius,
                type: prop.userData.type,
                label: prop.userData.label,
                reward: prop.userData.reward,
                color: prop.userData.color,
                destructible: true,
                mesh: prop,
            });
        }
    }
}

function decorateIndustrialBlock(scene, objects, buildings, obstacles, materials, bx, bz) {
    const stripeMat = createMaterial("#d9c8a1", { roughness: 0.72, metalness: 0.04 });
    for (const offset of [-3.8, 0, 3.8]) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.03, CONFIG.map.blockSize * 0.8), stripeMat);
        stripe.position.set(bx + offset, 0.11, bz);
        stripe.receiveShadow = true;
        scene.add(stripe);
    }

    const warehouseCount = 1 + Math.floor(Math.random() * 2);
    const warehouseSlots = shuffle([
        { x: -3.6, z: 0.8 },
        { x: 3.2, z: -2.4 },
        { x: 0, z: 3.1 },
    ]);

    for (let index = 0; index < warehouseCount; index += 1) {
        const slot = warehouseSlots[index];
        const width = 8.4 + Math.random() * 3.5;
        const depth = 6.4 + Math.random() * 2.7;
        const height = 5.4 + Math.random() * 3.6;
        const x = bx + slot.x;
        const z = bz + slot.z;
        const warehouse = createBuilding(width, depth, height, x, z, {
            baseHue: 0.08 + Math.random() * 0.04,
            saturation: 0.1,
            lightness: 0.38 + Math.random() * 0.06,
            roofColor: "#252a30",
            windowMaterial: createMaterial("#f0d48a", {
                roughness: 0.18,
                metalness: 0.3,
                emissive: "#8d6928",
                emissiveIntensity: 0.22,
            }),
        });
        scene.add(warehouse);
        objects.push(warehouse);
        buildings.push({ x, z, hw: width / 2 + 0.8, hd: depth / 2 + 0.8 });
    }

    const stacks = 3 + Math.floor(Math.random() * 2);
    for (let index = 0; index < stacks; index += 1) {
        const x = bx + (Math.random() - 0.5) * (CONFIG.map.blockSize - 5);
        const z = bz + (Math.random() - 0.5) * (CONFIG.map.blockSize - 5);
        if (insideBuilding({ buildings }, x, z, 1.6)) continue;
        const stack = createContainerStack(x, z, materials, 2 + Math.floor(Math.random() * 2));
        scene.add(stack.mesh);
        objects.push(stack.mesh);
        obstacles.push({ x, z, radius: stack.radius, type: "containerStack", label: "Container", reward: 0, color: "#7fa0b2", mesh: stack.mesh });
    }
}

function decorateParkBlock(scene, objects, buildings, obstacles, shortcutZones, materials, bx, bz) {
    const pathOffsetZ = (Math.random() - 0.5) * 2;
    const pathX = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 0.9, 0.04, 2.4), materials.parkPath);
    pathX.position.set(bx, 0.12, bz + pathOffsetZ);
    pathX.receiveShadow = true;
    scene.add(pathX);
    shortcutZones.push({ x: bx, z: bz + pathOffsetZ, width: CONFIG.map.blockSize * 0.9, depth: 2.8 });

    const pathOffsetX = (Math.random() - 0.5) * 2;
    const pathZ = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.04, CONFIG.map.blockSize * 0.9), materials.parkPath);
    pathZ.position.set(bx + pathOffsetX, 0.12, bz);
    pathZ.receiveShadow = true;
    scene.add(pathZ);
    shortcutZones.push({ x: bx + pathOffsetX, z: bz, width: 2.8, depth: CONFIG.map.blockSize * 0.9 });

    if (Math.random() < 0.55) {
        const pond = new THREE.Mesh(
            new THREE.CylinderGeometry(2.2, 2.8, 0.08, 22),
            createMaterial("#4ea2b8", { roughness: 0.22, metalness: 0.22, emissive: "#1e4a5d", emissiveIntensity: 0.16 })
        );
        pond.scale.z = 1.35;
        pond.position.set(bx + (Math.random() - 0.5) * 5, 0.08, bz + (Math.random() - 0.5) * 5);
        pond.receiveShadow = true;
        scene.add(pond);
        objects.push(pond);
    }

    if (Math.random() < 0.4) {
        const pavilion = createPavilion(bx + (Math.random() - 0.5) * 3, bz + (Math.random() - 0.5) * 3);
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

    const treeCount = 6 + Math.floor(Math.random() * 4);
    for (let index = 0; index < treeCount; index += 1) {
        const x = bx + (Math.random() - 0.5) * (CONFIG.map.blockSize - 2);
        const z = bz + (Math.random() - 0.5) * (CONFIG.map.blockSize - 2);
        if (!insideBuilding({ buildings }, x, z, 1.7)) {
            const tree = createTree(x, z);
            scene.add(tree);
            obstacles.push({ x, z, radius: 1.8, type: "tree" });
        }
    }
}

function decorateHarborBlock(scene, objects, buildings, obstacles, materials, bx, bz) {
    const isWestEdge = bx < -20;
    const isNorthEdge = bz < -20;

    if (isWestEdge) {
        const water = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 0.34, 0.05, CONFIG.map.blockSize * 1.02), materials.harborWater);
        water.position.set(bx - 5.8, 0.03, bz);
        scene.add(water);

        const edge = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, CONFIG.map.blockSize * 0.96), materials.harborEdge);
        edge.position.set(bx - 2.6, 0.18, bz);
        edge.castShadow = true;
        scene.add(edge);
    }

    if (isNorthEdge) {
        const water = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 1.02, 0.05, CONFIG.map.blockSize * 0.34), materials.harborWater);
        water.position.set(bx, 0.03, bz - 5.8);
        scene.add(water);

        const edge = new THREE.Mesh(new THREE.BoxGeometry(CONFIG.map.blockSize * 0.96, 0.26, 0.28), materials.harborEdge);
        edge.position.set(bx, 0.18, bz - 2.6);
        edge.castShadow = true;
        scene.add(edge);
    }

    const warehouseWidth = 8 + Math.random() * 2.4;
    const warehouseDepth = 6.2 + Math.random() * 2;
    const warehouseHeight = 5.6 + Math.random() * 2.6;
    const warehouseX = bx + 3.3;
    const warehouseZ = bz + 2.2;
    const warehouse = createBuilding(warehouseWidth, warehouseDepth, warehouseHeight, warehouseX, warehouseZ, {
        baseHue: 0.56,
        saturation: 0.11,
        lightness: 0.42,
        roofColor: "#24303a",
        windowMaterial: createMaterial("#b8dcff", { roughness: 0.2, metalness: 0.36, emissive: "#28465c", emissiveIntensity: 0.16 }),
    });
    scene.add(warehouse);
    objects.push(warehouse);
    buildings.push({ x: warehouseX, z: warehouseZ, hw: warehouseWidth / 2 + 0.8, hd: warehouseDepth / 2 + 0.8 });

    const stacks = 2 + Math.floor(Math.random() * 3);
    for (let index = 0; index < stacks; index += 1) {
        const x = bx + (Math.random() - 0.5) * 8 - 2;
        const z = bz + (Math.random() - 0.5) * 7 + 1;
        if (insideBuilding({ buildings }, x, z, 1.6)) continue;
        const stack = createContainerStack(x, z, materials, 2 + Math.floor(Math.random() * 2));
        scene.add(stack.mesh);
        objects.push(stack.mesh);
        obstacles.push({ x, z, radius: stack.radius, type: "dockContainer", label: "Dock-Container", reward: 0, color: "#5a8ba8", mesh: stack.mesh });
    }

    if (Math.random() < 0.8) {
        const crane = createDockCrane(bx - 3.6, bz + 3.5, materials.crane);
        scene.add(crane);
        objects.push(crane);
        obstacles.push({ x: bx - 3.6, z: bz + 3.5, radius: 1.45, type: "crane", label: "Kran", reward: 0, color: "#d29549", mesh: crane });
    }

    if (Math.random() < 0.7) {
        const ramp = createDockRamp(bx - 0.4, bz - 3.6, materials.ramp);
        scene.add(ramp);
        objects.push(ramp);
    }
}

function addRoadMarkings(scene, sharedMaterials, vertical, pos) {
    for (let value = -CONFIG.map.size / 2; value <= CONFIG.map.size / 2; value += 6) {
        const line = new THREE.Mesh(
            vertical ? new THREE.BoxGeometry(0.22, 0.045, 2.8) : new THREE.BoxGeometry(2.8, 0.045, 0.22),
            sharedMaterials.line
        );
        line.position.set(vertical ? pos : value, 0.09, vertical ? value : pos);
        line.receiveShadow = true;
        scene.add(line);
    }
}

function createBuilding(width, depth, height, x, z, style = {}) {
    const group = new THREE.Group();
    const baseHue = style.baseHue ?? 0.54 + Math.random() * 0.1;
    const saturation = style.saturation ?? 0.18;
    const lightness = style.lightness ?? 0.38 + Math.random() * 0.16;
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

    const windowMat = style.windowMaterial ?? createMaterial(Math.random() < 0.35 ? "#ffd98a" : "#b8dcff", {
        roughness: 0.16,
        metalness: 0.5,
        emissive: Math.random() < 0.35 ? "#d58932" : "#32506d",
        emissiveIntensity: 0.18,
    });
    const windowGeo = new THREE.BoxGeometry(0.55, 0.85, 0.08);
    const floors = Math.max(1, Math.floor(height / 2.4));
    const columns = Math.max(1, Math.floor(width / 2.2));

    for (let floor = 0; floor < floors; floor += 1) {
        for (let column = 0; column < columns; column += 1) {
            const wx = -width / 2 + 1 + column * 2.1;
            const wy = 1.35 + floor * 2.25;
            if (wx > width / 2 - 0.7 || Math.random() < 0.22) continue;
            const front = new THREE.Mesh(windowGeo, windowMat);
            front.position.set(wx, wy, depth / 2 + 0.045);
            group.add(front);
            const back = front.clone();
            back.position.z = -depth / 2 - 0.045;
            group.add(back);
        }
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

function createTree(x, z) {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.32, 2.2, 9), createMaterial("#77583a", { roughness: 0.8 }));
    trunk.position.y = 1.1;
    trunk.castShadow = true;
    group.add(trunk);
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1.35 + Math.random() * 0.9, 12, 10), createMaterial("#2f7d44", { roughness: 0.76 }));
    crown.position.y = 2.7;
    crown.scale.y = 0.76;
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(crown);
    group.position.set(x, 0, z);
    return group;
}

function createStreetProp(x, z, variant, kioskAccentMaterial) {
    const group = new THREE.Group();
    const roll = Math.random();

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
        group.userData = { radius: 1.15, type: "kiosk", label: "Kiosk", reward: 90, color: "#63c8ff" };
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
        sign.rotation.y = Math.random() * Math.PI;
        group.add(sign);
        group.userData = { radius: 0.95, type: "sign", label: "Werbeschild", reward: 70, color: variant % 2 ? "#ffc64d" : "#ff6a4f" };
    } else {
        const skip = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.88, 1.35), createMaterial("#7b8790", { roughness: 0.72, metalness: 0.08 }));
        skip.position.y = 0.45;
        skip.castShadow = true;
        group.add(skip);
        const lid = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.12, 1.45), createMaterial("#10151c", { roughness: 0.5, metalness: 0.28 }));
        lid.position.y = 0.94;
        group.add(lid);
        group.userData = { radius: 1.55, type: "dumpster", label: "Container", reward: 80, color: "#7b8790" };
    }

    group.position.set(x, 0, z);
    group.rotation.y = Math.random() * Math.PI;
    return group;
}

function createContainerStack(x, z, materials, levels = 2) {
    const group = new THREE.Group();
    const palettes = [materials.containerBlue, materials.containerRed, materials.containerGreen];
    const rows = 1 + Math.floor(Math.random() * 2);
    const cols = 1 + Math.floor(Math.random() * 2);
    let maxX = 0;
    let maxZ = 0;

    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
            const levelCount = Math.max(1, levels - Math.floor(Math.random() * 2));
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

function createLamp(scene, obstacles, x, z, tint = "#ffc64d") {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.5, 8), createMaterial("#10151c", { roughness: 0.45, metalness: 0.25 }));
    pole.position.y = 2.25;
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), createMaterial("#ffe9b0", { emissive: tint, emissiveIntensity: 0.82 }));
    lamp.position.y = 4.55;
    group.add(lamp);
    const light = new THREE.PointLight(tint, 0.55, 12);
    light.position.y = 4.3;
    group.add(light);
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
        const swapIndex = Math.floor(Math.random() * (index + 1));
        const value = next[index];
        next[index] = next[swapIndex];
        next[swapIndex] = value;
    }
    return next;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
