import * as THREE from "three";
import { ACHIEVEMENTS, CONFIG, CAR_MODELS, CONTRACTS, DISTRICTS, HEAT_TIERS, PICKUP_TYPES, POIS, PAINTS, REPUTATION_GAINS, UPGRADES, VEHICLE_PHYSICS, WEATHER_MODES, WORLD_EVENTS } from "./config.js";
import { clamp, distanceSq, axisYaw } from "./util/math.js";
import { maxHealth, nitroCapacity } from "./economy.js";
import { registerCombo, tickCombo } from "./scoring.js";
import { reputationTier } from "./progression.js";
import { createCameraSystem } from "./systems/camera.js";
import { createMissionSystem } from "./systems/missions.js";
import { createPoliceSystem } from "./systems/police.js";
import { createTrafficSystem } from "./systems/traffic.js";
import { createRaceSystem } from "./systems/race.js";
import { createTagSystem } from "./systems/tags.js";
import { createWeatherSystem } from "./systems/weather.js";
import { buildRoadGraph } from "./ai/police.js";
import { applyEngine, applyGrip, applySpeedFactor, applySteering, cancelNormalVelocity, deriveSpec, glancingWallImpact, headOnDamp, surfaceAt, updateDrift } from "./physics/vehicle.js";
import { SAVE_VERSION, clearProfile, createDefaultProfile, saveProfile } from "./save.js";
import { hideGameOver, renderHud, showGameOver } from "./ui.js";
import { createEffects, disposeObject, markShared } from "./effects.js";
import { applyTuning, createCar, createMaterial, replaceCarModel, setHeadlightBeamLevel, setPaint, updateCarVisuals } from "./vehicles.js";
import { buildingsNear, insideBuilding, obstacleAt, obstaclesNear, pushOutBuildings, snapStreet } from "./world.js";

const PHYSICS_DT = 1 / 60;
const PHYSICS_MAX_STEPS = 5;
const PROFILE_FLUSH_MS = 2000;

export function createGameRuntime({ scene, camera, renderer, world, ui, state, sharedMaterials, audio, lights, post }) {
    const pickups = [];
    const police = [];
    const traffic = [];
    const roadblocks = [];
    const hazards = [];
    const eventPickups = [];
    const effects = createEffects(scene);
    const helicopter = createHelicopterMesh();
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const eventGeo = new THREE.DodecahedronGeometry(0.85, 0);
    const hazardGeo = new THREE.BoxGeometry(4.8, 0.08, 0.7);
    markShared(pickupGeo, eventGeo, hazardGeo);
    const roadGraph = buildRoadGraph();
    const crashLog = [];
    const cameraSystem = createCameraSystem({ state, camera, post, police });
    const weatherFx = createWeatherSystem({ state, scene, renderer, lights, post, audio, world, effects });
    const debugClock = { frames: 0, timer: 0 };
    let scannerCharge = 0;
    let activeScannerZoneId = null;
    let physicsAccumulator = 0;
    let profileDirty = false;
    let lastProfileFlush = 0;
    window.addEventListener("pagehide", () => flushProfile());
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) flushProfile();
    });
    const playerCar = createCar(CAR_MODELS[state.playerModelIndex], sharedMaterials, { headlightSpot: true });
    playerCar.position.set(0, 0.38, 0);
    scene.add(playerCar);
    scene.add(helicopter);
    helicopter.visible = false;

    function reset(options = {}) {
        state.score = 0;
        state.running = true;
        state.paused = Boolean(options.showMenu);
        state.screen = options.showMenu ? "menu" : "playing";
        state.player.x = 0;
        state.player.z = 0;
        state.player.rotation = 0;
        state.player.speed = 0;
        state.player.vx = 0;
        state.player.vz = 0;
        state.player.speedMag = 0;
        state.player.health = getMaxHealth();
        state.player.nitro = 24;
        state.player.drift = 0;
        state.player.driftSessionScore = 0;
        state.player.inShortcut = false;
        state.player.lastChanceUsed = false;
        state.player.regenCooldown = 0;
        state.popup = { text: "", timer: 0, type: "normal" };
        state.nearMiss = { count: 0, timer: 0, streak: 0, streakTimer: 0 };
        state.nearestPoliceDistance = Infinity;
        state.provoke = { cooldown: 0, active: 0, fxTimer: 0 };
        state.cleanEscape = { elapsed: 0, active: false, crashes: 0 };
        state.policeAssignments = {};
        state.policeAssignmentTimer = 0;
        state.miniPursuitTimer = 0;
        state.wallSlide = 0;
        state.wanted.level = 0;
        state.wanted.status = "CLEAR";
        state.wanted.decay = 0;
        state.wanted.emp = 0;
        state.combo.chain = 0;
        state.combo.multiplier = 1;
        state.combo.timer = 0;
        state.combo.driftBank = 0;
        state.combo.driftScore = 0;
        state.stats.pickups = 0;
        state.stats.missions = 0;
        state.stats.missionsLowHeat = 0;
        state.stats.roadblocks = 0;
        state.stats.closeCalls = 0;
        state.stats.highHeatCloseCalls = 0;
        state.stats.propsDestroyed = 0;
        state.stats.events = 0;
        state.stats.driftScore = 0;
        state.stats.cashEarned = 0;
        state.stats.newRecord = false;
        state.stats.unlocked = [];
        state.stats.breakdown = { drift: 0, nearMiss: 0, pickups: 0, props: 0, missions: 0, events: 0, escape: 0, other: 0 };
        state.stats.tagsRun = 0;
        // An unclaimed contract carries its progress into the next run (and across reloads).
        const previousContract = CONTRACTS.find((item) => item.id === state.contract.id);
        const stillValid = previousContract && !state.contract.claimed && isContractAvailable(previousContract);
        if (stillValid) {
            state.contract.base = state.contract.progress;
        } else {
            const pool = CONTRACTS.filter(isContractAvailable);
            state.contract.id = pool[Math.floor(Math.random() * pool.length)].id;
            state.contract.base = 0;
            state.contract.progress = 0;
            state.contract.claimed = false;
        }
        state.contract.completed = false;
        raceSystem.end(true);
        state.helicopter.active = false;
        state.helicopter.pressure = 0;
        state.helicopter.cooldown = 0;
        helicopter.visible = false;
        state.garageCooldown = 0;
        state.safehouseCooldown = 0;
        state.roadblockCooldown = 0;
        state.actionPrompt = "";
        state.cameraShake = 0;
        state.worldEvent.active = false;
        state.worldEvent.label = "Ruhige Straßen";
        state.worldEvent.timer = 14;
        state.worldEvent.x = 0;
        state.worldEvent.z = 0;
        state.weather.mode = "clear";
        state.weather.label = WEATHER_MODES.clear.label;
        state.weather.timer = 28;
        state.weather.intensity = 0;
        state.time.phase = "day";
        state.time.label = "Tag";
        state.time.timer = 72;
        state.time.cycle = 0;
        state.district = getDistrictAt(0, 0);
        scannerCharge = 0;
        activeScannerZoneId = null;
        setStatus(options.showMenu ? "Wähle einen Run oder prüfe die Garage." : "Direkt im Spiel. Fahre los.", 2.8);
        hideGameOver(ui);
        missionSystem.clearBoss();

        replaceCarModel(playerCar, CAR_MODELS[state.playerModelIndex], sharedMaterials);
        playerCar.position.set(0, 0.38, 0);
        playerCar.rotation.y = 0;

        clearEntities(pickups);
        clearEntities(police);
        clearEntities(traffic);
        clearEntities(roadblocks);
        clearEntities(hazards);
        clearEntities(eventPickups);
        effects.clear();

        missionSystem.set(1);
        for (let index = 0; index < CONFIG.pickups.startCount; index += 1) spawnPickup();
        for (let index = 0; index < CONFIG.traffic.startCount; index += 1) trafficSystem.spawn();
        weatherFx.apply();
        persistProfile();
        renderHud(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
    }

    function stepPhysics(dt, input) {
        updateCombo(dt);
        if (state.popup?.timer > 0) state.popup.timer = Math.max(0, state.popup.timer - dt);
        if (state.nearMiss?.streakTimer > 0) {
            state.nearMiss.streakTimer -= dt;
            if (state.nearMiss.streakTimer <= 0) state.nearMiss.streak = 0;
        }
        // Phase 6.1: Provoke timers
        if (state.provoke) {
            state.provoke.cooldown = Math.max(0, state.provoke.cooldown - dt);
            state.provoke.active = Math.max(0, state.provoke.active - dt);
            state.provoke.fxTimer = Math.max(0, state.provoke.fxTimer - dt);
        }
        // Phase 6.2: Clean-Escape tracking (Heat 4+ -> 0 without crash in 60s = $500)
        if (state.cleanEscape) {
            if (!state.cleanEscape.active && state.wanted.level >= 4) {
                state.cleanEscape.active = true;
                state.cleanEscape.elapsed = 0;
                state.cleanEscape.crashes = 0;
            } else if (state.cleanEscape.active) {
                state.cleanEscape.elapsed += dt;
                const elapsed = state.cleanEscape.elapsed;
                if (state.wanted.level === 0 && state.cleanEscape.crashes === 0 && elapsed < 60) {
                    addCash(500);
                    addScore(700, true, "escape");
                    spawnPopup("CLEAN ESCAPE +$500", "bounty");
                    setStatus("Saubere Flucht: Heat 4 -> 0 ohne Crash. +$500.", 2.6);
                    state.cleanEscape.active = false;
                } else if (elapsed > 60 || state.cleanEscape.crashes > 0) {
                    state.cleanEscape.active = false;
                }
            }
        }
        // Phase 7.1: wall-slide signal decays for audio
        if (state.wallSlide) state.wallSlide = Math.max(0, state.wallSlide - dt * 2.5);

        trafficSystem.update(dt);
        policeSystem.update(dt);
        updatePlayer(dt, input);
        updatePassiveRegen(dt);
        missionSystem.update(dt);
        updateDistrict();
        updateScannerZones(dt);
        updateTimeOfDay(dt);
        updateWeather(dt);
        updateWorldEvents(dt);
        raceSystem.update(dt);
        tagSystem.update(dt);
        updatePickups(dt);
        updateRoadblocks(dt);
        updateHazards(dt);
        updateHelicopter(dt);
        updatePoiEffects(dt, input);
        missionSystem.interact(input);
    }

    function update(realDt, input) {
        if (profileDirty && performance.now() - lastProfileFlush >= PROFILE_FLUSH_MS) flushProfile();
        lights.nightGlow.position.set(state.player.x, 22, state.player.z);
        if (state.statusTimer > 0) state.statusTimer = Math.max(0, state.statusTimer - realDt);
        if (input.consume("f3")) state.debug.enabled = !state.debug.enabled;
        if (input.consume("f4")) {
            post.cycleQuality();
            if (state.settings) state.settings.quality = post.getQuality();
            state.saveSettings?.();
            setStatus(`Grafik: ${post.getQualityConfig().label}`, 1.6);
        }
        if (input.consume("g")) toggleGarage();
        if (input.consume("escape") && state.running && state.screen === "playing") {
            state.paused = !state.paused;
            setStatus(state.paused ? "Pause." : "Zurück auf der Straße.", 1.4);
        }
        if (input.consume("c")) {
            const order = Object.keys(CONFIG.camera.modes);
            const current = state.settings?.cameraMode ?? state.cameraMode ?? "normal";
            const nextMode = order[(order.indexOf(current) + 1) % order.length];
            state.cameraMode = nextMode;
            if (state.settings) state.settings.cameraMode = nextMode;
            state.saveSettings?.();
            setStatus(`Kamera: ${{ near: "Nah", normal: "Normal", far: "Weit" }[nextMode]}`, 1.4);
        }
        if (state.running && input.consume("p")) {
            state.paused = !state.paused;
            setStatus(state.paused ? "Pause." : "Zurück auf der Straße.", 1.4);
        }
        // Phase 6.1: Provoke key (Q) — handled outside physics step so it triggers once per real frame
        if (input.consume("q")) tryProvoke();
        updateDebug(realDt);
        weatherFx.update(realDt);

        if (!state.running || state.paused || state.screen !== "playing") {
            physicsAccumulator = 0;
            updateParticles(realDt);
            updateTimeOfDay(realDt, true);
            updateWeather(realDt, true);
            cameraSystem.update(realDt);
            audio?.update(state, realDt);
            renderHud(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
            post.render(realDt, state.player);
            return;
        }

        physicsAccumulator += realDt;
        let steps = 0;
        while (physicsAccumulator >= PHYSICS_DT && steps < PHYSICS_MAX_STEPS) {
            stepPhysics(PHYSICS_DT, input);
            physicsAccumulator -= PHYSICS_DT;
            steps += 1;
        }
        if (steps >= PHYSICS_MAX_STEPS) physicsAccumulator = 0;

        updateParticles(realDt);
        updateSkidMarks(realDt);
        updateVehicleVisuals(realDt);
        cameraSystem.update(realDt);
        audio?.update(state, realDt);
        renderHud(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
        post.render(realDt, state.player);
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

    function updatePlayer(dt, input) {
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
                damagePlayer(impactMag * 0.7 / (mass * 0.75 + 0.25 + armorLevel * 0.18), "crash");
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
                damagePlayer(impactMag * obstacleDamageScale / (mass * 0.75 + 0.25), "crash");
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

    function updatePickups(dt) {
        for (let index = pickups.length - 1; index >= 0; index -= 1) {
            const pickup = pickups[index];
            pickup.t += dt;
            pickup.mesh.position.y = pickup.baseY + Math.sin(pickup.t * 2.3) * 0.26;
            pickup.mesh.rotation.y += pickup.spin * dt;
            pickup.mesh.rotation.x += pickup.spin * 0.35 * dt;
            if (distanceSq(state.player.x, state.player.z, pickup.x, pickup.z) < CONFIG.pickups.collectRadius * CONFIG.pickups.collectRadius) {
                collectPickup(index);
            }
        }

        if (pickups.length < CONFIG.pickups.maxCount && Math.random() < dt * CONFIG.pickups.respawnRate) spawnPickup();
    }

    function collectPickup(index) {
        const pickup = pickups[index];
        const info = PICKUP_TYPES[pickup.type];
        const district = getDistrictAt(pickup.x, pickup.z);
        const gained = addScore(info.score, false, "pickups");
        addCash(info.cash || 0);
        if (info.heal) {
            const healAmount = Math.round(info.heal * (district.healMultiplier ?? 1));
            state.player.health = Math.min(getMaxHealth(), state.player.health + healAmount);
        }
        if (info.nitro) state.player.nitro = Math.min(getNitroMax(), state.player.nitro + info.nitro);
        if (info.emp) triggerEmp(pickup.x, pickup.z);
        // Grabbing cash only attracts attention once the cops are already after you.
        if (info.wanted && !(info.wanted > 0 && state.wanted.level < 1)) updateWanted(state.wanted.level + info.wanted);
        state.stats.pickups += 1;
        state.lifetime.pickups += 1;
        refreshProgress();
        audio?.pickup(pickup.type);
        spawnParticle(pickup.x, pickup.z, info.color, 16);
        setStatus(`${info.label} aufgenommen. +${Math.round(gained)} Score.`, 1.5);
        removeMesh(pickup.mesh);
        pickups.splice(index, 1);

        if (state.mission.type === "pickup") {
            if (pickup.districtId === state.mission.districtId) {
                state.mission.progress += 1;
            } else {
                setStatus(`${info.label} gesichert, aber der Auftrag läuft in ${state.mission.districtName}.`, 1.2);
            }
            if (state.mission.progress >= state.mission.target) missionSystem.complete();
        }
    }

    function updateScannerZones(dt) {
        if (!world.scannerZones?.length) return;
        let insideZone = null;
        for (const zone of world.scannerZones) {
            zone.pulse += dt * 2;
            if (zone.ring?.material) zone.ring.material.opacity = 0.3 + Math.sin(zone.pulse) * 0.08;
            if (zone.core?.material) zone.core.material.opacity = 0.07 + Math.sin(zone.pulse * 1.2) * 0.02;
            if (distanceSq(state.player.x, state.player.z, zone.x, zone.z) < zone.radius * zone.radius) insideZone = zone;
        }

        if (!insideZone) {
            scannerCharge = Math.max(0, scannerCharge - dt * 0.4);
            activeScannerZoneId = null;
            return;
        }

        if (activeScannerZoneId !== insideZone.label) {
            activeScannerZoneId = insideZone.label;
            setStatus(`Scanner-Zone: ${insideZone.label}. Dispatch trackt dein Signal schneller.`, 1.9);
        }

        scannerCharge += dt * insideZone.heatBoost * (state.time.phase === "night" ? 0.34 : 0.24);
        if (scannerCharge >= 1) {
            scannerCharge = 0;
            updateWanted(Math.min(5, state.wanted.level + 1));
            spawnParticle(insideZone.x, insideZone.z, insideZone.color ?? "#63c8ff", 16);
            setStatus(`Scanner-Treffer: ${insideZone.label} hebt Heat an.`, 1.6);
        }
    }

    function updateRoadblocks(dt) {
        state.roadblockCooldown = Math.max(0, state.roadblockCooldown - dt);

        for (let index = roadblocks.length - 1; index >= 0; index -= 1) {
            const block = roadblocks[index];
            block.life -= dt;
            block.cooldown = Math.max(0, block.cooldown - dt);
            block.mesh.position.y = 0.12 + Math.sin(block.life * 5) * 0.015;

            if (distanceSq(state.player.x, state.player.z, block.x, block.z) < (block.radius + CONFIG.player.radius) ** 2 && block.cooldown <= 0) {
                block.cooldown = 1.4;
                damagePlayer(6 + Math.abs(state.player.speed) * 0.38, "hazard");
                applySpeedFactor(state.player, 0.32);
                state.cameraShake = Math.max(state.cameraShake, 0.55);
                state.stats.roadblocks += 1;
                crashFx(0.8, { x: block.x, z: block.z });
                spawnParticle(block.x, block.z, "#ff9c45", 26);
                setStatus("Roadblock getroffen. Raus aus der Linie.", 1.8);
            }

            if (block.life <= 0 || (state.wanted.level < 2 && !block.bossOwned)) {
                removeMesh(block.mesh);
                roadblocks.splice(index, 1);
            }
        }

        if (
            state.wanted.level >= CONFIG.police.roadblockLevel &&
            roadblocks.length < CONFIG.police.roadblockMax &&
            state.roadblockCooldown <= 0
        ) {
            if (state.wanted.level >= 4 && Math.random() < 0.45) spawnSpikeStrip();
            else spawnRoadblock({ tactical: true });
            state.roadblockCooldown = Math.max(3.5, CONFIG.police.roadblockCooldown - state.wanted.level * 0.55);
        }
    }

    function updateHazards(dt) {
        for (let index = hazards.length - 1; index >= 0; index -= 1) {
            const hazard = hazards[index];
            if (hazard.warn > 0) {
                // Announced on the minimap first; the strip becomes real once the warning ends.
                hazard.warn -= dt;
                if (hazard.warn <= 0) hazard.mesh.visible = true;
                continue;
            }
            hazard.life -= dt;
            hazard.mesh.material.opacity = Math.max(0.18, hazard.life / hazard.maxLife);
            if (distanceSq(state.player.x, state.player.z, hazard.x, hazard.z) < (hazard.radius + CONFIG.player.radius) ** 2) {
                if (hazard.type === "debris") {
                    damagePlayer((hazard.damage ?? 2.2) + Math.abs(state.player.speed) * 0.1, "hazard");
                    applySpeedFactor(state.player, hazard.slowdown ?? 0.62);
                    spawnParticle(hazard.x, hazard.z, hazard.color ?? "#d9a06a", 10);
                    setStatus(hazard.message ?? "Trümmerfeld bremst dich aus.", 1.2);
                    if (hazard.consumeOnHit !== false) {
                        removeMesh(hazard.mesh);
                        hazards.splice(index, 1);
                    }
                } else if (hazard.type === "fallenLamp") {
                    damagePlayer(3.5 + Math.abs(state.player.speed) * 0.16, "hazard");
                    applySpeedFactor(state.player, hazard.slowdown ?? 0.52);
                    state.cameraShake = Math.max(state.cameraShake, 0.22);
                    spawnParticle(hazard.x, hazard.z, hazard.color ?? "#ffe08a", 12);
                    setStatus("Gefallene Laterne blockiert die Spur.", 1.4);
                } else if (hazard.type === "closureBarrier") {
                    damagePlayer(4 + Math.abs(state.player.speed) * 0.2, "hazard");
                    applySpeedFactor(state.player, 0.32);
                    state.cameraShake = Math.max(state.cameraShake, 0.28);
                    spawnParticle(hazard.x, hazard.z, "#ff9c45", 14);
                    setStatus("Sperrung blockiert die Route.", 1.4);
                } else {
                    damagePlayer(5 + Math.abs(state.player.speed) * 0.28, "hazard");
                    applySpeedFactor(state.player, 0.35);
                    state.player.nitro = Math.max(0, state.player.nitro - 22);
                    spawnParticle(hazard.x, hazard.z, "#f7fbff", 18);
                    audio?.tireBurst();
                    setStatus("Spike-Strip erwischt. Reifen verlieren Grip.", 1.8);
                    removeMesh(hazard.mesh);
                    hazards.splice(index, 1);
                }
                continue;
            }
            if (hazard.life <= 0) {
                removeMesh(hazard.mesh);
                hazards.splice(index, 1);
            }
        }
    }

    function updateHelicopter(dt) {
        const shouldBeActive = state.wanted.level >= 5 && state.running;
        state.helicopter.active = shouldBeActive;
        helicopter.visible = shouldBeActive;
        if (!shouldBeActive) {
            state.helicopter.pressure = Math.max(0, state.helicopter.pressure - dt * 0.8);
            return;
        }

        state.helicopter.angle += dt * 0.85;
        state.helicopter.x += (state.player.x + Math.cos(state.helicopter.angle) * 13 - state.helicopter.x) * dt * 1.2;
        state.helicopter.z += (state.player.z + Math.sin(state.helicopter.angle) * 13 - state.helicopter.z) * dt * 1.2;
        helicopter.position.set(state.helicopter.x, 17, state.helicopter.z);
        helicopter.rotation.y = state.helicopter.angle + Math.PI * 0.5;
        helicopter.userData.rotor.rotation.y += dt * 18;

        const inCone = distanceSq(state.player.x, state.player.z, state.helicopter.x, state.helicopter.z) < 15 * 15;
        const heliCoverFactor = getHeliCoverFactor();
        const searchlightPressure = state.time.phase === "night" ? 0.4 : 0.28;
        state.helicopter.pressure = clamp(
            state.helicopter.pressure + (inCone ? dt * searchlightPressure * heliCoverFactor : -dt * (heliCoverFactor < 0.8 ? 0.26 : 0.18)),
            0,
            1
        );
        state.helicopter.cooldown = Math.max(0, state.helicopter.cooldown - dt);
        if (state.helicopter.pressure >= 1 && state.helicopter.cooldown <= 0) {
            state.helicopter.cooldown = 3.4;
            state.helicopter.pressure = 0.38;
            damagePlayer(9, "air");
            updateWanted(5);
            state.cameraShake = Math.max(state.cameraShake, 0.25);
            spawnParticle(state.player.x, state.player.z, "#f7fbff", 18);
            setStatus("Helikopter-Suchlicht: Deckung suchen oder EMP sammeln.", 1.8);
        }
    }

    function updatePoiEffects(dt, input) {
        state.garageCooldown = Math.max(0, state.garageCooldown - dt);
        state.safehouseCooldown = Math.max(0, state.safehouseCooldown - dt);
        state.actionPrompt = "";

        const garage = getPoi("garage");
        const safehouse = getPoi("safehouse");
        const fuel = getPoi("fuel");
        const nearGarage = distanceTo(garage.x, garage.z) < CONFIG.map.poiRadius;
        const nearSafehouse = distanceTo(safehouse.x, safehouse.z) < CONFIG.map.poiRadius;
        const missionTurnInTarget = missionSystem.currentTurnInTarget();
        const missionUsesSafehouse = missionTurnInTarget && distanceSq(missionTurnInTarget.x, missionTurnInTarget.z, safehouse.x, safehouse.z) < 1;

        if (nearGarage) {
            state.actionPrompt = "E Garage öffnen";
            if (input.consume("e")) openGarage();
        }

        if (nearGarage && state.garageCooldown <= 0) {
            if (state.player.health < getMaxHealth() || state.player.nitro < getNitroMax() - 4) {
                state.mission.repairCount += 1;
                state.player.health = Math.min(getMaxHealth(), state.player.health + 18);
                state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 20);
                state.garageCooldown = 3.5;
                setStatus("Garage: Reparatur und Nitro aufgefüllt.", 2);
            }
        }
        if (nearSafehouse && state.wanted.level > 0 && !missionUsesSafehouse) {
            state.actionPrompt = state.safehouseCooldown > 0
                ? "E Safehouse: Kontakt für $120 bestechen"
                : "Safehouse: Heat-Kontakt aktiv";
            if (input.consume("e")) {
                if (spendCash(120)) {
                    updateWanted(state.wanted.level - 1);
                    state.safehouseCooldown = 1.8;
                    setStatus("Safehouse: Heat reduziert.", 2);
                    audio?.upgrade();
                } else {
                    setStatus("Nicht genug Cash für den Safehouse-Kontakt.", 1.6);
                    audio?.denied();
                }
            } else if (state.safehouseCooldown <= 0) {
                updateWanted(state.wanted.level - 1);
                state.safehouseCooldown = 4.5;
                setStatus("Safehouse: Heat reduziert.", 2);
            }
        }
        if (distanceTo(fuel.x, fuel.z) < CONFIG.map.poiRadius && state.player.nitro < getNitroMax()) {
            state.player.nitro = Math.min(getNitroMax(), state.player.nitro + dt * 16);
        }
    }

    const tagSystem = createTagSystem({ state, scene, world, getDistrictAt, addCash, addReputation, addScore, refreshProgress, setStatus, spawnParticle, spawnPopup });
    const raceSystem = createRaceSystem({
        state, scene, world, audio, sharedMaterials, roadGraph,
        getDistrictAt, getDistrictWaypointRoute: (...args) => missionSystem.getDistrictWaypointRoute(...args), distanceTo, removeMesh,
        addCash, addReputation, addScore, refreshProgress, setStatus, spawnPopup, updateWanted,
    });

    const trafficSystem = createTrafficSystem({
        traffic, state, world, scene, sharedMaterials,
        triggerNearMiss, damagePlayer, crashFx, spawnParticle, registerTrafficCrash, addAmbientHeadlights,
    });
    // Events and the boss mission place their convoys on the same districts' streets.
    const getDistrictTrafficStreets = trafficSystem.streets;
    const getDistrictTrafficPosition = trafficSystem.position;
    const missionSystem = createMissionSystem({
        state, scene, sharedMaterials, pickups, roadblocks,
        audio, updateWanted, spawnPopup, setStatus, spendCash, distanceTo, addScore, addCash, addReputation, refreshProgress,
        getNitroMax, getPoi, sampleDistrictSpawnPosition, createPickupAt, createRoadblockMesh, addAmbientHeadlights, spawnParticle, removeMesh,
        getDistrictTrafficStreets, getDistrictTrafficPosition,
    });
    const policeSystem = createPoliceSystem({
        police, traffic, state, world, scene, sharedMaterials, roadGraph,
        distanceTo, getHeatTier, refreshProgress, completeMission: missionSystem.complete, addScore, addCash, spawnRoadblock,
        spawnPopup, damagePlayer, crashFx, spawnParticle, setStatus, removeMesh, isInEscapeCover, updateWanted,
        isScannerActive: () => Boolean(activeScannerZoneId),
    });

    function updateDistrict() {
        const nextDistrict = getDistrictAt(state.player.x, state.player.z);
        if (nextDistrict.id !== state.district.id) {
            state.district = nextDistrict;
            const tier = reputationTier(state.reputation[nextDistrict.id] ?? 0);
            setStatus(`${nextDistrict.name}: Bezirksbonus ${nextDistrict.bonus}. Ruf: ${tier.tier.name}.`, 1.9);
        }
    }

    function updateTimeOfDay(dt, passive = false) {
        if (passive) return;
        if (state.modifiers.nightOnly) {
            state.time.timer = Math.max(state.time.timer, 20);
            return;
        }
        state.time.timer -= dt;
        if (state.time.timer > 0) return;

        const nextPhase = state.time.phase === "day" ? "night" : "day";
        state.time.phase = nextPhase;
        state.time.label = nextPhase === "night" ? "Nacht" : "Tag";
        state.time.timer = nextPhase === "night" ? 56 : 74;
        state.time.cycle += 1;
        weatherFx.apply();
        setStatus(
            nextPhase === "night"
                ? "Nacht fällt ein. Mehr Neon, mehr Suchlichter, höhere Event-Auszahlungen."
                : "Morgengrauen. Sicht wird stabiler und die Stadt beruhigt sich etwas.",
            2.8
        );
    }

    function updateWeather(dt, passive = false) {
        state.weather.timer -= dt;
        if (state.weather.timer <= 0 && !passive) {
            const modes = Object.keys(WEATHER_MODES);
            const current = modes.indexOf(state.weather.mode);
            const nextMode = modes[(current + 1 + Math.floor(Math.random() * (modes.length - 1))) % modes.length];
            state.weather.mode = nextMode;
            state.weather.label = WEATHER_MODES[nextMode].label;
            state.weather.timer = 32 + Math.random() * 34;
            state.weather.intensity = nextMode === "clear" ? 0 : 1;
            weatherFx.apply();
            setStatus(`Wetterwechsel: ${state.weather.label}.`, 1.8);
        }

        if (state.weather.mode === "rain" || state.weather.mode === "storm") {
            // 180 (rain) / 300 (storm) drops per second, independent of the step size
            const rainRate = state.weather.mode === "storm" ? 300 : 180;
            const rainBursts = Math.floor(rainRate * (post.getQualityConfig().particleDensity ?? 1) * dt + Math.random());
            for (let i = 0; i < rainBursts; i += 1) {
                effects.spawnRain(
                    state.player.x + (Math.random() - 0.5) * 54,
                    state.player.z + (Math.random() - 0.5) * 54
                );
            }
        }
        if (
            !passive &&
            state.weather.mode === "storm" &&
            pickups.length < CONFIG.pickups.maxCount &&
            Math.random() < dt * 0.16
        ) {
            const { x, z } = sampleDistrictSpawnPosition(state.district, false, true);
            createPickupAt("emp", x, z, state.district);
            setStatus("Gewitterfenster: EMP-Signal im Bezirk aufgetaucht.", 1.6);
        }
        updateRain(dt);
    }

    function updateWorldEvents(dt) {
        if (!state.worldEvent.active) {
            const nightRate = state.time.phase === "night" ? 1.15 : 1;
            state.worldEvent.timer -= dt * (state.district?.eventRate ?? 1) * nightRate;
            if (state.worldEvent.timer <= 0) spawnWorldEvent();
        }

        for (let index = eventPickups.length - 1; index >= 0; index -= 1) {
            const event = eventPickups[index];
            event.life -= dt;
            if (event.kind === "convoy") {
                advanceEventMover(event, dt);
            } else {
                event.mesh.rotation.y += dt * 1.8;
                event.mesh.position.y = event.baseY + Math.sin(event.life * 3) * 0.18;
            }
            state.worldEvent.timer = Math.max(0, event.life);
            state.worldEvent.x = event.x;
            state.worldEvent.z = event.z;
            if (event.kind === "race" && distanceSq(state.player.x, state.player.z, event.x, event.z) < (event.collectRadius ?? 13) ** 2) {
                if (!state.race?.active) raceSystem.start(event);
                removeWorldEvent(index);
                continue;
            }
            if (distanceSq(state.player.x, state.player.z, event.x, event.z) < (event.collectRadius ?? 13) ** 2) {
                addReputation(event.districtId, REPUTATION_GAINS.event);
                addScore(event.score, true, "events");
                const cashGain = addCash(event.cash || 0);
                if (event.heal) state.player.health = Math.min(getMaxHealth(), state.player.health + event.heal);
                if (event.nitro) state.player.nitro = Math.min(getNitroMax(), state.player.nitro + event.nitro);
                if (event.emp) triggerEmp(event.x, event.z);
                if (event.pickupBurst) spawnDistrictPickup(event.pickupBurst, event.districtId, event.x, event.z);
                updateWanted(state.wanted.level + event.heat);
                state.stats.events += 1;
                state.lifetime.events += 1;
                refreshProgress();
                spawnParticle(event.x, event.z, event.color, 34);
                setStatus(`${event.label} gesichert. Bank +$${cashGain}.`, 2.5);
                removeWorldEvent(index);
                audio?.mission();
            } else if (event.life <= 0) {
                removeWorldEvent(index);
                setStatus("Event verpasst. Dispatch ist weitergezogen.", 1.6);
            }
        }
    }



    function spawnPickup() {
        const district = chooseSpawnDistrict("pickup");
        const type = pickWeightedKey(district.pickupWeights);
        const { x, z } = sampleDistrictSpawnPosition(district, district.id === "park", district.id !== "downtown");
        createPickupAt(type, x, z, district);
    }

    function createPickupAt(type, x, z, district = getDistrictAt(x, z)) {
        const info = PICKUP_TYPES[type];
        if (!info) return null;
        const mesh = new THREE.Mesh(pickupGeo, createMaterial(info.color, {
            roughness: 0.14,
            metalness: 0.78,
            emissive: info.color,
            emissiveIntensity: 0.55,
        }));
        mesh.position.set(x, 1.35, z);
        mesh.castShadow = true;
        scene.add(mesh);
        const pickup = { mesh, type, x, z, baseY: 1.35, spin: 1.6 + Math.random() * 2.8, t: Math.random() * 10, districtId: district.id };
        pickups.push(pickup);
        return pickup;
    }

    function spawnDistrictPickup(type, districtId, x, z) {
        const district = DISTRICTS.find((entry) => entry.id === districtId) ?? getDistrictAt(x, z);
        const offsetX = (Math.random() - 0.5) * 4.5;
        const offsetZ = (Math.random() - 0.5) * 4.5;
        return createPickupAt(type, clamp(x + offsetX, -CONFIG.map.size / 2, CONFIG.map.size / 2), clamp(z + offsetZ, -CONFIG.map.size / 2, CONFIG.map.size / 2), district);
    }

    function spawnWorldEvent() {
        if (eventPickups.length > 0) return;
        const district = chooseSpawnDistrict("event");
        const eventId = pickWeightedKey(district.eventWeights);
        const event = WORLD_EVENTS.find((entry) => entry.id === eventId) ?? WORLD_EVENTS[0];
        const nightBonus = state.time.phase === "night" ? 1.22 : 1;
        const life = district.id === "harbor" ? 34 : 38;
        const eventState = createWorldEventState(event, district, life, nightBonus);
        if (!eventState) return;
        scene.add(eventState.mesh);
        eventPickups.push(eventState);
        state.worldEvent.active = true;
        state.worldEvent.label = event.label;
        state.worldEvent.timer = life;
        state.worldEvent.x = eventState.x;
        state.worldEvent.z = eventState.z;
        setStatus(`Event entdeckt: ${event.label}.`, 2);
    }

    function createWorldEventState(event, district, life, nightBonus) {
        const common = {
            ...event,
            districtId: district.id,
            score: Math.round(event.score * (district.eventScoreMultiplier ?? 1) * nightBonus),
            cash: Math.round((event.cash || 0) * (district.eventCashMultiplier ?? 1) * nightBonus),
            heat: (event.heat || 0) + (district.eventHeatBonus ?? 0),
            life,
            maxLife: life,
            collectRadius: event.kind === "convoy" ? 6.2 : 13,
        };

        if (event.kind === "convoy") {
            const axis = Math.random() < 0.5 ? "x" : "z";
            const direction = Math.random() < 0.5 ? -1 : 1;
            const streetOptions = getDistrictTrafficStreets(axis, district);
            const street = streetOptions[Math.floor(Math.random() * streetOptions.length)];
            const pos = getDistrictTrafficPosition(axis, district);
            const x = axis === "x" ? pos : street;
            const z = axis === "z" ? pos : street;
            const model = event.id === "hotVan"
                ? { ...CAR_MODELS[3], name: "Hot Van", color: "#ff6a4f", trim: "#2b1515" }
                : event.id === "vipConvoy"
                    ? { ...CAR_MODELS[2], name: "VIP", color: "#7fd6ff", trim: "#102534", roof: "sport" }
                    : { ...CAR_MODELS[2], name: "Street Racer", color: "#79ffb3", trim: "#14261e", roof: "sport" };
            const mesh = createCar(model, sharedMaterials, { bodyColor: model.color, trimColor: model.trim });
            mesh.position.set(x, 0.36, z);
            mesh.rotation.y = axisYaw(axis, direction);
            const lights = addAmbientHeadlights(mesh, model, event.color);
            return {
                mesh,
                x,
                z,
                axis,
                direction,
                speed: (event.speed ?? 5.2) * (state.time.phase === "night" ? 1.08 : 1),
                baseY: 0.36,
                headlights: lights,
                nitro: event.kind === "race" ? 24 : 0,
                ...common,
            };
        }

        const allowOffroad = district.id === "park" || event.kind === "stash";
        const { x, z } = sampleDistrictSpawnPosition(district, district.id === "park" || event.kind === "stash", allowOffroad);
        let mesh = null;
        const eventMaterial = createMaterial(event.color, {
            roughness: 0.18,
            metalness: 0.7,
            emissive: event.color,
            emissiveIntensity: 0.55,
        });

        if (event.kind === "closure") {
            mesh = new THREE.Group();
            const core = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.1, 0.8), eventMaterial);
            core.position.y = 1.1;
            core.castShadow = true;
            mesh.add(core);
            const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.16, 12, 28), createMaterial("#f7fbff", {
                emissive: event.color,
                emissiveIntensity: 0.4,
                roughness: 0.18,
                metalness: 0.62,
            }));
            ring.rotation.x = Math.PI / 2;
            ring.position.y = 1.5;
            mesh.add(ring);
            mesh.position.set(x, 0, z);
            const barriers = createClosureEventBlocks(x, z);
            return { mesh, x, z, baseY: 1.4, barriers, ...common };
        }

        mesh = new THREE.Mesh(
            event.kind === "stash" ? new THREE.BoxGeometry(1.25, 1.05, 1.25) : eventGeo,
            eventMaterial
        );
        mesh.position.set(x, 1.4, z);
        mesh.castShadow = true;
        return {
            mesh,
            x,
            z,
            baseY: 1.4,
            emp: event.id === "cashDrop" && state.weather.mode === "storm" && Math.random() < 0.26,
            pickupBurst: event.id === "hiddenCache" ? "parts" : null,
            ...common,
        };
    }

    function removeWorldEvent(index) {
        const event = eventPickups[index];
        if (!event) return;
        removeMesh(event.mesh);
        if (event.barriers) {
            for (const barrier of event.barriers) {
                removeMesh(barrier.mesh);
                const hazardIndex = hazards.indexOf(barrier);
                if (hazardIndex >= 0) hazards.splice(hazardIndex, 1);
            }
        }
        eventPickups.splice(index, 1);
        state.worldEvent.active = false;
        state.worldEvent.label = "Ruhige Straßen";
        state.worldEvent.timer = 18 + Math.random() * 28;
    }

    function updateRain(dt) {
        effects.updateRain(dt);
    }

    function chooseSpawnDistrict(kind) {
        const focusChance = kind === "event" ? 0.68 : 0.58;
        if (Math.random() < focusChance) return state.district ?? DISTRICTS[0];
        return DISTRICTS[Math.floor(Math.random() * DISTRICTS.length)];
    }

    function sampleDistrictSpawnPosition(district, preferShortcut = false, allowOffroad = false) {
        if (preferShortcut && district.id === "park" && world.shortcutZones?.length) {
            const localZones = world.shortcutZones.filter((zone) => getDistrictAt(zone.x, zone.z).id === district.id);
            if (localZones.length > 0 && Math.random() < 0.72) {
                const zone = localZones[Math.floor(Math.random() * localZones.length)];
                return {
                    x: clamp(zone.x + (Math.random() - 0.5) * (zone.width - 0.8), -CONFIG.map.size / 2, CONFIG.map.size / 2),
                    z: clamp(zone.z + (Math.random() - 0.5) * (zone.depth - 0.8), -CONFIG.map.size / 2, CONFIG.map.size / 2),
                };
            }
        }

        let x = 0;
        let z = 0;
        for (let tries = 0; tries < 30; tries += 1) {
            const rawX = randomCoordinateForSign(district.x);
            const rawZ = randomCoordinateForSign(district.z);
            x = allowOffroad && Math.random() < 0.55 ? rawX : snapStreet(rawX);
            z = allowOffroad && Math.random() < 0.55 ? rawZ : snapStreet(rawZ);
            if (!insideBuilding(world, x, z, 1.5)) break;
        }
        return { x, z };
    }

    function randomCoordinateForSign(sign) {
        const min = sign < 0 ? -CONFIG.map.size / 2 : 0;
        const max = sign < 0 ? 0 : CONFIG.map.size / 2;
        return min + Math.random() * (max - min);
    }

    function pickWeightedKey(weights) {
        const entries = Object.entries(weights ?? {});
        let total = 0;
        for (const [, value] of entries) total += value;
        let roll = Math.random() * total;
        for (const [key, value] of entries) {
            roll -= value;
            if (roll <= 0) return key;
        }
        return entries[0]?.[0] ?? "cash";
    }

    function spawnRoadblock(options = {}) {
        const target = getRoadblockPlacementTarget(options);
        const axis = target.axis;
        let x = target.x;
        let z = target.z;
        x = clamp(x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
        z = clamp(z, -CONFIG.map.size / 2, CONFIG.map.size / 2);

        const mesh = createRoadblockMesh(axis);
        mesh.position.set(x, 0.12, z);
        scene.add(mesh);
        roadblocks.push({
            mesh,
            x,
            z,
            radius: 3.9,
            life: 16 + state.wanted.level * 2,
            cooldown: 0,
            tactical: Boolean(options.tactical),
        });
        audio?.warning("roadblock");
        setStatus(options.sourceAgent?.unitType === "van" ? "Police Van: Sperre auf deiner Linie." : "Dispatch: Roadblock voraus.", 1.7);
    }

    function spawnSpikeStrip() {
        const forwardX = Math.sin(state.player.rotation);
        const forwardZ = Math.cos(state.player.rotation);
        const dist = 24 + Math.random() * 18;
        let x = state.player.x + forwardX * dist;
        let z = state.player.z + forwardZ * dist;
        if (Math.abs(forwardX) > Math.abs(forwardZ)) z = snapStreet(z);
        else x = snapStreet(x);
        x = clamp(x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
        z = clamp(z, -CONFIG.map.size / 2, CONFIG.map.size / 2);

        const mesh = new THREE.Mesh(hazardGeo, createMaterial("#f7fbff", {
            roughness: 0.18,
            metalness: 0.7,
            emissive: "#63c8ff",
            emissiveIntensity: 0.28,
            transparent: true,
            opacity: 0.82,
        }));
        mesh.position.set(x, 0.16, z);
        mesh.rotation.y = Math.abs(forwardX) > Math.abs(forwardZ) ? Math.PI / 2 : 0;
        scene.add(mesh);
        mesh.visible = false;
        hazards.push({ mesh, x, z, radius: 3.2, life: 12, maxLife: 12, warn: 2.4, kind: "spike" });
        audio?.warning("spike");
        setStatus("Warnung: Spike-Strip voraus! Siehe Minimap.", 2.2);
    }

    function createRoadblockMesh(axis) {
        const group = new THREE.Group();
        const barrierMat = createMaterial("#f47d3f", { roughness: 0.42, metalness: 0.18, emissive: "#8a2f13", emissiveIntensity: 0.1 });
        const stripeMat = createMaterial("#f7fbff", { roughness: 0.28, metalness: 0.16 });
        const coneMat = createMaterial("#ff9c45", { roughness: 0.48, metalness: 0.08, emissive: "#ff7c2f", emissiveIntensity: 0.18 });

        const main = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.54, 0.48), barrierMat);
        main.position.y = 0.34;
        main.castShadow = true;
        group.add(main);

        for (const offset of [-2.2, 0, 2.2]) {
            const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.6, 0.5), stripeMat);
            stripe.position.set(offset, 0.38, 0.02);
            stripe.castShadow = true;
            group.add(stripe);
        }

        for (const offset of [-3.6, 3.6]) {
            const cone = new THREE.Mesh(new THREE.ConeGeometry(0.36, 0.9, 12), coneMat);
            cone.position.set(offset, 0.46, 0.95);
            cone.castShadow = true;
            group.add(cone);
            const coneBack = cone.clone();
            coneBack.position.z = -0.95;
            group.add(coneBack);
        }

        group.rotation.y = axis === "x" ? Math.PI / 2 : 0;
        return group;
    }

    function createHelicopterMesh() {
        const group = new THREE.Group();
        const bodyMat = createMaterial("#10151c", { roughness: 0.38, metalness: 0.38 });
        const glassMat = createMaterial("#8fd8ff", { roughness: 0.12, metalness: 0.48, emissive: "#285a78", emissiveIntensity: 0.32 });
        const lightMat = createMaterial("#f7fbff", { emissive: "#f7fbff", emissiveIntensity: 0.65, transparent: true, opacity: 0.55 });

        const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, 4.2), bodyMat);
        body.castShadow = true;
        group.add(body);

        const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.52, 1.3), glassMat);
        cabin.position.z = 1.2;
        cabin.position.y = 0.18;
        group.add(cabin);

        const tail = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 3.4), bodyMat);
        tail.position.z = -3.2;
        tail.castShadow = true;
        group.add(tail);

        const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 6.8, 28, 1, true), lightMat);
        cone.rotation.x = Math.PI;
        cone.position.y = -3.7;
        group.add(cone);

        const rotor = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.08, 0.34), createMaterial("#f7fbff", { roughness: 0.3, metalness: 0.44 }));
        rotor.position.y = 0.62;
        group.add(rotor);
        group.userData.rotor = rotor;

        group.scale.setScalar(1.15);
        return group;
    }

    function triggerEmp(x, z) {
        audio?.emp();
        let disabled = 0;
        for (let index = police.length - 1; index >= 0; index -= 1) {
            const agent = police[index];
            if (distanceSq(x, z, agent.x, agent.z) < 34 * 34) {
                removeMesh(agent.mesh);
                police.splice(index, 1);
                disabled += 1;
            }
        }
        for (let index = hazards.length - 1; index >= 0; index -= 1) {
            const hazard = hazards[index];
            if (distanceSq(x, z, hazard.x, hazard.z) < 34 * 34) {
                removeMesh(hazard.mesh);
                hazards.splice(index, 1);
            }
        }
        if (state.helicopter.active) {
            state.helicopter.pressure = 0;
            state.helicopter.cooldown = 8;
        }
        state.wanted.emp = 5;
        scannerCharge = 0;
        activeScannerZoneId = null;
        state.cameraShake = Math.max(state.cameraShake, 0.36);
        spawnParticle(x, z, "#f7fbff", 42);
        setStatus(`EMP gezündet. ${disabled} Einheiten deaktiviert.`, 2);
    }

    function addSkidMark() {
        const player = state.player;
        const model = CAR_MODELS[state.playerModelIndex];
        const driftIntensity = Math.min(1, player.drift);
        const rearX = player.x - Math.sin(player.rotation) * 1.7;
        const rearZ = player.z - Math.cos(player.rotation) * 1.7;
        effects.addSkid(rearX, rearZ, player.rotation, model.width * 0.45, 0.2 + driftIntensity * 0.1);
    }

    function updateSkidMarks(dt) {
        effects.updateSkids(dt);
    }

    function spawnPopup(text, type = "normal") {
        state.popup = { text, timer: 1.6, type };
    }

    function spawnDriftSmoke(x, z) {
        effects.spawnSmoke(x, z);
    }

    function triggerNearMiss() {
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

    /** Impact feedback: sound plus controller rumble, both scaled by the force (0..1). */
    function crashFx(force, at) {
        audio?.crash(force, at);
        state.rumble?.(Math.max(0.1, Math.min(1, force)));
    }

    function spawnParticle(x, z, color, count) {
        const density = post.getQualityConfig().particleDensity ?? 1;
        const scaled = Math.max(1, Math.round(count * density));
        effects.spawnDebris(x, z, color, scaled);
        if (count >= 14) effects.spawnSparks(x, z, Math.round(count * 1.4 * density));
    }

    function updateParticles(dt) {
        effects.updateParticles(dt);
    }

    function updatePassiveRegen(dt) {
        const player = state.player;
        player.regenCooldown = Math.max(0, (player.regenCooldown ?? 0) - dt);
        if (player.regenCooldown > 0) return;
        const maxHp = getMaxHealth();
        if (player.health >= maxHp) return;
        // Slow regen, faster when heat is clear and not at critical HP
        const regenRate = state.wanted.level === 0 ? 1.1 : 0.3;
        player.health = Math.min(maxHp, player.health + regenRate * dt);
    }

    function damagePlayer(amount, source = "generic") {
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

    /** A traffic crash raises heat only if a cop saw it, or on the third crash within 10 s. */
    function registerTrafficCrash() {
        const now = performance.now() / 1000;
        crashLog.push(now);
        while (crashLog.length && now - crashLog[0] > 10) crashLog.shift();
        const witnessed = police.some((agent) => !agent.leaving && agent.los && distanceTo(agent.x, agent.z) < 45);
        if (witnessed || crashLog.length >= 3) updateWanted(state.wanted.level + 1);
    }

    function updateWanted(level) {
        const previous = state.wanted.level;
        state.wanted.level = clamp(Math.round(level), 0, 5);
        state.wanted.tier = getHeatTier().name;
        if (state.wanted.level > previous) {
            state.cameraShake = Math.max(state.cameraShake, 0.12 + state.wanted.level * 0.03);
            if (state.running) audio?.stinger(state.wanted.level, true);
        } else if (state.wanted.level < previous && state.running) {
            audio?.stinger(state.wanted.level, false);
        }
    }

    function addScore(amount, missionReward = false, category = missionReward ? "missions" : "other") {
        if (amount <= 0) return 0;
        registerCombo(state.combo, {
            missionReward,
            heatScore: HEAT_TIERS[state.wanted.level].score,
            provokeBonus: (state.provoke?.active ?? 0) > 0 ? 0.5 : 0,
        });
        const gained = amount * state.combo.multiplier;
        state.score += gained;
        state.stats.breakdown[category] = (state.stats.breakdown[category] ?? 0) + gained;
        refreshProgress();
        return gained;
    }

    /** Adds district reputation and announces tier-ups (with their unlock) once. */
    function addReputation(districtId, amount) {
        if (!districtId || amount <= 0) return;
        const before = reputationTier(state.reputation[districtId] ?? 0).index;
        state.reputation[districtId] = (state.reputation[districtId] ?? 0) + amount;
        const after = reputationTier(state.reputation[districtId]);
        if (after.index > before) {
            const name = DISTRICTS.find((district) => district.id === districtId)?.name ?? districtId;
            const unlock = after.tier.unlock;
            if (unlock && !state.unlocks.includes(unlock)) state.unlocks.push(unlock);
            setStatus(`Ruf in ${name}: ${after.tier.name}! ${unlock ? `Freigeschaltet: ${unlock}.` : ""}`, 4);
            spawnPopup(`RUF: ${after.tier.name.toUpperCase()}`, "bounty");
            audio?.upgrade?.();
        }
        persistProfile();
    }

    function addCash(amount) {
        if (!amount) return 0;
        let multiplier = state.screen === "playing" ? state.district?.cashMultiplier ?? 1 : 1;
        if (state.screen === "playing" && state.district) {
            multiplier *= 1 + reputationTier(state.reputation[state.district.id] ?? 0).tier.cashBonus;
        }
        // Phase 6.1: provoke cash boost on pickups
        if ((state.provoke?.active ?? 0) > 0) multiplier *= 1.5;
        const gained = Math.round(amount * multiplier);
        state.cash += gained;
        state.stats.cashEarned += gained;
        persistProfile();
        return gained;
    }

    // Phase 6.1: Provoke action
    function tryProvoke() {
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

    function spendCash(amount) {
        if (state.cash < amount) return false;
        state.cash -= amount;
        persistProfile();
        return true;
    }

    function updateCombo(dt) {
        if (tickCombo(state.combo, dt)) return;
        if (state.combo.timer <= 0) state.combo.driftBank = 0;
    }

    function getMaxHealth() {
        return maxHealth(state.upgrades);
    }

    function getNitroMax() {
        return nitroCapacity(state.upgrades);
    }

    function getUpgradeCost(id) {
        const level = state.upgrades[id] ?? 0;
        return Math.round(UPGRADES[id].baseCost * (1 + level * 0.72 + level * level * 0.18) / 10) * 10;
    }

    function getHeatTier() {
        return HEAT_TIERS[clamp(state.wanted.level, 0, HEAT_TIERS.length - 1)];
    }

    function isContractAvailable(contract) {
        return !contract.district || reputationTier(state.reputation[contract.district] ?? 0).index >= 2;
    }

    function refreshProgress() {
        const contract = CONTRACTS.find((item) => item.id === state.contract.id) ?? CONTRACTS[0];
        state.contract.progress = Math.min(contract.target, (state.contract.base ?? 0) + getRunMetric(contract.metric));
        if (!state.contract.claimed && state.contract.progress >= contract.target) {
            state.contract.completed = true;
            state.contract.claimed = true;
            addCash(contract.reward);
            setStatus(`Contract abgeschlossen: ${contract.label}. +$${contract.reward}`, 2.6);
            audio?.mission();
        }

        for (const achievement of ACHIEVEMENTS) {
            if (state.achievements.includes(achievement.id)) continue;
            if (getLifetimeMetric(achievement.metric) >= achievement.target) {
                state.achievements.push(achievement.id);
                state.stats.unlocked.push(achievement.label);
                addCash(achievement.reward);
                setStatus(`Achievement: ${achievement.label}. +$${achievement.reward}`, 3);
                audio?.achievement();
            }
        }
        persistProfile();
    }

    function getRunMetric(metric) {
        return state.stats[metric] ?? 0;
    }

    function getLifetimeMetric(metric) {
        if (metric === "lifetimeMissions") return state.lifetime.missions;
        if (metric === "lifetimePickups") return state.lifetime.pickups;
        if (metric === "lifetimeProps") return state.lifetime.props;
        if (metric === "bestScore") return Math.max(state.bestScore, Math.round(state.score));
        if (metric === "unlockedCars") return state.unlockedCars.length;
        return 0;
    }

    function getDistrictAt(x, z) {
        const sx = x < 0 ? -1 : 1;
        const sz = z < 0 ? -1 : 1;
        return DISTRICTS.find((district) => district.x === sx && district.z === sz) ?? DISTRICTS[0];
    }

    function isInsideShortcutZone(x, z) {
        if (!world.shortcutZones?.length) return false;
        for (const zone of world.shortcutZones) {
            if (Math.abs(x - zone.x) <= zone.width / 2 && Math.abs(z - zone.z) <= zone.depth / 2) return true;
        }
        return false;
    }

    // Phase 6.4: off-road detection — Park grass slows car down
    function buyUpgrade(id) {
        if (!UPGRADES[id]) return;
        const level = state.upgrades[id] ?? 0;
        if (level >= UPGRADES[id].max) {
            setStatus(`${UPGRADES[id].label} ist bereits voll ausgebaut.`, 1.5);
            audio?.denied();
            return;
        }
        const cost = getUpgradeCost(id);
        if (!spendCash(cost)) {
            setStatus(`Garage: $${cost} benötigt für ${UPGRADES[id].label}.`, 1.8);
            audio?.denied();
            return;
        }
        state.upgrades[id] += 1;
        if (id === "armor") state.player.health = Math.min(getMaxHealth(), state.player.health + 28);
        if (id === "nitro") state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 34);
        spawnParticle(state.player.x, state.player.z, "#c9a5ff", 18);
        setStatus(`${UPGRADES[id].label} Level ${state.upgrades[id]} installiert.`, 2);
        audio?.upgrade();
        persistProfile();
    }

    function buyOrSelectCar(index) {
        const car = CAR_MODELS[index];
        if (!car) return;
        if (!state.unlockedCars.includes(car.id)) {
            if (!spendCash(car.unlockCost)) {
                setStatus(`${car.name} kostet $${car.unlockCost}.`, 1.8);
                audio?.denied();
                return;
            }
            state.unlockedCars.push(car.id);
            setStatus(`${car.name} freigeschaltet.`, 2);
            audio?.upgrade();
            refreshProgress();
        }
        switchCar(index);
        persistProfile();
    }

    function startRun() {
        reset({ showMenu: false });
    }

    function openMenu() {
        state.screen = "menu";
        state.paused = true;
        persistProfile();
    }

    function openGarage() {
        state.lastScreen = state.screen === "garage" ? state.lastScreen : state.screen;
        state.screen = "garage";
        state.paused = true;
        persistProfile();
    }

    function closeGarage() {
        state.screen = state.lastScreen === "playing" ? "playing" : "menu";
        state.paused = state.screen !== "playing";
        if (state.running) setStatus("Garage geschlossen.", 1.2);
    }

    function toggleGarage() {
        if (state.screen === "garage") closeGarage();
        else openGarage();
    }

    function setPaintById(id) {
        const paint = PAINTS.find((entry) => entry.id === id);
        if (!paint) return;
        if (paint.unlock && !state.unlocks.includes(paint.unlock)) {
            setStatus(`${paint.label}: noch gesperrt (${paint.unlock}).`, 1.8);
            audio?.denied?.();
            return;
        }
        state.paint = paint.id;
        persistProfile();
        setStatus(`Lackierung: ${paint.label}.`, 1.4);
    }

    function resetProfile() {
        clearProfile();
        const fresh = createDefaultProfile(CAR_MODELS, UPGRADES);
        state.cash = fresh.cash;
        state.bestScore = 0;
        state.unlockedCars = [...fresh.unlockedCars];
        state.achievements = [];
        state.reputation = { ...fresh.reputation };
        state.tags = [];
        state.unlocks = [];
        state.paint = "default";
        for (const tag of world.tags ?? []) {
            tag.collected = false;
            tag.mesh.visible = true;
        }
        state.lifetime = { ...fresh.lifetime };
        state.upgrades = { ...fresh.upgrades };
        state.playerModelIndex = 0;
        state.profile = fresh;
        replaceCarModel(playerCar, CAR_MODELS[0], sharedMaterials);
        setStatus("Profil gelöscht. Neustart bereit.", 2);
        openMenu();
    }

    // Saves are throttled: callers only mark the profile dirty, the actual localStorage
    // write happens at most every PROFILE_FLUSH_MS (plus on tab hide / close).
    function persistProfile() {
        state.bestScore = Math.max(state.bestScore, Math.round(state.score));
        profileDirty = true;
        if (performance.now() - lastProfileFlush >= PROFILE_FLUSH_MS) flushProfile();
    }

    function flushProfile() {
        if (!profileDirty) return;
        profileDirty = false;
        lastProfileFlush = performance.now();
        state.profile = {
            version: SAVE_VERSION,
            bestScore: Math.max(state.bestScore, Math.round(state.score)),
            cash: Math.max(0, Math.round(state.cash)),
            selectedCarId: CAR_MODELS[state.playerModelIndex].id,
            unlockedCars: [...state.unlockedCars],
            upgrades: { ...state.upgrades },
            achievements: [...state.achievements],
            reputation: { ...state.reputation },
            tags: [...state.tags],
            unlocks: [...state.unlocks],
            paint: state.paint,
            contract: { id: state.contract.id, progress: state.contract.progress, claimed: state.contract.claimed },
            lifetime: { ...state.lifetime },
        };
        state.bestScore = state.profile.bestScore;
        saveProfile(state.profile);
    }

    function destroyObstacle(obstacle, impact) {
        if (!obstacle.mesh || obstacle.destroyed) return;
        obstacle.destroyed = true;
        removeMesh(obstacle.mesh);
        const index = world.obstacles.indexOf(obstacle);
        if (index >= 0) world.obstacles.splice(index, 1);
        const reward = obstacle.reward ?? Math.round(20 + impact * 5);
        addScore(reward, false, "props");
        state.stats.propsDestroyed += 1;
        state.lifetime.props += 1;
        refreshProgress();
        const reaction = {
            color: obstacle.color ?? "#ffc64d",
            particleCount: obstacle.particleCount ?? 14,
            hitDamageScale: obstacle.hitDamageScale ?? 0.55,
            speedDamping: obstacle.speedDamping ?? 0.34,
            shake: obstacle.shake ?? 0.22,
        };
        triggerObstacleChainReaction(obstacle, impact, reaction);
        spawnParticle(obstacle.x, obstacle.z, reaction.color, reaction.particleCount);
        setStatus(getDestructionMessage(obstacle, reward), 1.4);
        return reaction;
    }

    function getDestructionMessage(obstacle, reward) {
        if (obstacle.type === "sign") return `Schild umgerissen. +${reward} Score.`;
        if (obstacle.type === "crate") return `Kisten zerplatzt. +${reward} Score.`;
        if (obstacle.type === "harborCrate") return `Hafenkisten aufgebrochen. +${reward} Score.`;
        if (obstacle.type === "fence") return `Zaun durchbrochen. +${reward} Score.`;
        if (obstacle.type === "lamp") return `Laterne umgefahren. +${reward} Score.`;
        if (obstacle.type === "dumpster") return `Müllcontainer weggeschoben. +${reward} Score.`;
        if (obstacle.type === "constructionBeacon") return `Baustellenbake zerlegt. +${reward} Score.`;
        return `${obstacle.label ?? "Prop"} zerlegt. +${reward} Score.`;
    }

    const policeGlow = [0, 1].map(() => {
        const light = new THREE.PointLight("#ff2040", 0, 18, 2);
        scene.add(light);
        return light;
    });

    const flameMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(0.5, 1.8, 3.2),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    });
    const flameGeometry = new THREE.ConeGeometry(0.16, 1, 8).rotateX(-Math.PI / 2);
    const flames = [-1, 1].map((side) => {
        const flame = new THREE.Mesh(flameGeometry, flameMaterial);
        flame.visible = false;
        flame.userData.side = side;
        playerCar.add(flame);
        return flame;
    });
    let trailTimer = 0;

    function updateNitroFlame(dt) {
        const model = playerCar.userData.model;
        const on = Boolean(state.player.nitroActive) && state.screen === "playing";
        const flicker = 0.75 + Math.random() * 0.5;
        for (const flame of flames) {
            flame.visible = on;
            if (!on) continue;
            flame.position.set(flame.userData.side * model.width * 0.3, -0.05, -model.length / 2 - 0.45 * flicker);
            flame.scale.set(1, 1, 1.4 * flicker);
            flame.rotation.y = Math.PI;
        }
        if (on) {
            trailTimer -= dt;
            if (trailTimer <= 0) {
                trailTimer = 0.035;
                const p = state.player;
                effects.spawnSmoke(p.x - Math.sin(p.rotation) * 2.4, p.z - Math.cos(p.rotation) * 2.4, {
                    color: "#4fc3ff",
                    additive: true,
                    alpha: 0.5,
                    size: 1.1,
                    grow: 0.8,
                    life: 0.35,
                    rise: 0.1,
                    y: 0.4,
                });
            }
        }
    }

    /** Wheel spin, steering, body roll/pitch, brake lights, lightbars and the shared police glow. */
    function updateVehicleVisuals(dt) {
        const player = state.player;
        const night = 1 - (state.time.daylight ?? 1);
        applyTuning(playerCar, { ...state.upgrades, neon: state.unlocks.includes("Kosmetik Unterboden-Neon") });
        const paint = PAINTS.find((entry) => entry.id === state.paint && (!entry.unlock || state.unlocks.includes(entry.unlock))) ?? PAINTS[0];
        if (playerCar.userData.parts.paintKey !== paint.id) {
            playerCar.userData.parts.paintKey = paint.id;
            setPaint(playerCar, paint.color, paint.chrome);
        }
        setHeadlightBeamLevel(Math.min(1, night + (state.weather.mode === "fog" ? 0.5 : 0)));
        updateCarVisuals(playerCar, dt, {
            speed: player.speed,
            steer: state.lastTurnInput ?? 0,
            turn: state.lastTurnInput ?? 0,
            braking: Boolean(player.braking),
            night: Math.min(1, night + (state.weather.mode === "fog" ? 0.5 : 0)),
            tilt: true,
        });
        updateNitroFlame(dt);
        for (const car of traffic) {
            const dir = car.speed ?? 0;
            updateCarVisuals(car.mesh, dt, { speed: dir, braking: car.speed < (car.naturalSpeed ?? 0) * 0.6 });
        }
        let nearA = null;
        let nearB = null;
        let distA = Infinity;
        let distB = Infinity;
        for (const agent of police) {
            updateCarVisuals(agent.mesh, dt, { speed: agent.speed ?? 0, braking: (agent.speed ?? 0) < 1.5 });
            const d = distanceSq(player.x, player.z, agent.x, agent.z);
            if (d < distA) {
                nearB = nearA;
                distB = distA;
                nearA = agent;
                distA = d;
            } else if (d < distB) {
                nearB = agent;
                distB = d;
            }
        }
        const flash = Math.floor(performance.now() / 140) % 2 === 0;
        [nearA, nearB].forEach((agent, i) => {
            const light = policeGlow[i];
            if (!agent || (i === 0 ? distA : distB) > 45 * 45) {
                light.intensity = 0;
                return;
            }
            light.position.set(agent.x, 2.2, agent.z);
            light.color.set(flash === (i === 0) ? "#ff2040" : "#2f6bff");
            light.intensity = 9 + 6 * Math.abs(Math.sin(performance.now() / 70));
        });
    }

    function updateDebug(dt) {
        debugClock.frames += 1;
        debugClock.timer += dt;
        if (debugClock.timer >= 0.5) {
            state.debug.fps = debugClock.frames / debugClock.timer;
            state.debug.entities = traffic.length + police.length + pickups.length + roadblocks.length + hazards.length + eventPickups.length;
            state.debug.drawCalls = renderer.info.render.calls;
            state.debug.triangles = renderer.info.render.triangles;
            state.debug.geometries = renderer.info.memory.geometries;
            state.debug.textures = renderer.info.memory.textures;
            debugClock.frames = 0;
            debugClock.timer = 0;
        }
    }

    function setStatus(text, duration) {
        state.statusMessage = text;
        state.statusTimer = duration;
    }

    function removeMesh(mesh) {
        scene.remove(mesh);
        disposeObject(mesh);
    }

    function clearEntities(array) {
        for (let index = array.length - 1; index >= 0; index -= 1) {
            removeMesh(array[index].mesh);
        }
        array.length = 0;
    }

    function getPoi(id) {
        return POIS.find((poi) => poi.id === id);
    }

    function distanceTo(x, z) {
        return Math.sqrt(distanceSq(state.player.x, state.player.z, x, z));
    }
    function getRoadblockPlacementTarget(options = {}) {
        const missionTarget = missionSystem.getNavigationTarget();
        if (options.sourceAgent) {
            const axis = Math.abs(Math.sin(options.sourceAgent.rotation)) > Math.abs(Math.cos(options.sourceAgent.rotation)) ? "x" : "z";
            return snapRoadblockTarget(options.sourceAgent.x, options.sourceAgent.z, axis);
        }
        if (options.tactical && missionTarget && Math.random() < 0.45) {
            const axis = Math.abs(state.player.x - missionTarget.x) > Math.abs(state.player.z - missionTarget.z) ? "x" : "z";
            return snapRoadblockTarget(missionTarget.x, missionTarget.z, axis);
        }
        const forwardX = Math.sin(state.player.rotation);
        const forwardZ = Math.cos(state.player.rotation);
        const dist = 28 + Math.random() * 22;
        const rawX = state.player.x + forwardX * dist;
        const rawZ = state.player.z + forwardZ * dist;
        const axis = Math.abs(forwardX) > Math.abs(forwardZ) ? "x" : "z";
        return snapRoadblockTarget(rawX, rawZ, axis);
    }

    function snapRoadblockTarget(x, z, axis) {
        let nextX = x;
        let nextZ = z;
        if (axis === "x") nextZ = snapStreet(z);
        else nextX = snapStreet(x);
        if (Math.random() < 0.45) {
            nextX = snapStreet(nextX);
            nextZ = snapStreet(nextZ);
        }
        return { x: nextX, z: nextZ, axis };
    }

    function isInEscapeCover(x, z) {
        if (isNearCraneCover(x, z)) return true;
        const district = getDistrictAt(x, z);
        if (district.id !== "downtown" && district.id !== "industrial") return false;
        for (const building of buildingsNear(world, x, z)) {
            if ((building.h ?? 0) < 12) continue;
            const edgeDx = Math.max(0, Math.abs(x - building.x) - building.hw);
            const edgeDz = Math.max(0, Math.abs(z - building.z) - building.hd);
            const edgeDistance = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
            if (edgeDistance < 3.4) return true;
        }
        return false;
    }

    function isNearCraneCover(x, z) {
        for (const obstacle of obstaclesNear(world, x, z)) {
            if (obstacle.destroyed) continue;
            if (obstacle.type !== "crane" && obstacle.type !== "dockContainer") continue;
            if (distanceSq(x, z, obstacle.x, obstacle.z) < 7.2 * 7.2) return true;
        }
        return false;
    }

    function getHeliCoverFactor() {
        if (isNearCraneCover(state.player.x, state.player.z)) return 0.42;
        if (isInEscapeCover(state.player.x, state.player.z)) return 0.62;
        if (state.player.inShortcut) return 0.82;
        return 1;
    }

    function addAmbientHeadlights(mesh, model, color = "#fff6a8") {
        const left = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 8),
            createMaterial(color, { roughness: 0.18, metalness: 0.52, emissive: color, emissiveIntensity: 0.2 })
        );
        left.position.set(-model.width * 0.28, 0.16, model.length * 0.56);
        const right = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 8),
            createMaterial(color, { roughness: 0.18, metalness: 0.52, emissive: color, emissiveIntensity: 0.2 })
        );
        right.position.set(model.width * 0.28, 0.16, model.length * 0.56);
        mesh.add(left);
        mesh.add(right);
        return [left, right];
    }

    function createClosureEventBlocks(x, z) {
        const axis = Math.random() < 0.5 ? "x" : "z";
        const barriers = [];
        for (const offset of [-4.2, 0, 4.2]) {
            const bx = axis === "x" ? x + offset : x;
            const bz = axis === "z" ? z + offset : z;
            const mesh = new THREE.Mesh(
                axis === "x" ? new THREE.BoxGeometry(2.4, 1.1, 0.6) : new THREE.BoxGeometry(0.6, 1.1, 2.4),
                createMaterial("#ff9c45", {
                    roughness: 0.42,
                    metalness: 0.16,
                    emissive: "#7e3614",
                    emissiveIntensity: 0.16,
                    transparent: true,
                    opacity: 0.88,
                })
            );
            mesh.position.set(bx, 0.56, bz);
            mesh.castShadow = true;
            scene.add(mesh);
            const hazard = {
                mesh,
                x: bx,
                z: bz,
                radius: axis === "x" ? 1.5 : 1.3,
                life: 36,
                maxLife: 36,
                type: "closureBarrier",
                eventOwned: true,
            };
            hazards.push(hazard);
            barriers.push(hazard);
        }
        return barriers;
    }

    function advanceEventMover(event, dt) {
        const move = event.speed * event.direction * dt;
        if (event.axis === "x") event.x += move;
        else event.z += move;

        const district = DISTRICTS.find((entry) => entry.id === event.districtId) ?? DISTRICTS[0];
        const minX = district.x < 0 ? -CONFIG.map.size / 2 + 2 : 2;
        const maxX = district.x < 0 ? -2 : CONFIG.map.size / 2 - 2;
        const minZ = district.z < 0 ? -CONFIG.map.size / 2 + 2 : 2;
        const maxZ = district.z < 0 ? -2 : CONFIG.map.size / 2 - 2;

        if (event.x <= minX || event.x >= maxX) {
            event.direction *= -1;
            event.x = clamp(event.x, minX, maxX);
        }
        if (event.z <= minZ || event.z >= maxZ) {
            event.direction *= -1;
            event.z = clamp(event.z, minZ, maxZ);
        }
        event.mesh.position.set(event.x, event.baseY, event.z);
        event.mesh.rotation.y = axisYaw(event.axis, event.direction);
        if (event.headlights) {
            const headlightIntensity = state.time.phase === "night" ? 1 : state.weather.mode === "fog" ? 0.72 : 0.25;
            for (const light of event.headlights) light.material.emissiveIntensity = headlightIntensity;
        }
    }

    function triggerObstacleChainReaction(obstacle, impact, reaction) {
        if (obstacle.type === "lamp") {
            spawnFallenLampHazard(obstacle, reaction.color);
            return;
        }
        if (obstacle.type === "crate" || obstacle.type === "harborCrate") {
            spawnCrateDebrisField(obstacle, obstacle.type === "harborCrate" ? "#8bc7df" : "#d9a06a");
            return;
        }
        if (obstacle.type === "fence") {
            spawnFenceGapDebris(obstacle);
            if (state.wanted.level > 0) {
                policeSystem.scramble(obstacle.x, obstacle.z, 26);
                state.wanted.decay += 1.4;
                setStatus("Zaun durchbrochen. Sichtlinie kurz gestört.", 1.4);
            }
            return;
        }
        if (obstacle.type === "dumpster" && impact > 11) {
            spawnHeavyDebris(obstacle, "#7b8790", 2);
        }
    }

    function spawnFallenLampHazard(obstacle, color) {
        const horizontal = Math.random() < 0.5;
        const mesh = new THREE.Mesh(
            horizontal ? new THREE.BoxGeometry(5.8, 0.22, 0.34) : new THREE.BoxGeometry(0.34, 0.22, 5.8),
            createMaterial("#2d333b", {
                roughness: 0.52,
                metalness: 0.22,
                emissive: color,
                emissiveIntensity: 0.12,
                transparent: true,
                opacity: 0.82,
            })
        );
        mesh.position.set(obstacle.x, 0.18, obstacle.z);
        scene.add(mesh);
        hazards.push({
            mesh,
            x: obstacle.x,
            z: obstacle.z,
            radius: horizontal ? 2.8 : 2.1,
            life: 8.5,
            maxLife: 8.5,
            type: "fallenLamp",
            color,
            slowdown: 0.42,
        });
    }

    function spawnCrateDebrisField(obstacle, color) {
        const pieces = 3 + Math.floor(Math.random() * 3);
        for (let index = 0; index < pieces; index += 1) {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.6 + Math.random() * 0.35, 0.26, 0.6 + Math.random() * 0.35),
                createMaterial(color, {
                    roughness: 0.82,
                    metalness: 0.04,
                    transparent: true,
                    opacity: 0.82,
                })
            );
            const x = obstacle.x + (Math.random() - 0.5) * 3.2;
            const z = obstacle.z + (Math.random() - 0.5) * 3.2;
            mesh.position.set(x, 0.16, z);
            scene.add(mesh);
            hazards.push({
                mesh,
                x,
                z,
                radius: 0.58,
                life: 7.2,
                maxLife: 7.2,
                type: "debris",
                color,
                damage: 2.6,
                slowdown: 0.7,
                message: "Kistensplitter liegen auf der Fahrbahn.",
            });
        }
    }

    function spawnFenceGapDebris(obstacle) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(1.8, 0.16, 0.36),
            createMaterial("#c2d2da", {
                roughness: 0.58,
                metalness: 0.18,
                transparent: true,
                opacity: 0.72,
            })
        );
        mesh.position.set(obstacle.x, 0.1, obstacle.z);
        mesh.rotation.y = Math.random() * Math.PI;
        scene.add(mesh);
        hazards.push({
            mesh,
            x: obstacle.x,
            z: obstacle.z,
            radius: 0.9,
            life: 3.8,
            maxLife: 3.8,
            type: "debris",
            color: "#c2d2da",
            damage: 1.5,
            slowdown: 0.82,
            message: "Zaunreste schlittern über den Asphalt.",
        });
    }

    function spawnHeavyDebris(obstacle, color, count = 2) {
        for (let index = 0; index < count; index += 1) {
            const mesh = new THREE.Mesh(
                new THREE.BoxGeometry(0.9, 0.32, 0.9),
                createMaterial(color, {
                    roughness: 0.74,
                    metalness: 0.08,
                    transparent: true,
                    opacity: 0.8,
                })
            );
            const x = obstacle.x + (Math.random() - 0.5) * 2.1;
            const z = obstacle.z + (Math.random() - 0.5) * 2.1;
            mesh.position.set(x, 0.18, z);
            scene.add(mesh);
            hazards.push({
                mesh,
                x,
                z,
                radius: 0.74,
                life: 6.5,
                maxLife: 6.5,
                type: "debris",
                color,
                damage: 3.2,
                slowdown: 0.64,
                message: "Schwerer Schrott liegt im Weg.",
            });
        }
    }

    return {
        reset,
        update,
        switchCar,
        startRun,
        openMenu,
        openGarage,
        closeGarage,
        buyUpgrade,
        buyOrSelectCar,
        setPaint: setPaintById,
        resetProfile,
        // Dev-only handles for in-browser checks.
        debug: import.meta.env?.DEV ? { startRace: raceSystem.start, tags: tagSystem.tags, traffic, police, missions: missionSystem } : null,
    };
}
