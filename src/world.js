import * as THREE from "three";
import { CONFIG, DISTRICTS, POIS } from "./config.js";
import { createMaterial } from "./vehicles.js";

export function createWorld(scene, sharedMaterials) {
    const buildings = [];
    const obstacles = [];
    const objects = [];

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
            opacity: 0.18,
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
            const sidewalk = new THREE.Mesh(
                new THREE.BoxGeometry(CONFIG.map.blockSize, 0.16, CONFIG.map.blockSize),
                sharedMaterials.sidewalk
            );
            sidewalk.position.set(bx, 0.09, bz);
            sidewalk.receiveShadow = true;
            scene.add(sidewalk);

            const buildingCount = 1 + Math.floor(Math.random() * 3);
            for (let index = 0; index < buildingCount; index += 1) {
                const width = 4.6 + Math.random() * 5.5;
                const depth = 4.6 + Math.random() * 5.5;
                const height = 4 + Math.random() * 20;
                const x = bx + (Math.random() - 0.5) * (CONFIG.map.blockSize - width - 2);
                const z = bz + (Math.random() - 0.5) * (CONFIG.map.blockSize - depth - 2);
                const building = createBuilding(width, depth, height, x, z);
                scene.add(building);
                objects.push(building);
                buildings.push({ x, z, hw: width / 2 + 0.8, hd: depth / 2 + 0.8 });
            }

            for (let index = 0; index < 3; index += 1) {
                const x = bx + (Math.random() - 0.5) * (CONFIG.map.blockSize - 2);
                const z = bz + (Math.random() - 0.5) * (CONFIG.map.blockSize - 2);
                if (!insideBuilding({ buildings }, x, z, 1.6)) {
                    const tree = createTree(x, z);
                    scene.add(tree);
                    obstacles.push({ x, z, radius: 1.8, type: "tree" });
                }
            }

            for (let index = 0; index < 2; index += 1) {
                const x = bx + (Math.random() - 0.5) * (CONFIG.map.blockSize - 3);
                const z = bz + (Math.random() - 0.5) * (CONFIG.map.blockSize - 3);
                if (!insideBuilding({ buildings }, x, z, 1.4)) {
                    const prop = createStreetProp(x, z, index);
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
    }

    for (const sx of CONFIG.map.streets) {
        for (const sz of CONFIG.map.streets) {
            createLamp(scene, obstacles, sx + 8.8, sz + 8.8);
            createLamp(scene, obstacles, sx - 8.8, sz - 8.8);
        }
    }

    for (const poi of POIS) {
        const marker = createPoiMarker(poi);
        scene.add(marker);
        objects.push(marker);
    }

    return { buildings, obstacles, objects, pointsOfInterest: POIS };
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

function createBuilding(width, depth, height, x, z) {
    const group = new THREE.Group();
    const baseHue = 0.54 + Math.random() * 0.1;
    const body = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, depth),
        new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(baseHue, 0.18, 0.38 + Math.random() * 0.16),
            roughness: 0.55,
            metalness: 0.12,
        })
    );
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const windowMat = createMaterial(Math.random() < 0.35 ? "#ffd98a" : "#b8dcff", {
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

    const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.9, 0.34, depth + 0.9), createMaterial("#10151c", { roughness: 0.45, metalness: 0.25 }));
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

function createStreetProp(x, z, variant) {
    const group = new THREE.Group();
    const roll = Math.random();

    if (roll < 0.34) {
        const base = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.72, 1.05), createMaterial("#26313a", { roughness: 0.64, metalness: 0.18 }));
        base.position.y = 0.38;
        base.castShadow = true;
        group.add(base);
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.76, 0.12, 1.18), createMaterial("#63c8ff", {
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

function createLamp(scene, obstacles, x, z) {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 4.5, 8), createMaterial("#10151c", { roughness: 0.45, metalness: 0.25 }));
    pole.position.y = 2.25;
    pole.castShadow = true;
    group.add(pole);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), createMaterial("#ffe9b0", { emissive: "#ffc64d", emissiveIntensity: 0.8 }));
    lamp.position.y = 4.55;
    group.add(lamp);
    const light = new THREE.PointLight("#ffc64d", 0.55, 12);
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
        color: "#ffe9b0",
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

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
