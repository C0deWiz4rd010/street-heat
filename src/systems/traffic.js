import { CAR_MODELS, CONFIG, DISTRICTS } from "../config.js";
import { distanceSq, wrapAngle, axisVelocity, axisYaw } from "../util/math.js";
import { createCar } from "../vehicles.js";
import { pushOutBuildings } from "../world.js";

/** Ambient traffic: spawning per district, street-axis driving, braking for obstacles, separation and near misses. */
export function createTrafficSystem({
    traffic,
    state,
    world,
    triggerNearMiss,
    damagePlayer,
    crashFx,
    spawnParticle,
    registerTrafficCrash,
    sharedMaterials,
    addAmbientHeadlights,
    scene,
}) {
    function resolveTrafficSeparation() {
        for (let i = 0; i < traffic.length; i++) {
            const a = traffic[i];
            for (let j = i + 1; j < traffic.length; j++) {
                const b = traffic[j];
                const dx = b.x - a.x;
                const dz = b.z - a.z;
                const d2 = dx * dx + dz * dz;
                const minDist = (a.radius ?? 2.1) + (b.radius ?? 2.1);
                if (d2 >= minDist * minDist || d2 < 0.0001) continue;

                const dist = Math.sqrt(d2);
                const nx = dx / dist;
                const nz = dz / dist;
                const overlap = minDist - dist;
                const massA = a.model?.mass ?? 1.0;
                const massB = b.model?.mass ?? 1.0;
                const total = massA + massB;

                a.x -= nx * overlap * (massB / total);
                a.z -= nz * overlap * (massB / total);
                b.x += nx * overlap * (massA / total);
                b.z += nz * overlap * (massA / total);

                const avx = a.axis === "x" ? a.speed * a.direction + a.pushVx : a.pushVx;
                const avz = a.axis === "z" ? a.speed * a.direction + a.pushVz : a.pushVz;
                const bvx = b.axis === "x" ? b.speed * b.direction + b.pushVx : b.pushVx;
                const bvz = b.axis === "z" ? b.speed * b.direction + b.pushVz : b.pushVz;
                const relVn = (bvx - avx) * nx + (bvz - avz) * nz;

                if (relVn < 0) {
                    const impulse = -0.55 * relVn;
                    a.pushVx -= (impulse * nx) / massA;
                    a.pushVz -= (impulse * nz) / massA;
                    b.pushVx += (impulse * nx) / massB;
                    b.pushVz += (impulse * nz) / massB;
                    a.speed = Math.max(0, a.speed - Math.abs(relVn) * 0.35);
                    b.speed = Math.max(0, b.speed - Math.abs(relVn) * 0.35);
                }
            }
        }
    }

    function update(dt) {
        const playerModel = CAR_MODELS[state.playerModelIndex];
        const playerMass = playerModel.mass ?? 1.0;
        const playerSpeedMag = state.player.speedMag ?? Math.abs(state.player.speed);
        const pushDecay = Math.max(0, 1 - dt * 5.5);

        for (const car of traffic) {
            car.cooldown = Math.max(0, car.cooldown - dt);
            car.nearMissCooldown = Math.max(0, car.nearMissCooldown - dt);

            // Recover speed toward natural cruise speed
            if (car.speed < car.naturalSpeed) {
                car.speed = Math.min(car.naturalSpeed, car.speed + dt * 2.2);
            }

            // Look-ahead braking: slow down when another car is directly ahead on same axis
            const lookDist = 5.5 + car.speed * 0.45;
            const lookX = car.axis === "x" ? car.x + car.direction * lookDist : car.x;
            const lookZ = car.axis === "z" ? car.z + car.direction * lookDist : car.z;
            for (const other of traffic) {
                if (other === car) continue;
                const ldx = other.x - lookX;
                const ldz = other.z - lookZ;
                if (ldx * ldx + ldz * ldz < 9) {
                    car.speed = Math.max(0.4, car.speed - dt * 7.5);
                    break;
                }
            }

            // Decay transient push velocity
            car.pushVx *= pushDecay;
            car.pushVz *= pushDecay;

            // Axis-direction movement + any push
            const { vx: axisVx, vz: axisVz } = axisVelocity(car.axis, car.speed, car.direction);
            car.x += (axisVx + car.pushVx) * dt;
            car.z += (axisVz + car.pushVz) * dt;

            // Building collision — traffic can be knocked into walls by player
            const trafficPos = { x: car.x, z: car.z };
            if (pushOutBuildings(world, trafficPos, car.radius ?? 2.1)) {
                car.x = trafficPos.x;
                car.z = trafficPos.z;
                car.speed *= 0.55;
                car.pushVx *= 0.3;
                car.pushVz *= 0.3;
            }

            // Map wrap
            if (car.x > CONFIG.map.size / 2 + 6) car.x = -CONFIG.map.size / 2 - 6;
            if (car.x < -CONFIG.map.size / 2 - 6) car.x = CONFIG.map.size / 2 + 6;
            if (car.z > CONFIG.map.size / 2 + 6) car.z = -CONFIG.map.size / 2 - 6;
            if (car.z < -CONFIG.map.size / 2 - 6) car.z = CONFIG.map.size / 2 + 6;

            car.mesh.position.set(car.x, 0.35, car.z);

            // Smoothly rotate mesh to face actual velocity direction when pushed
            const totalVx = axisVx + car.pushVx;
            const totalVz = axisVz + car.pushVz;
            const totalSpeed = Math.sqrt(totalVx * totalVx + totalVz * totalVz);
            if (totalSpeed > 0.5) {
                const targetAngle = Math.atan2(totalVx, totalVz);
                car.mesh.rotation.y += wrapAngle(targetAngle - car.mesh.rotation.y) * Math.min(1, dt * 6.5);
            }

            if (car.headlights) {
                const headlightIntensity = state.time.phase === "night" ? 0.85 : state.weather.mode === "fog" ? 0.55 : 0.2;
                for (const light of car.headlights) light.material.emissiveIntensity = headlightIntensity;
            }

            const distToPlayer = Math.sqrt(distanceSq(state.player.x, state.player.z, car.x, car.z));

            // Near-miss
            if (distToPlayer > CONFIG.traffic.collisionRadius && distToPlayer < CONFIG.traffic.collisionRadius + 2.8 && playerSpeedMag > 8) {
                if (car.nearMissCooldown <= 0) {
                    car.nearMissCooldown = 2.2;
                    triggerNearMiss();
                }
            }

            // Player ↔ Traffic: impulse-based momentum exchange
            if (distToPlayer < CONFIG.traffic.collisionRadius && car.cooldown <= 0) {
                car.cooldown = 0.75;
                const trafficMass = car.model?.mass ?? 1.0;

                // Collision normal pointing from traffic toward player
                const dx = state.player.x - car.x;
                const dz = state.player.z - car.z;
                const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
                const nx = dx / dist;
                const nz = dz / dist;

                // Full traffic velocity (axis + push)
                const tvx = axisVx + car.pushVx;
                const tvz = axisVz + car.pushVz;

                // Relative velocity along normal
                const relVn = (state.player.vx - tvx) * nx + (state.player.vz - tvz) * nz;

                if (relVn < 0) {
                    const restitution = 0.32;
                    const impulse = -(1 + restitution) * relVn / (1 / playerMass + 1 / trafficMass);

                    // Apply impulse to player
                    state.player.vx += (impulse / playerMass) * nx;
                    state.player.vz += (impulse / playerMass) * nz;

                    // Phase 3.2: side-collision induces small yaw-kick so T-bones can spin the player
                    const playerFwdX = Math.sin(state.player.rotation);
                    const playerFwdZ = Math.cos(state.player.rotation);
                    const cross = playerFwdX * nz - playerFwdZ * nx;
                    state.player.rotation += cross * impulse * 0.018 / playerMass;

                    // Apply impulse to traffic car as push velocity
                    car.pushVx -= (impulse / trafficMass) * nx;
                    car.pushVz -= (impulse / trafficMass) * nz;
                    car.speed *= 0.72;

                    // Separation push
                    const overlap = CONFIG.traffic.collisionRadius - distToPlayer;
                    const totalMass = playerMass + trafficMass;
                    state.player.x += nx * overlap * (trafficMass / totalMass);
                    state.player.z += nz * overlap * (trafficMass / totalMass);
                    car.x -= nx * overlap * (playerMass / totalMass);
                    car.z -= nz * overlap * (playerMass / totalMass);

                    // Damage proportional to closing speed
                    const impactSpeed = Math.abs(relVn);
                    if (impactSpeed > 2.5) {
                        // Phase 3.2: T-bone bonus damage on side hit
                        const sideHit = Math.abs(cross) > 0.7 ? 1.35 : 1;
                        const dmg = impactSpeed * 0.48 * (trafficMass / playerMass) * sideHit;
                        damagePlayer(dmg, "crash");
                        crashFx(impactSpeed / 14, { x: car.x, z: car.z });
                        state.cameraShake = Math.min(0.85, impactSpeed * 0.045);
                        spawnParticle((state.player.x + car.x) * 0.5, (state.player.z + car.z) * 0.5, "#ffb14c", 18);
                        registerTrafficCrash();
                        state.cleanEscape && (state.cleanEscape.crashes = (state.cleanEscape.crashes ?? 0) + 1);
                        state.mission && (state.mission.collisionCount = (state.mission.collisionCount ?? 0) + 1);
                    }

                    state.player.speed = Math.sin(state.player.rotation) * state.player.vx + Math.cos(state.player.rotation) * state.player.vz;
                    state.player.speedMag = Math.sqrt(state.player.vx ** 2 + state.player.vz ** 2);
                }
            }
        }

        // Resolve all traffic-traffic overlaps after movement
        resolveTrafficSeparation();
    }

    function spawn() {
        const district = chooseTrafficDistrict();
        const model = createTrafficModelForDistrict(district);
        const mesh = createCar(model, sharedMaterials, { taxi: model.name === "Taxi" });
        const axis = Math.random() < 0.5 ? "x" : "z";
        const streetOptions = getDistrictTrafficStreets(axis, district);
        const street = streetOptions[Math.floor(Math.random() * streetOptions.length)];
        const pos = getDistrictTrafficPosition(axis, district);
        const direction = Math.random() < 0.5 ? -1 : 1;
        const x = axis === "x" ? pos : street;
        const z = axis === "z" ? pos : street;
        mesh.position.set(x, 0.35, z);
        mesh.rotation.y = axisYaw(axis, direction);
        const headlights = addAmbientHeadlights(mesh, model);
        scene.add(mesh);
        const baseSpeed = district.id === "park" ? 3.1 : district.id === "harbor" ? 3.8 : district.id === "industrial" ? 4.2 : 5.1;
        const naturalSpeed = baseSpeed + Math.random() * 3.2;
        const carRadius = ((model.length ?? 4.2) * 0.42 + (model.width ?? 2.0) * 0.5) * 0.5;
        traffic.push({ mesh, x, z, axis, direction, speed: naturalSpeed, naturalSpeed, pushVx: 0, pushVz: 0, radius: carRadius, model, cooldown: 0, nearMissCooldown: 0, districtId: district.id, headlights });
    }

    function chooseTrafficDistrict() {
        const totalWeight = DISTRICTS.reduce((sum, district) => sum + (district.traffic ?? 1), 0);
        let roll = Math.random() * totalWeight;
        for (const district of DISTRICTS) {
            roll -= district.traffic ?? 1;
            if (roll <= 0) return district;
        }
        return DISTRICTS[DISTRICTS.length - 1];
    }

    function createTrafficModelForDistrict(district) {
        if (district.id === "downtown") {
            if (Math.random() < 0.38) return { ...CAR_MODELS[1], name: "Taxi", color: "#ffc23e", trim: "#181511" };
            return Math.random() < 0.5 ? CAR_MODELS[0] : CAR_MODELS[2];
        }
        if (district.id === "industrial") {
            return Math.random() < 0.65
                ? { ...CAR_MODELS[3], name: "Service Van", color: "#d39157", trim: "#2a2219" }
                : { ...CAR_MODELS[1], name: "Yard Hauler", color: "#c4b09a", trim: "#29251e" };
        }
        if (district.id === "harbor") {
            return Math.random() < 0.5
                ? { ...CAR_MODELS[3], color: "#6f8ea5", trim: "#1a2128", name: "Dock Truck", width: 2.34, length: 5.1 }
                : { ...CAR_MODELS[0], color: "#4d6e84", trim: "#162129", name: "Harbor Shuttle" };
        }
        return Math.random() < 0.7
            ? { ...CAR_MODELS[0], color: "#7dcf82", trim: "#1d2a1e", name: "Park Service" }
            : { ...CAR_MODELS[2], color: "#b8e2ff", trim: "#11354a", name: "Cycle Lane" };
    }

    function getDistrictTrafficStreets(axis, district) {
        const options = CONFIG.map.streets.filter((street) => {
            if (axis === "x") return district.z < 0 ? street <= 0 : street >= 0;
            return district.x < 0 ? street <= 0 : street >= 0;
        });
        return options.length > 0 ? options : CONFIG.map.streets;
    }

    function getDistrictTrafficPosition(axis, district) {
        const limit = CONFIG.map.size * 0.46;
        if (axis === "x") {
            return district.x < 0
                ? -Math.random() * limit
                : Math.random() * limit;
        }
        return district.z < 0
            ? -Math.random() * limit
            : Math.random() * limit;
    }

    return { update, spawn, streets: getDistrictTrafficStreets, position: getDistrictTrafficPosition };
}
