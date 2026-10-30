import { CAR_MODELS, CONFIG, POLICE_UNITS } from "../config.js";
import { hasLineOfSight, nearestNode, nextWaypoint } from "../ai/police.js";
import { clamp, distanceSq, turnToward, wrapAngle } from "../util/math.js";
import { stepHeatDecay } from "../scoring.js";
import { policeModelFor } from "../data/vehicles.js";
import { vehicleRadius } from "../physics/vehicle.js";
import { createCar } from "../vehicles.js";
import { obstacleAt, pushOutBuildings, snapStreet } from "../world.js";

/** Police: roles, street-graph pursuit, line of sight, spawning and leaving, collisions with the player. */
export function createPoliceSystem({
    police,
    state,
    distanceTo,
    getHeatTier,
    world,
    refreshProgress,
    completeMission,
    addScore,
    roadGraph,
    spawnRoadblock,
    traffic,
    spawnPopup,
    damagePlayer,
    crashFx,
    spawnParticle,
    addCash,
    setStatus,
    removeMesh,
    isInEscapeCover,
    updateWanted,
    sharedMaterials,
    scene,
    isScannerActive,
}) {
    function assignPoliceRoles() {
        // Re-assigned every ~2 s so cops don't dogpile; rebuilt fresh so removed cops leave no entries.
        const assignments = {};
        let leftFlank = 0;
        let rightFlank = 0;
        let tailers = 0;
        let pits = 0;
        let pincers = 0;
        for (const agent of police) {
            const id = agent.id ?? (agent.id = `cop-${Math.random().toString(36).slice(2, 8)}`);
            if (agent.unitType === "motorcycle") {
                const role = leftFlank <= rightFlank ? "flank-left" : "flank-right";
                assignments[id] = role;
                if (role === "flank-left") leftFlank += 1;
                else rightFlank += 1;
            } else if (agent.unitType === "van") {
                assignments[id] = "block-ahead";
            } else if (agent.unitType === "suv") {
                assignments[id] = "ram";
            } else if (tailers < 1) {
                assignments[id] = "tail";
                tailers += 1;
            } else if (state.wanted.level >= 3 && pits < 1) {
                assignments[id] = "pit";
                pits += 1;
            } else if (state.wanted.level >= 3 && pincers < 2) {
                // Two cars cut in from opposite sides at the next crossing ahead of the player.
                assignments[id] = "pincer";
                agent.pincerSide = pincers % 2 === 0 ? -1 : 1;
                pincers += 1;
            } else {
                assignments[id] = tailers < 2 ? "tail" : "ram";
                tailers += 1;
            }
        }
        state.policeAssignments = assignments;
    }

    /** Cops outside the view and furthest away are the ones that leave; they drive off instead of vanishing. */
    function retireExcessPolice(targetPolice) {
        let active = police.filter((agent) => !agent.leaving).length;
        while (active > targetPolice) {
            let pick = null;
            let pickScore = -Infinity;
            for (const agent of police) {
                if (agent.leaving) continue;
                const score = distanceTo(agent.x, agent.z) + (agent.los ? 0 : 60);
                if (score > pickScore) {
                    pickScore = score;
                    pick = agent;
                }
            }
            if (!pick) break;
            pick.leaving = true;
            active -= 1;
        }
    }

    function update(dt) {
        const heatTier = getHeatTier();
        const visibilityFactor = getPoliceVisibilityFactor();
        const retiredAgents = [];
        state.wanted.emp = Math.max(0, state.wanted.emp - dt);
        const targetPolice = Math.max(0, heatTier.police - (state.wanted.emp > 0 ? 6 : 0));
        while (police.filter((agent) => !agent.leaving).length < targetPolice && police.length < CONFIG.police.maxCount) spawnPolice(true);
        retireExcessPolice(targetPolice);

        // Phase 5.3: re-assign roles periodically
        state.policeAssignmentTimer = (state.policeAssignmentTimer ?? 0) - dt;
        if (state.policeAssignmentTimer <= 0) {
            assignPoliceRoles();
            state.policeAssignmentTimer = 2.0;
        }

        const playerVx = state.player.vx ?? 0;
        const playerVz = state.player.vz ?? 0;
        const playerSpeedMag = Math.hypot(playerVx, playerVz);
        const playerVxNorm = playerSpeedMag > 0.5 ? playerVx / playerSpeedMag : Math.sin(state.player.rotation);
        const playerVzNorm = playerSpeedMag > 0.5 ? playerVz / playerSpeedMag : Math.cos(state.player.rotation);
        // Perpendicular to player velocity (left side)
        const playerSideX = playerVzNorm;
        const playerSideZ = -playerVxNorm;

        let near = false;
        for (const agent of police) {
            agent.cooldown = Math.max(0, agent.cooldown - dt);
            agent.closeCooldown = Math.max(0, agent.closeCooldown - dt);
            agent.deployCooldown = Math.max(0, (agent.deployCooldown ?? 0) - dt);
            agent.stuckTimer = agent.stuckTimer ?? 0;
            const dx = state.player.x - agent.x;
            const dz = state.player.z - agent.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            agent.losTimer = (agent.losTimer ?? 0) - dt;
            if (agent.losTimer <= 0) {
                agent.los = hasLineOfSight(world, agent.x, agent.z, state.player.x, state.player.z);
                agent.losTimer = 0.2 + Math.random() * 0.1;
            }
            const unit = POLICE_UNITS[agent.unitType] ?? POLICE_UNITS.patrol;
            // Cops only pursue what they can see (or hear within 10 m); hiding behind buildings works.
            const sees = !agent.leaving && state.wanted.level > 0 && dist < CONFIG.police.searchDistance * visibilityFactor && (agent.los || dist < 10);
            if (dist < 34 * visibilityFactor && sees) near = true;
            if (dist < 7 && Math.abs(state.player.speed) > 9 && agent.closeCooldown <= 0) {
                agent.closeCooldown = 2.5;
                state.stats.closeCalls += 1;
                state.lifetime.closeCalls += 1;
                if (state.wanted.level >= 3) state.stats.highHeatCloseCalls += 1;
                refreshProgress();
                if (state.mission.type === "pursuit") {
                    state.mission.progress += 1;
                    if (state.mission.progress >= state.mission.target) completeMission();
                }
                addScore(45 + state.wanted.level * 12, false, "nearMiss");
            }

            if (agent.leaving) {
                agent.state = "leave";
            } else if (sees) {
                agent.state = "chase";
                if (!agent.revealed) {
                    agent.revealed = true;
                    agent.mesh.userData.parts?.reveal?.();
                    setStatus("Zivilstreife enttarnt!", 1.6);
                }
                agent.lastX = state.player.x;
                agent.lastZ = state.player.z;
            } else if (agent.state === "chase" || agent.state === "leave") {
                agent.state = "search";
                agent.swarmTimer = 0;
            }

            // Phase 5.1: Time-to-Intercept prediction
            const role = state.policeAssignments?.[agent.id] ?? "tail";
            const agentVx = Math.sin(agent.rotation) * agent.speed;
            const agentVz = Math.cos(agent.rotation) * agent.speed;
            // Closing rate along agent->player line
            const toPlayerLen = Math.max(0.5, dist);
            const toPlayerNx = dx / toPlayerLen;
            const toPlayerNz = dz / toPlayerLen;
            const copTowards = agentVx * toPlayerNx + agentVz * toPlayerNz;
            const playerTowards = playerVx * toPlayerNx + playerVz * toPlayerNz; // positive = away from cop
            const closing = Math.max(6, copTowards - playerTowards);
            const ttI = Math.min(2.5, Math.max(0.3, toPlayerLen / closing));

            const baseTargetX = agent.state === "chase" ? state.player.x + playerVx * ttI : agent.lastX;
            const baseTargetZ = agent.state === "chase" ? state.player.z + playerVz * ttI : agent.lastZ;

            // Phase 5.3: role-based offset
            let flank = 0;
            let aheadOffset = 0;
            let distanceHold = 0;
            switch (role) {
                case "flank-left": flank = -6; break;
                case "flank-right": flank = 6; break;
                case "block-ahead":
                    // Van: tries to get ahead of player along their travel vector
                    aheadOffset = 18;
                    break;
                case "ram":
                    aheadOffset = -2; // slightly behind to ram from rear
                    break;
                case "pit":
                    // Aim for the rear quarter so the contact spins the player out.
                    agent.pitSide = agent.pitSide ?? (Math.random() < 0.5 ? -1 : 1);
                    aheadOffset = -2.4;
                    flank = agent.pitSide * 1.5;
                    break;
                case "tail":
                    distanceHold = 8; // keep ~8m behind
                    aheadOffset = -distanceHold;
                    break;
            }
            let targetX = baseTargetX + playerVxNorm * aheadOffset + playerSideX * flank;
            let targetZ = baseTargetZ + playerVzNorm * aheadOffset + playerSideZ * flank;
            if (role === "pincer" && agent.state === "chase" && dist > 14) {
                const crossing = nearestNode(roadGraph, state.player.x + playerVxNorm * 22, state.player.z + playerVzNorm * 22);
                targetX = crossing.x + playerSideX * (agent.pincerSide ?? 1) * 6;
                targetZ = crossing.z + playerSideZ * (agent.pincerSide ?? 1) * 6;
            }
            if (agent.state === "leave") {
                targetX = agent.x + (agent.x - state.player.x);
                targetZ = agent.z + (agent.z - state.player.z);
                if (dist > 52 && !agent.los) retiredAgents.push(agent);
            } else if (agent.state !== "chase") {
                // Search: follow the street graph to the last known position, then fan out around it.
                let goalX = agent.lastX;
                let goalZ = agent.lastZ;
                if (Math.hypot(agent.x - agent.lastX, agent.z - agent.lastZ) < 9) {
                    agent.swarmTimer = (agent.swarmTimer ?? 0) - dt;
                    if (agent.swarmTimer <= 0) {
                        const hub = nearestNode(roadGraph, agent.lastX, agent.lastZ);
                        const spot = hub.links[Math.floor(Math.random() * hub.links.length)] ?? hub;
                        agent.swarmX = spot.x;
                        agent.swarmZ = spot.z;
                        agent.swarmTimer = 3.5;
                    }
                    goalX = agent.swarmX ?? goalX;
                    goalZ = agent.swarmZ ?? goalZ;
                }
                agent.wpTimer = (agent.wpTimer ?? 0) - dt;
                if (agent.wpTimer <= 0 || agent.wpGoalX !== goalX || agent.wpGoalZ !== goalZ) {
                    const wp = nextWaypoint(roadGraph, agent.x, agent.z, goalX, goalZ);
                    agent.wpX = wp.x;
                    agent.wpZ = wp.z;
                    agent.wpGoalX = goalX;
                    agent.wpGoalZ = goalZ;
                    agent.wpTimer = 0.35;
                }
                targetX = agent.wpX;
                targetZ = agent.wpZ;
            }
            agent.rotation = turnToward(agent.rotation, agent.x, agent.z, targetX, targetZ, (unit.turnRate + state.wanted.level * 0.2) * dt);
            agent.targetSpeed = getPoliceTargetSpeed(agent);
            agent.speed += (agent.targetSpeed - agent.speed) * dt * 2.4;

            const preX = agent.x + Math.sin(agent.rotation) * agent.speed * dt;
            const preZ = agent.z + Math.cos(agent.rotation) * agent.speed * dt;
            const next = { x: preX, z: preZ };
            const wallHit = pushOutBuildings(world, next, Math.max(1, agent.radius * 0.9));
            const obstacleHit = obstacleAt(world, next.x, next.z, Math.max(0.9, agent.radius * 0.8));
            if (wallHit || obstacleHit) {
                // Phase 5.2: project velocity along wall tangent instead of fixed-angle snap
                const dispX = next.x - preX;
                const dispZ = next.z - preZ;
                const dispLen = Math.hypot(dispX, dispZ);
                if (dispLen > 0.001) {
                    const wnx = dispX / dispLen;
                    const wnz = dispZ / dispLen;
                    const vAxisX = Math.sin(agent.rotation);
                    const vAxisZ = Math.cos(agent.rotation);
                    const velDotN = vAxisX * wnx + vAxisZ * wnz;
                    if (velDotN < 0) {
                        // Tangent direction
                        const tx = vAxisX - velDotN * wnx;
                        const tz = vAxisZ - velDotN * wnz;
                        const tlen = Math.hypot(tx, tz);
                        if (tlen > 0.01) {
                            // Interp rotation toward tangent direction
                            const newAngle = Math.atan2(tx / tlen, tz / tlen);
                            agent.rotation += wrapAngle(newAngle - agent.rotation) * 0.6;
                        }
                    }
                } else {
                    agent.rotation += agent.unitType === "motorcycle" ? 2.6 : 1.6;
                }
                agent.speed *= unit.wallSpeedFactor;
            }
            agent.x = clamp(next.x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            agent.z = clamp(next.z, -CONFIG.map.size / 2, CONFIG.map.size / 2);

            // Phase 5.2: stuck-recovery
            if (Math.abs(agent.speed) < 1.2) {
                agent.stuckTimer += dt;
                if (agent.stuckTimer > 0.6) {
                    agent.rotation += (Math.random() - 0.5) * 1.8;
                    agent.speed = -Math.abs(agent.targetSpeed) * 0.4;
                    agent.stuckTimer = 0;
                }
            } else {
                agent.stuckTimer = 0;
            }

            agent.mesh.position.set(agent.x, 0.37, agent.z);
            agent.mesh.rotation.y = agent.rotation;

            if (agent.unitType === "van" && agent.state === "chase" && dist < 34 && state.roadblockCooldown <= 0 && agent.deployCooldown <= 0) {
                spawnRoadblock({ sourceAgent: agent, tactical: true });
                agent.deployCooldown = 10;
            }

            // Police scatters nearby traffic cars out of the way
            for (const car of traffic) {
                const tdx = car.x - agent.x;
                const tdz = car.z - agent.z;
                const td2 = tdx * tdx + tdz * tdz;
                const tMin = (car.radius ?? 2.1) + agent.radius * 0.9;
                if (td2 < tMin * tMin && td2 > 0.01) {
                    const tdist = Math.sqrt(td2);
                    const tnx = tdx / tdist;
                    const tnz = tdz / tdist;
                    const tOverlap = tMin - tdist;
                    car.x += tnx * tOverlap * 0.55;
                    car.z += tnz * tOverlap * 0.55;
                    const pushStr = Math.min(tOverlap * 3.8, 7);
                    car.pushVx += tnx * pushStr;
                    car.pushVz += tnz * pushStr;
                }
            }

            if (distanceSq(state.player.x, state.player.z, agent.x, agent.z) < ((agent.radius + CONFIG.player.radius) * 0.91) ** 2 && agent.cooldown <= 0) {
                agent.cooldown = 0.9;
                const playerModel = CAR_MODELS[state.playerModelIndex];
                const playerMass = playerModel.mass ?? 1.0;
                const playerSpeedMag = state.player.speedMag ?? Math.abs(state.player.speed);
                const agentMass = unit.mass;

                // Collision normal
                const cdx = state.player.x - agent.x;
                const cdz = state.player.z - agent.z;
                const cdist = Math.sqrt(cdx * cdx + cdz * cdz) || 0.01;
                const cnx = cdx / cdist;
                const cnz = cdz / cdist;

                // Police velocity in world space
                const policeVx = Math.sin(agent.rotation) * agent.speed;
                const policeVz = Math.cos(agent.rotation) * agent.speed;
                const relVn = (state.player.vx - policeVx) * cnx + (state.player.vz - policeVz) * cnz;

                if (relVn < 0) {
                    const restitution = 0.28;
                    const impulse = -(1 + restitution) * relVn / (1 / playerMass + 1 / agentMass);
                    state.player.vx += (impulse / playerMass) * cnx;
                    state.player.vz += (impulse / playerMass) * cnz;
                    agent.speed *= unit.hitSpeedFactor;

                    // Phase 3.2: police-side collision yaw-kicks player
                    const playerFwdX = Math.sin(state.player.rotation);
                    const playerFwdZ = Math.cos(state.player.rotation);
                    const cross = playerFwdX * cnz - playerFwdZ * cnx;
                    state.player.rotation += cross * impulse * 0.020 / playerMass;

                    // PIT manoeuvre: a rear-quarter hit at speed spins the player out.
                    if (role === "pit" && agent.speed > 6 && playerSpeedMag > 6) {
                        state.player.rotation += (agent.pitSide ?? 1) * 0.6;
                        spawnPopup("PIT-Manöver!", "bounty");
                    }
                }

                const impactSpeed = Math.abs(relVn);
                const typeFactor = unit.damageFactor;
                const armorLevel = state.upgrades.armor ?? 0;
                const crashDamage = impactSpeed * typeFactor * (agentMass / playerMass) * 0.5 / (1 + armorLevel * 0.18);
                if (crashDamage > 0.5) {
                    damagePlayer(crashDamage, "crash");
                    crashFx(impactSpeed / 14, { x: agent.x, z: agent.z });
                    state.cameraShake = Math.min(0.9, impactSpeed * 0.05);
                    spawnParticle((state.player.x + agent.x) * 0.5, (state.player.z + agent.z) * 0.5, "#ff5a4c", 20);
                    state.cleanEscape && (state.cleanEscape.crashes = (state.cleanEscape.crashes ?? 0) + 1);
                }

                state.player.speed = Math.sin(state.player.rotation) * state.player.vx + Math.cos(state.player.rotation) * state.player.vz;
                state.player.speedMag = Math.sqrt(state.player.vx ** 2 + state.player.vz ** 2);

                // Phase 3.2 + 6.2: only heavier cars can knock out motorcycles at higher speed; reward player
                if (agent.unitType === "motorcycle" && playerSpeedMag > 10 && playerMass >= 1.2 && state.wanted.level >= 2) {
                    retiredAgents.push(agent);
                    const bounty = 30 + state.wanted.level * 15;
                    addCash(bounty);
                    addScore(80 + state.wanted.level * 25);
                    spawnPopup(`BOUNTY +$${bounty}`, "bounty");
                    setStatus(`Motorrad-Einheit ausgeschaltet. Kopfgeld +$${bounty}.`, 1.6);
                } else if (agent.unitType === "motorcycle" && playerSpeedMag > 14) {
                    retiredAgents.push(agent);
                    setStatus("Motorrad-Einheit ausgeschaltet.", 1.2);
                }
            }
        }

        for (const agent of retiredAgents) {
            const agentIndex = police.indexOf(agent);
            if (agentIndex >= 0) {
                removeMesh(agent.mesh);
                police.splice(agentIndex, 1);
            }
        }

        if (state.wanted.level > 0 && !near) {
            // Phase 5.4: decay delay scales with heat level
            const decayStep = stepHeatDecay({
                decay: state.wanted.decay,
                dt,
                level: state.wanted.level,
                covered: isInEscapeCover(state.player.x, state.player.z),
                baseDelay: CONFIG.police.decayDelay,
            });
            state.wanted.decay = decayStep.decay;
            // Mini-pursuit wave during decay at heat >= 3
            state.miniPursuitTimer = (state.miniPursuitTimer ?? 0) + dt;
            if (state.wanted.level >= 3 && state.miniPursuitTimer > 5 && Math.random() < 0.1) {
                state.miniPursuitTimer = 0;
                if (police.length < CONFIG.police.maxCount) {
                    spawnPolice(true, "motorcycle");
                }
            }
            if (decayStep.drop) updateWanted(state.wanted.level - 1);
        } else {
            state.wanted.decay = 0;
            state.miniPursuitTimer = 0;
        }

        state.wanted.status = state.wanted.level <= 0 ? "CLEAR" : near ? "CHASE" : "SEARCH";

        let nearestDist = Infinity;
        let nearestAgent = null;
        for (const agent of police) {
            const d = distanceTo(agent.x, agent.z);
            if (d < nearestDist) {
                nearestDist = d;
                nearestAgent = agent;
            }
        }
        state.nearestPoliceDistance = nearestDist;
        state.nearestPoliceOffset = nearestAgent ? { x: nearestAgent.x - state.player.x, z: nearestAgent.z - state.player.z } : null;
    }

    function spawnPolice(near = true, forcedUnitType = null) {
        if (police.length >= CONFIG.police.maxCount) return;
        const unitType = forcedUnitType ?? pickPoliceUnitType();
        const model = createPoliceUnitModel(unitType);
        const mesh = createCar(model, sharedMaterials, { police: true, lightbar: model.lightbar, hidden: model.hidden });
        const angle = Math.random() * Math.PI * 2;
        const dist = near ? CONFIG.police.spawnDistance + Math.random() * 28 : CONFIG.map.size * 0.45;
        let x = state.player.x + Math.cos(angle) * dist;
        let z = state.player.z + Math.sin(angle) * dist;
        x = clamp(snapStreet(x), -CONFIG.map.size / 2, CONFIG.map.size / 2);
        z = clamp(snapStreet(z), -CONFIG.map.size / 2, CONFIG.map.size / 2);
        mesh.position.set(x, 0.37, z);
        mesh.rotation.y = Math.random() * Math.PI * 2;
        scene.add(mesh);
        police.push({
            mesh,
            x,
            z,
            rotation: mesh.rotation.y,
            speed: 6,
            targetSpeed: 9,
            state: "search",
            lastX: state.player.x,
            lastZ: state.player.z,
            leaving: false,
            los: false,
            unitType,
            radius: vehicleRadius(model),
            revealed: !model.hidden,
            cooldown: 0,
            closeCooldown: 0,
            deployCooldown: unitType === "van" ? 3 : 0,
        });
    }

    function pickPoliceUnitType() {
        const heat = state.wanted.level;
        const roll = Math.random();
        if (heat >= 4 && roll < 0.24) return "van";
        if (heat >= 3 && roll < 0.52) return "suv";
        if (heat >= 2 && roll < 0.78) return "motorcycle";
        // Early on, some patrols are unmarked: dark cars with hidden lights that reveal themselves in a chase.
        return heat <= 3 && Math.random() < 0.3 ? "unmarked" : "patrol";
    }

    function createPoliceUnitModel(unitType) {
        return policeModelFor(unitType, state.wanted.level);
    }

    function getPoliceTargetSpeed(agent) {
        const unit = POLICE_UNITS[agent.unitType] ?? POLICE_UNITS.patrol;
        if (agent.state === "leave") return unit.idleSpeed * 0.8;
        if (agent.state !== "chase") return unit.idleSpeed;
        const night = state.time.phase === "night" ? unit.nightBonus : 0;
        return unit.chaseSpeed + state.wanted.level * unit.chaseSpeedPerHeat + night;
    }

    function getPoliceVisibilityFactor() {
        let factor = 1;
        if (state.time.phase === "night") factor += 0.14;
        if (state.weather.mode === "fog") factor -= 0.34;
        if (state.weather.mode === "storm") factor -= 0.16;
        if (isInEscapeCover(state.player.x, state.player.z)) factor -= 0.16;
        if (isScannerActive()) factor += 0.12;
        if (state.helicopter.active && distanceSq(state.player.x, state.player.z, state.helicopter.x, state.helicopter.z) < 15 * 15) factor += 0.22;
        return clamp(factor, 0.55, 1.45);
    }

    function scramble(x, z, radius = 24) {
        const radiusSq = radius * radius;
        for (const agent of police) {
            if (distanceSq(x, z, agent.x, agent.z) >= radiusSq) continue;
            agent.state = "search";
            agent.lastX = x + (Math.random() - 0.5) * 8;
            agent.lastZ = z + (Math.random() - 0.5) * 8;
            agent.speed *= 0.78;
        }
    }

    return { update, scramble };
}
