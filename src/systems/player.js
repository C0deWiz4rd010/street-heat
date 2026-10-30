import { CAR_MODELS, CONFIG, DISTRICTS, VEHICLE_PHYSICS, WEATHER_MODES } from "../config.js";
import { applyEngine, applyGrip, applySteering, cancelNormalVelocity, deriveSpec, glancingWallImpact, headOnDamp, surfaceAt, updateDrift } from "../physics/vehicle.js";
import { clamp } from "../util/math.js";
import { obstacleAt, pushOutBuildings } from "../world.js";
import { replaceCarModel } from "../vehicles.js";
import { showGameOver } from "../ui.js";

/** The player's car: controls to physics, collisions, nitro, drift scoring, damage and game over, provoke, car switching. */
export function createPlayerSystem({
    state,
    isInsideShortcutZone,
    getNitroMax,
    spawnParticle,
    addScore,
    spawnPopup,
    world,
    destroyObstacle,
    crashFx,
    getDistrictAt,
    playerCar,
    getMaxHealth,
    setStatus,
    audio,
    persistProfile,
    flushProfile,
    ui,
    updateWanted,
    effects,
    sharedMaterials,
}) {
    function update(dt, input) {
        const model = CAR_MODELS[state.playerModelIndex];
        const player = state.player;
        const district = state.district ?? DISTRICTS[0];
        const inShortcut = district.id === "park" && isInsideShortcutZone(player.x, player.z);
        const surface = surfaceAt(player.x, player.z, district.id, inShortcut);
        const gripLevel = state.upgrades.grip;
        const nitroLevel = state.upgrades.nitro;
        const armorLevel = state.upgrades.armor;
        const weatherGrip = WEATHER_MODES[state.weather.mode]?.grip ?? 1;
        const mass = model.mass ?? 1.0;
        const spec = deriveSpec(model, {
            upgrades: state.upgrades,
            weatherGrip,
            surface,
            inShortcut,
            shortcutBoost: district.shortcutBoost ?? 0,
            noBrake: Math.abs(state.modifiers?.noBrake ?? 0) > 0,
        });
        const maxSpeed = spec.maxSpeed;
        player.surface = surface.id;
        const nitroMax = getNitroMax();
        const keys = input.keys;
        const stick = input.analog ?? { x: 0, y: 0 };
        // Keys are all-or-nothing; stick and triggers give partial gas and brake.
        const forwardAmount = keys.w || keys.arrowup ? 1 : clamp(-stick.y, 0, 1);
        const reverseAmount = keys.s || keys.arrowdown ? 1 : clamp(stick.y, 0, 1);
        const forward = forwardAmount > 0.12 ? 1 : 0;
        const reverse = reverseAmount > 0.12 ? 1 : 0;
        const left = keys.a || keys.arrowleft ? 1 : 0;
        const right = keys.d || keys.arrowright ? 1 : 0;
        const handbrake = Boolean(keys[" "]);
        // Stick/pad steer proportionally; the keyboard ramps (input.steer) instead of snapping to full lock.
        const turnInput = Math.abs(stick.x) > 0.12 ? clamp(-stick.x, -1, 1) : (input.steer ?? left - right);
        state.lastTurnInput = turnInput;
        const ctl = { forward: forward === 1, reverse: reverse === 1, handbrake, turn: turnInput, throttleAmount: forwardAmount, brakeAmount: reverseAmount };
        player.throttle = ctl.forward ? forwardAmount : ctl.reverse ? 0.3 : 0;

        // Forward/lateral axes from current rotation
        const fwdX = Math.sin(player.rotation);
        const fwdZ = Math.cos(player.rotation);
        const latX = Math.cos(player.rotation);
        const latZ = -Math.sin(player.rotation);

        // Project current velocity onto axes
        const vx = player.vx ?? 0;
        const vz = player.vz ?? 0;
        let fwdSpeed = vx * fwdX + vz * fwdZ;
        let latSpeed = vx * latX + vz * latZ;

        const nitro = Boolean(keys.shift && player.nitro > 0 && Math.abs(fwdSpeed) > 2);
        player.nitroActive = nitro;
        player.braking = (reverse && fwdSpeed > 0.5) || handbrake;
        const nitroBonusSpeed = nitro ? CONFIG.player.nitroBonus + nitroLevel * 2.4 + maxSpeed * spec.tierEngineNitroBoost : 0;
        const boostedMax = maxSpeed + nitroBonusSpeed;

        if (nitro) {
            player.nitro = Math.max(0, player.nitro - dt * CONFIG.player.nitroBurn);
            spawnParticle(player.x - fwdX * 2, player.z - fwdZ * 2, "#63c8ff", 2);
        } else {
            const districtNitro = district.nitroRegenBonus ?? 0;
            const shortcutNitro = inShortcut ? 0.95 : 0;
            player.nitro = Math.min(nitroMax, player.nitro + dt * (CONFIG.player.nitroRegen + nitroLevel * 0.9 + districtNitro + shortcutNitro));
        }

        const speedRatioFwd = Math.min(1, Math.abs(fwdSpeed) / Math.max(0.1, boostedMax));
        fwdSpeed = applyEngine(fwdSpeed, ctl, spec, boostedMax, dt);
        player.speed = fwdSpeed;
        const { isDrifting, wasDrifting } = updateDrift(player, fwdSpeed, latSpeed, ctl, spec, speedRatioFwd, dt);
        applySteering(player, fwdSpeed, ctl, spec, boostedMax, dt);

        // Recalculate axes after rotation change
        const newFwdX = Math.sin(player.rotation);
        const newFwdZ = Math.cos(player.rotation);
        const newLatX = Math.cos(player.rotation);
        const newLatZ = -Math.sin(player.rotation);
        latSpeed = applyGrip(latSpeed, player, ctl, spec, dt);

        // Reconstruct world-space velocity
        player.vx = newFwdX * fwdSpeed + newLatX * latSpeed;
        player.vz = newFwdZ * fwdSpeed + newLatZ * latSpeed;
        player.speed = fwdSpeed;
        player.speedMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);

        // Phase 2.4: drift scoring scales with drift-angle, counter-steer bonus
        const prevDriftSession = player.driftSessionScore ?? 0;
        if (player.drift > 0.1) {
            const driftAngle = Math.abs(Math.atan2(latSpeed, Math.max(0.5, Math.abs(fwdSpeed))));
            const angleScale = 1 + Math.min(1.5, driftAngle * 1.8); // up to 2.5x at sharp angle
            // Counter-steer: turning opposite to slide direction
            const slideDir = Math.sign(latSpeed);
            const counterSteer = slideDir !== 0 && Math.sign(turnInput) === -slideDir;
            const counterMult = counterSteer ? 1.25 + spec.tierGripBonus * 0.25 : 1;
            const driftGain = Math.abs(fwdSpeed) * dt * (0.8 + gripLevel * 0.08) * angleScale * counterMult;
            state.combo.driftBank += driftGain;
            state.combo.driftScore += driftGain * 10;
            state.stats.driftScore += driftGain * 10;
            player.driftSessionScore = (player.driftSessionScore ?? 0) + driftGain * 10;
            if (state.combo.driftBank >= 12) {
                state.combo.driftBank = 0;
                addScore(18 + gripLevel * 5, false, "drift");
            }
        }

        // Drift-end popup
        if (wasDrifting && player.drift < 0.1 && prevDriftSession > 80) {
            const earned = Math.round(prevDriftSession);
            spawnPopup(`DRIFT! +${earned}`, "drift");
            player.driftSessionScore = 0;
        }
        if (!wasDrifting && player.drift < 0.05) player.driftSessionScore = 0;

        // Drift smoke from rear wheels
        if (player.drift > 0.55 && Math.random() < dt * 8) {
            const rearX = player.x - newFwdX * 1.7;
            const rearZ = player.z - newFwdZ * 1.7;
            spawnDriftSmoke(rearX + newLatX * 0.85, rearZ + newLatZ * 0.85);
            spawnDriftSmoke(rearX - newLatX * 0.85, rearZ - newLatZ * 0.85);
        }

        // Position update: sub-stepped so a fast car cannot tunnel through a building.
        const half = CONFIG.map.size / 2;
        const travel = Math.hypot(player.vx, player.vz) * dt;
        const substeps = Math.max(1, Math.ceil(travel / VEHICLE_PHYSICS.maxSubstep));
        const next = { x: player.x, z: player.z };
        let preX = next.x;
        let preZ = next.z;
        let hitBuilding = false;
        let edgeX = 0;
        let edgeZ = 0;
        for (let step = 0; step < substeps && !hitBuilding; step += 1) {
            next.x += (player.vx * dt) / substeps;
            next.z += (player.vz * dt) / substeps;
            if (next.x < -half || next.x > half) {
                edgeX = next.x < 0 ? 1 : -1;
                next.x = clamp(next.x, -half, half);
            }
            if (next.z < -half || next.z > half) {
                edgeZ = next.z < 0 ? 1 : -1;
                next.z = clamp(next.z, -half, half);
            }
            // Save pre-pushout position to derive the collision normal for wall sliding
            preX = next.x;
            preZ = next.z;
            hitBuilding = pushOutBuildings(world, next, CONFIG.player.radius);
        }
        // The map edge removes only the velocity component pointing out of the map.
        if (edgeX) cancelNormalVelocity(player, edgeX, 0);
        if (edgeZ) cancelNormalVelocity(player, 0, edgeZ);
        if (edgeX || edgeZ) {
            player.speed = newFwdX * player.vx + newFwdZ * player.vz;
            player.speedMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
        }

        const hitObstacle = obstacleAt(world, next.x, next.z, CONFIG.player.radius);
        let destroyedReaction = null;
        if (hitObstacle) {
            const dx = next.x - hitObstacle.x;
            const dz = next.z - hitObstacle.z;
            const distance = Math.sqrt(dx * dx + dz * dz);
            // Push out by the actual overlap along the contact normal (fallback: straight back).
            const overlap = hitObstacle.radius + CONFIG.player.radius - distance + 0.05;
            const pushX = distance > 0.001 ? dx / distance : -newFwdX;
            const pushZ = distance > 0.001 ? dz / distance : -newFwdZ;
            next.x += pushX * overlap;
            next.z += pushZ * overlap;
            const impactMag = player.speedMag;
            if (hitObstacle.destructible && impactMag > (hitObstacle.minImpact ?? 6)) {
                destroyedReaction = destroyObstacle(hitObstacle, impactMag);
            }
        }

        if (hitBuilding) {
            const impactMag = player.speedMag;
            // Derive surface normal from pushout displacement
            const dispX = next.x - preX;
            const dispZ = next.z - preZ;
            const dispLen = Math.sqrt(dispX * dispX + dispZ * dispZ);
            const speedRatioWall = Math.min(1, impactMag / Math.max(0.1, boostedMax));
            if (dispLen > 0.001) {
                const slide = glancingWallImpact(player, dispX / dispLen, dispZ / dispLen, impactMag, speedRatioWall, mass, dt);
                state.wallSlide = Math.max(state.wallSlide ?? 0, slide);
            } else {
                headOnDamp(player, mass);
            }
            player.speed = newFwdX * player.vx + newFwdZ * player.vz;
            player.speedMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
            // Phase 3.1: less aggressive shake — only on real impact
            if (impactMag > 8) {
                damage(impactMag * 0.7 / (mass * 0.75 + 0.25 + armorLevel * 0.18), "crash");
                crashFx(impactMag / 22, { x: next.x, z: next.z });
                state.cameraShake = Math.min(1, impactMag * 0.045);
                spawnParticle(next.x, next.z, "#ff6a4f", 16);
            }
        }

        if (hitObstacle) {
            const impactMag = player.speedMag;
            const obstacleDamping = destroyedReaction?.speedDamping ?? hitObstacle?.speedDamping ?? 0.34;
            const dampFactor = Math.min(obstacleDamping + mass * 0.14, 0.72);
            player.vx *= dampFactor;
            player.vz *= dampFactor;
            player.speed = newFwdX * player.vx + newFwdZ * player.vz;
            player.speedMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
            if (impactMag > 5) {
                const obstacleDamageScale = destroyedReaction?.hitDamageScale ?? hitObstacle?.hitDamageScale ?? 0.55;
                damage(impactMag * obstacleDamageScale / (mass * 0.75 + 0.25), "crash");
                crashFx(impactMag / 26, { x: next.x, z: next.z });
                state.cameraShake = Math.min(1, Math.max(impactMag * 0.04, destroyedReaction?.shake ?? hitObstacle?.shake ?? 0));
                spawnParticle(next.x, next.z, destroyedReaction?.color ?? hitObstacle?.color ?? "#ffc64d", destroyedReaction?.particleCount ?? 18);
            }
        }

        player.x = next.x;
        player.z = next.z;
        const nextShortcut = getDistrictAt(player.x, player.z).id === "park" && isInsideShortcutZone(player.x, player.z);
        if (nextShortcut && !player.inShortcut) state.mission.shortcutEntries += 1;
        player.inShortcut = nextShortcut;
        playerCar.position.set(player.x, 0.38, player.z);
        playerCar.rotation.y = player.rotation;

        if (player.drift > 0.2) addSkidMark();
    }

    function passiveRegen(dt) {
        const player = state.player;
        player.regenCooldown = Math.max(0, (player.regenCooldown ?? 0) - dt);
        if (player.regenCooldown > 0) return;
        const maxHp = getMaxHealth();
        if (player.health >= maxHp) return;
        // Slow regen, faster when heat is clear and not at critical HP
        const regenRate = state.wanted.level === 0 ? 1.1 : 0.3;
        player.health = Math.min(maxHp, player.health + regenRate * dt);
    }

    function damage(amount, source = "generic") {
        if (!state.running) return;
        if (source === "crash" || source === "hazard") state.mission.collisionCount += 1;
        const mitigated = amount * (1 - state.upgrades.armor * 0.075);
        state.player.health -= mitigated;
        state.player.regenCooldown = 6.5;
        state.cameraShake = Math.max(state.cameraShake, mitigated * 0.02);
        if (state.player.health <= 0) {
            // Last chance — once per run, survive on fumes
            if (!state.player.lastChanceUsed) {
                state.player.lastChanceUsed = true;
                state.player.health = 22;
                state.player.regenCooldown = 10;
                state.score = Math.max(0, state.score * 0.7);
                state.combo.chain = 0;
                state.combo.multiplier = 1;
                state.combo.timer = 0;
                state.cameraShake = 1.2;
                setStatus("LETZTER AUSWEG — Karosserie kritisch! Garage ansteuern!", 3.5);
                spawnPopup("LETZTE CHANCE!", "normal");
                return;
            }
            state.player.health = 0;
            state.running = false;
            state.screen = "gameover";
            audio?.gameOver();
            state.stats.newRecord = Math.round(state.score) > state.bestScore;
            state.bestScore = Math.max(state.bestScore, Math.round(state.score));
            persistProfile();
            flushProfile();
            showGameOver(ui, state);
        }
    }

    // Phase 6.1: Provoke action
    function provoke() {
        if (!state.running || state.paused || state.screen !== "playing") return;
        if (state.provoke.cooldown > 0) {
            setStatus(`Provoke wieder bereit in ${state.provoke.cooldown.toFixed(0)}s.`, 1.2);
            return;
        }
        if (state.wanted.level >= 5) {
            setStatus("Heat maximal — Provoke nicht möglich.", 1.2);
            return;
        }
        updateWanted(state.wanted.level + 1);
        state.provoke.cooldown = 25;
        state.provoke.active = 20;
        state.provoke.fxTimer = 0.4;
        spawnPopup("PROVOKE", "drift");
        setStatus("Provoziert. Heat +1, Multiplikator +0.5 für 20s, Cash x1.5.", 2.2);
    }

    function addSkidMark() {
        const player = state.player;
        const model = CAR_MODELS[state.playerModelIndex];
        const driftIntensity = Math.min(1, player.drift);
        const rearX = player.x - Math.sin(player.rotation) * 1.7;
        const rearZ = player.z - Math.cos(player.rotation) * 1.7;
        effects.addSkid(rearX, rearZ, player.rotation, model.width * 0.45, 0.2 + driftIntensity * 0.1);
    }

    function spawnDriftSmoke(x, z) {
        effects.spawnSmoke(x, z);
    }

    function nearMiss() {
        const nearMiss = state.nearMiss;
        nearMiss.count += 1;
        nearMiss.streak += 1;
        nearMiss.timer = 8;
        nearMiss.streakTimer = 6;
        const earned = Math.round(80 + state.combo.chain * 5);
        addScore(earned, false, "nearMiss");
        spawnParticle(state.player.x, state.player.z, "#ffc64d", 6);
        spawnPopup(`CLOSE! +${earned}`, "nearMiss");
        audio?.nearMiss?.();
        if (nearMiss.streak >= 3) {
            setStatus(`Near-Miss Streak x${nearMiss.streak}! Tempo behalten.`, 1.4);
        }
    }

    function switchCar(index) {
        if (!CAR_MODELS[index] || index === state.playerModelIndex) return;
        if (!state.unlockedCars.includes(CAR_MODELS[index].id)) {
            setStatus(`${CAR_MODELS[index].name} ist noch gesperrt. In der Garage freischalten.`, 1.8);
            audio?.denied();
            return;
        }
        state.playerModelIndex = index;
        const oldRotation = playerCar.rotation.y;
        replaceCarModel(playerCar, CAR_MODELS[index], sharedMaterials);
        playerCar.rotation.y = oldRotation;
        persistProfile();
        setStatus(`Fahrzeug gewechselt: ${CAR_MODELS[index].name}.`, 1.8);
    }

    return { update, damage, passiveRegen, provoke, addSkidMark, spawnDriftSmoke, nearMiss, switchCar };
}
