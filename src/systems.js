import * as THREE from "three";
import { ACHIEVEMENTS, CONFIG, CAR_MODELS, CONTRACTS, DISTRICTS, HEAT_TIERS, PICKUP_TYPES, POIS, DISTRICT_CONTRACTS, PAINTS, POLICE_UNITS, RACE, REPUTATION_GAINS, REPUTATION_TIERS, TAGS_PER_DISTRICT, UPGRADES, VEHICLE_PHYSICS, WEATHER_MODES, WORLD_EVENTS } from "./config.js";
import { BOSS_MISSIONS, MISSION_CHAINS, MISSION_MODIFIERS, resolveMission } from "./data/missions.js";
import { generateTags, reputationTier } from "./progression.js";
import { buildRoadGraph, hasLineOfSight, nextWaypoint, nearestNode } from "./ai/police.js";
import { applyEngine, applyGrip, applySpeedFactor, applySteering, cancelNormalVelocity, deriveSpec, glancingWallImpact, headOnDamp, surfaceAt, updateDrift } from "./physics/vehicle.js";
import { clearProfile, createDefaultProfile, saveProfile } from "./save.js";
import { hideGameOver, renderHud, showGameOver } from "./ui.js";
import { createEffects, disposeObject, markShared } from "./effects.js";
import { applyTuning, createCar, createMaterial, replaceCarModel, setHeadlightBeamLevel, setPaint, updateCarVisuals } from "./vehicles.js";
import { buildingsNear, insideBuilding, obstacleAt, obstaclesNear, pushOutBuildings, snapStreet } from "./world.js";

const MISSION_DISTRICT_ORDER = ["downtown", "industrial", "park", "harbor"];

const PHYSICS_DT = 1 / 60;
const PHYSICS_MAX_STEPS = 5;
const PROFILE_FLUSH_MS = 2000;

const DISTRICT_MISSION_POINTS = {
    downtown: [
        { name: "Skyline Nord", x: 41, z: 47 },
        { name: "Bankpassage", x: 16, z: 38 },
        { name: "Boulevard Mitte", x: 38, z: 16 },
        { name: "Tower Arc", x: 50, z: 28 },
    ],
    industrial: [
        { name: "Werkhof", x: -42, z: 44 },
        { name: "Containerbogen", x: -15, z: 18 },
        { name: "Rostkurve", x: -46, z: 16 },
        { name: "Schienenkante", x: -22, z: 46 },
    ],
    park: [
        { name: "Nordweg", x: 41, z: -48 },
        { name: "Pavillon", x: 15, z: -41 },
        { name: "Wiesenbogen", x: 48, z: -17 },
        { name: "Seerand", x: 24, z: -18 },
    ],
    harbor: [
        { name: "Dock West", x: -48, z: -41 },
        { name: "Kranlinie", x: -22, z: -48 },
        { name: "Pier Ost", x: -16, z: -21 },
        { name: "Slip-Rampe", x: -44, z: -15 },
    ],
};

export function createGameRuntime({ scene, camera, renderer, world, ui, state, sharedMaterials, audio, lights, post }) {
    const pickups = [];
    const police = [];
    const traffic = [];
    const roadblocks = [];
    const hazards = [];
    const eventPickups = [];
    const effects = createEffects(scene);
    let missionBoss = null;
    const helicopter = createHelicopterMesh();
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const eventGeo = new THREE.DodecahedronGeometry(0.85, 0);
    const hazardGeo = new THREE.BoxGeometry(4.8, 0.08, 0.7);
    markShared(pickupGeo, eventGeo, hazardGeo);
    const roadGraph = buildRoadGraph();
    const crashLog = [];
    const tempTarget = new THREE.Vector3();
    const cameraBase = new THREE.Vector3();
    let cameraBaseReady = false;
    let cameraZoom = 0;
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
        endRace(true);
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
        clearMissionBoss();

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

        setMission(1);
        for (let index = 0; index < CONFIG.pickups.startCount; index += 1) spawnPickup();
        for (let index = 0; index < CONFIG.traffic.startCount; index += 1) spawnTraffic();
        applyWeatherVisuals();
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

        updateTraffic(dt);
        updatePolice(dt);
        updatePlayer(dt, input);
        updatePassiveRegen(dt);
        updateMission(dt);
        updateDistrict();
        updateScannerZones(dt);
        updateTimeOfDay(dt);
        updateWeather(dt);
        updateWorldEvents(dt);
        updateRace(dt);
        updateTags(dt);
        updatePickups(dt);
        updateRoadblocks(dt);
        updateHazards(dt);
        updateHelicopter(dt);
        updatePoiEffects(dt, input);
        updateMissionInteraction(input);
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
        updateWorldVisuals(realDt);

        if (!state.running || state.paused || state.screen !== "playing") {
            physicsAccumulator = 0;
            updateParticles(realDt);
            updateTimeOfDay(realDt, true);
            updateWeather(realDt, true);
            updateCamera(realDt);
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
        updateCamera(realDt);
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

    function setMission(stage, options = {}) {
        clearMissionBoss();
        state.mission.failed = false;
        const chainStage = (stage - 1) % 3;
        const bossMission = shouldSpawnBossMission(stage);
        const baseDistrictId = MISSION_DISTRICT_ORDER[Math.floor((stage - 1) / 3) % MISSION_DISTRICT_ORDER.length];
        const missionConfig = bossMission
            ? buildBossMissionConfig(stage, baseDistrictId)
            : buildMissionConfig(stage, baseDistrictId, chainStage);
        const missionDistrict = DISTRICTS.find((district) => district.id === (missionConfig.districtId ?? baseDistrictId)) ?? DISTRICTS[0];
        state.mission.stage = stage;
        applyMissionModifier(missionConfig, stage, bossMission, options.keepModifier);
        state.mission.progress = 0;
        state.mission.cargo = false;
        state.mission.route = [];
        state.mission.routeIndex = 0;
        state.mission.type = missionConfig.type;
        state.mission.target = missionConfig.target;
        state.mission.timer = missionConfig.timer;
        state.mission.startTimer = missionConfig.timer;
        state.mission.from = missionConfig.from ?? null;
        state.mission.to = missionConfig.to ?? null;
        state.mission.route = missionConfig.route ?? [];
        state.mission.routeIndex = 0;
        state.mission.districtId = missionDistrict.id;
        state.mission.districtName = missionDistrict.name;
        state.mission.chainName = state.modifiers.label ? `${missionConfig.title} [${state.modifiers.label}]` : missionConfig.title;
        state.mission.chainStep = chainStage + 1;
        state.mission.chainLength = 3;
        state.mission.description = missionConfig.description;
        state.mission.collisionCount = 0;
        state.mission.repairCount = 0;
        state.mission.shortcutEntries = 0;
        state.mission.turnInReady = false;
        state.mission.cashoutMultiplier = 1;
        state.mission.riskLevel = 0;
        state.mission.maxRiskLevel = missionConfig.maxRiskLevel ?? 2;
        state.mission.isBoss = Boolean(missionConfig.isBoss);
        state.mission.bossType = missionConfig.bossType ?? null;
        state.mission.bonus = {
            ...missionConfig.bonus,
            progress: missionConfig.bonus.id === "quickFinish" ? missionConfig.timer : 0,
            completed: false,
        };

        if (missionConfig.route?.length) state.mission.to = missionConfig.route[0];
        if (missionConfig.pickupSeed) seedMissionDistrictPickups(missionDistrict, missionConfig.pickupSeed);
        if (missionConfig.minimumHeat) updateWanted(Math.max(state.wanted.level, missionConfig.minimumHeat));
        if (missionConfig.bossType) spawnMissionBoss(missionConfig, missionDistrict);
        updateMissionBonusProgress();
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
        const forward = keys.w || keys.arrowup || stick.y < -0.3 ? 1 : 0;
        const reverse = keys.s || keys.arrowdown || stick.y > 0.3 ? 1 : 0;
        const left = keys.a || keys.arrowleft ? 1 : 0;
        const right = keys.d || keys.arrowright ? 1 : 0;
        const handbrake = Boolean(keys[" "]);
        // The analog stick steers proportionally; keys stay all-or-nothing.
        const turnInput = Math.abs(stick.x) > 0.12 ? clamp(-stick.x, -1, 1) : left - right;
        state.lastTurnInput = turnInput;
        const ctl = { forward: forward === 1, reverse: reverse === 1, handbrake, turn: turnInput };

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

    function failMission() {
        const mission = state.mission;
        mission.failed = true;
        mission.failTimer = 8;
        mission.failCost = Math.round(60 + mission.stage * 12);
        clearMissionBoss();
        audio?.denied?.();
        spawnPopup("MISSION GESCHEITERT", "bounty");
        setStatus(`Zeit abgelaufen. [X] Erneut für $${mission.failCost}, sonst geht es in ${mission.failTimer}s weiter.`, 8);
    }

    function retryMission() {
        const mission = state.mission;
        if (!spendCash(mission.failCost)) {
            setStatus(`Zu wenig Cash für einen neuen Versuch ($${mission.failCost}).`, 1.8);
            audio?.denied?.();
            return;
        }
        setMission(mission.stage, { keepModifier: state.modifiers.id ?? null });
        setStatus("Neuer Versuch. Gleiche Mission, gleiche Regeln.", 2);
    }

    function updateMission(dt) {
        if (state.mission.failed) {
            state.mission.failTimer -= dt;
            if (state.mission.failTimer <= 0 && state.running) {
                setStatus("Mission übersprungen. Nächster Auftrag.", 2);
                setMission(state.mission.stage + 1);
            }
            return;
        }
        state.mission.timer -= dt;
        updateMissionBonusProgress();
        updateMissionBoss(dt);
        if (state.modifiers.forcedPursuit && state.wanted.level < 2) updateWanted(2);
        if (state.mission.timer <= 0) {
            failMission();
            return;
        }

        if (state.mission.type === "delivery") {
            if (!state.mission.cargo && distanceTo(state.mission.from.x, state.mission.from.z) < CONFIG.map.poiRadius) {
                state.mission.cargo = true;
                setStatus("Paket geladen. Ziel aktualisiert.", 2.2);
            }
            if (state.mission.cargo && distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                state.mission.turnInReady = true;
            }
        }

        if (state.mission.type === "checkpoint") {
            const target = state.mission.route[state.mission.routeIndex];
            if (target && distanceTo(target.x, target.z) < CONFIG.map.poiRadius) {
                state.mission.progress += 1;
                state.mission.routeIndex += 1;
                state.mission.to = state.mission.route[state.mission.routeIndex] ?? target;
                addScore(120 + state.mission.stage * 10);
                setStatus(target ? `${target.name} passiert. Nächster Marker aktualisiert.` : "Checkpoint passiert.", 1.6);
                if (state.mission.progress >= state.mission.target) completeMission();
            }
        }

        if (state.mission.type === "heist") {
            if (!state.mission.cargo && distanceTo(state.mission.from.x, state.mission.from.z) < CONFIG.map.poiRadius) {
                state.mission.cargo = true;
                updateWanted(Math.max(state.wanted.level, 4));
                setStatus("Beute geladen. Bring sie ins Safehouse.", 2.2);
            }
            if (state.mission.cargo && distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                state.mission.turnInReady = true;
            }
        }

        if (state.mission.type === "escape") {
            if (state.wanted.level < 1) updateWanted(1);
            if (distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                state.mission.turnInReady = true;
            }
        }
    }

    function completeMission() {
        if (state.mission.failed) return;
        updateMissionBonusProgress();
        const bonus = state.mission.bonus;
        const bonusAchieved = Boolean(bonus?.completed);
        const baseReward = 850 + state.mission.stage * 230 + (state.mission.type === "heist" ? 600 : 0) + (state.mission.isBoss ? 520 : 0);
        const hotMultiplier = state.mission.cashoutMultiplier ?? 1;
        const reward = Math.round(baseReward * hotMultiplier * (state.modifiers.reward ?? 1));
        addScore(reward, true);
        const cashGain = addCash(Math.floor(reward * 0.34));
        let bonusCash = 0;
        if (bonusAchieved) {
            addScore(bonus.reward, true);
            bonusCash = addCash(Math.round(bonus.reward * 0.72));
        }
        let chainCash = 0;
        if (state.mission.chainStep === state.mission.chainLength) {
            addScore(340 + state.mission.stage * 45, true);
            chainCash = addCash(180 + state.mission.stage * 35);
        }
        if (state.mission.type === "escape" || state.mission.type === "bossHeli") {
            updateWanted(Math.max(0, state.wanted.level - 2));
        }
        state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 30);
        addReputation(state.mission.districtId, state.mission.isBoss ? REPUTATION_GAINS.boss : REPUTATION_GAINS.mission);
        state.stats.missions += 1;
        state.lifetime.missions += 1;
        if (state.wanted.level <= 2) state.stats.missionsLowHeat += 1;
        refreshProgress();
        audio?.mission();
        const missionName = state.mission.chainName;
        const statusParts = [`${missionName} abgeschlossen.`, `Bank +$${cashGain}`];
        if (hotMultiplier > 1) statusParts.push(`Hot Drop x${hotMultiplier.toFixed(2)}`);
        if ((state.modifiers.reward ?? 1) > 1) statusParts.push(`${state.modifiers.label} x${state.modifiers.reward.toFixed(2)}`);
        if (bonusCash > 0) statusParts.push(`Bonus +$${bonusCash}`);
        if (chainCash > 0) statusParts.push(`Chain +$${chainCash}`);
        setStatus(statusParts.join(" "), 3);
        setMission(state.mission.stage + 1);
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
        audio?.collect();
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
            if (state.mission.progress >= state.mission.target) completeMission();
        }
    }

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

    function updateTraffic(dt) {
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
            const axisVx = car.axis === "x" ? car.speed * car.direction : 0;
            const axisVz = car.axis === "z" ? car.speed * car.direction : 0;
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
                let angleDiff = targetAngle - car.mesh.rotation.y;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
                car.mesh.rotation.y += angleDiff * Math.min(1, dt * 6.5);
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
                        audio?.crash();
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

    function updatePolice(dt) {
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
            const targetAngle = Math.atan2(targetX - agent.x, targetZ - agent.z);
            let diff = targetAngle - agent.rotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const turnRate = unit.turnRate;
            agent.rotation += Math.sign(diff) * Math.min(Math.abs(diff), (turnRate + state.wanted.level * 0.2) * dt);
            agent.targetSpeed = getPoliceTargetSpeed(agent);
            agent.speed += (agent.targetSpeed - agent.speed) * dt * 2.4;

            const preX = agent.x + Math.sin(agent.rotation) * agent.speed * dt;
            const preZ = agent.z + Math.cos(agent.rotation) * agent.speed * dt;
            const next = { x: preX, z: preZ };
            const wallHit = pushOutBuildings(world, next, 1.25);
            const obstacleHit = obstacleAt(world, next.x, next.z, 1.15);
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
                            let rdiff = newAngle - agent.rotation;
                            while (rdiff > Math.PI) rdiff -= Math.PI * 2;
                            while (rdiff < -Math.PI) rdiff += Math.PI * 2;
                            agent.rotation += rdiff * 0.6;
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
                const tMin = (car.radius ?? 2.1) + 1.3;
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

            if (distanceSq(state.player.x, state.player.z, agent.x, agent.z) < CONFIG.police.collisionRadius * CONFIG.police.collisionRadius && agent.cooldown <= 0) {
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
                    audio?.crash();
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
            const decayDelayScaled = CONFIG.police.decayDelay * (1 + state.wanted.level * 0.3);
            state.wanted.decay += dt * (isInEscapeCover(state.player.x, state.player.z) ? 1.45 : 1);
            // Mini-pursuit wave during decay at heat >= 3
            state.miniPursuitTimer = (state.miniPursuitTimer ?? 0) + dt;
            if (state.wanted.level >= 3 && state.miniPursuitTimer > 5 && Math.random() < 0.1) {
                state.miniPursuitTimer = 0;
                if (police.length < CONFIG.police.maxCount) {
                    spawnPolice(true, "motorcycle");
                }
            }
            if (state.wanted.decay > decayDelayScaled) {
                state.wanted.decay = 0;
                updateWanted(state.wanted.level - 1);
            }
        } else {
            state.wanted.decay = 0;
            state.miniPursuitTimer = 0;
        }

        state.wanted.status = state.wanted.level <= 0 ? "CLEAR" : near ? "CHASE" : "SEARCH";

        let nearestDist = Infinity;
        for (const agent of police) {
            const d = distanceTo(agent.x, agent.z);
            if (d < nearestDist) nearestDist = d;
        }
        state.nearestPoliceDistance = nearestDist;
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
                audio?.crash();
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
        const missionTurnInTarget = currentMissionTurnInTarget();
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

    function updateMissionInteraction(input) {
        if (state.mission.failed) {
            if (input.consume("x")) retryMission();
            return;
        }
        if (!canCashOutMission()) return;
        const target = currentMissionTurnInTarget();
        if (!target) return;

        const dist = distanceTo(target.x, target.z);
        const inZone = dist < CONFIG.map.poiRadius;
        if (inZone) {
            const nextHot = state.mission.riskLevel < state.mission.maxRiskLevel
                ? ` | Weiterziehen für x${(state.mission.cashoutMultiplier + 0.35).toFixed(2)}`
                : "";
            state.actionPrompt = `E Auftrag abgeben${nextHot}`;
            if (input.consume("e")) {
                completeMission();
                return;
            }
        }

        if (state.mission.turnInReady && !inZone && dist > CONFIG.map.poiRadius * 2.1 && state.mission.riskLevel < state.mission.maxRiskLevel) {
            pushMissionCashout();
        }
    }

    // ---- Graffiti tags: 10 per district, picked up by driving close. -------------------------------
    const tagDefs = generateTags({
        buildings: world.buildings,
        districtIds: DISTRICTS.map((district) => district.id),
        districtIdOf: (x, z) => getDistrictAt(x, z).id,
        perDistrict: TAGS_PER_DISTRICT,
    });
    const tagGeometry = new THREE.PlaneGeometry(2.4, 1.5).rotateX(-Math.PI / 2);
    const tagMaterials = Object.fromEntries(DISTRICTS.map((district) => [
        district.id,
        new THREE.MeshBasicMaterial({ color: new THREE.Color(district.color).multiplyScalar(2.2), side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
    ]));
    const tags = tagDefs.map((def, index) => {
        const mesh = new THREE.Mesh(tagGeometry, tagMaterials[def.districtId]);
        mesh.position.set(def.x, def.y, def.z);
        mesh.rotation.y = (index * 1.7) % Math.PI;
        scene.add(mesh);
        return { ...def, mesh, collected: state.tags.includes(def.id) };
    });
    for (const tag of tags) tag.mesh.visible = !tag.collected;
    world.tags = tags;

    function updateTags(dt) {
        const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 280);
        for (const material of Object.values(tagMaterials)) material.opacity = 0.55 + 0.4 * pulse;
        for (const tag of tags) {
            if (tag.collected) continue;
            tag.mesh.position.y = tag.y + (tag.roof ? Math.sin(performance.now() / 500 + tag.x) * 0.12 : 0);
            if (distanceSq(state.player.x, state.player.z, tag.x, tag.z) > 4.2 * 4.2) continue;
            tag.collected = true;
            tag.mesh.visible = false;
            state.tags.push(tag.id);
            state.stats.tagsRun += 1;
            const district = DISTRICTS.find((entry) => entry.id === tag.districtId);
            const owned = tags.filter((entry) => entry.districtId === tag.districtId && entry.collected).length;
            addScore(150, false, "other");
            const cash = addCash(40);
            addReputation(tag.districtId, REPUTATION_GAINS.tag);
            spawnParticle(tag.x, tag.z, district?.color ?? "#ffffff", 14);
            setStatus(`Graffiti-Tag ${owned}/${TAGS_PER_DISTRICT} in ${district?.name}. +$${cash}`, 1.8);
            if (owned === TAGS_PER_DISTRICT) {
                addCash(500);
                addReputation(tag.districtId, REPUTATION_GAINS.tagSet);
                spawnPopup(`${district?.name.toUpperCase()} KOMPLETT`, "bounty");
                setStatus(`Alle Tags in ${district?.name} gesprüht! Bonus +$500.`, 3.5);
            }
            refreshProgress();
        }
    }

    // ---- Street race: start ring -> 4 checkpoints against 2 AI rivals. -------------------------------
    const raceMarker = new THREE.Mesh(
        new THREE.TorusGeometry(RACE.radius * 0.8, 0.28, 10, 36).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 1.2), transparent: true, opacity: 0.85 })
    );
    raceMarker.visible = false;
    scene.add(raceMarker);

    function startRace(event) {
        const district = getDistrictAt(event.x, event.z);
        const checkpoints = getDistrictWaypointRoute(district.id, RACE.checkpoints, state.mission.stage + 2);
        const hub = nearestNode(roadGraph, event.x, event.z);
        const racers = [];
        for (let index = 0; index < RACE.rivals; index += 1) {
            const model = { ...CAR_MODELS[index % 2 === 0 ? 2 : 0], name: "Rivale", color: index === 0 ? "#79ffb3" : "#ff7ad9", trim: "#14181e" };
            const mesh = createCar(model, sharedMaterials, { bodyColor: model.color, trimColor: model.trim });
            const x = hub.x + (index === 0 ? -2.4 : 2.4);
            const z = hub.z + 3;
            mesh.position.set(x, 0.37, z);
            scene.add(mesh);
            racers.push({
                mesh, x, z, rotation: 0, speed: 0, index: 0, finished: false,
                cruise: RACE.rivalSpeed + index * 0.7 + Math.min(4, state.mission.stage * 0.25),
                wpTimer: 0, wpX: x, wpZ: z,
            });
        }
        state.race = { active: true, checkpoints, racers, player: { index: 0 }, order: [], timer: RACE.timeLimit, districtId: district.id };
        updateWanted(state.wanted.level + 1);
        raceMarker.visible = true;
        spawnPopup("RENNEN!", "bounty");
        setStatus(`Illegales Rennen in ${district.name}: ${RACE.checkpoints} Checkpoints, ${RACE.rivals} Rivalen. Sei Erster!`, 3.5);
        audio?.mission?.();
    }

    function racePlaceNow() {
        const race = state.race;
        const cp = race.checkpoints[race.player.index];
        const mine = race.player.index;
        const myDist = cp ? distanceTo(cp.x, cp.z) : 0;
        let place = 1;
        for (const racer of race.racers) {
            if (racer.finished) {
                place += 1;
                continue;
            }
            const target = race.checkpoints[racer.index];
            const theirDist = target ? Math.hypot(target.x - racer.x, target.z - racer.z) : 0;
            if (racer.index > mine || (racer.index === mine && theirDist < myDist)) place += 1;
        }
        return place;
    }

    function updateRace(dt) {
        const race = state.race;
        if (!race?.active) return;
        race.timer -= dt;
        const total = race.checkpoints.length;

        const next = race.checkpoints[race.player.index];
        if (next) {
            raceMarker.position.set(next.x, 0.5, next.z);
            raceMarker.rotation.y += dt * 1.5;
            if (distanceTo(next.x, next.z) < RACE.radius) {
                race.player.index += 1;
                audio?.nearMiss?.();
                if (race.player.index >= total) {
                    endRace(false, race.racers.filter((racer) => racer.finished).length + 1);
                    return;
                }
                setStatus(`Checkpoint ${race.player.index}/${total} | Platz ${racePlaceNow()}/${race.racers.length + 1}`, 1.4);
            }
        }

        for (const racer of race.racers) {
            if (racer.finished) continue;
            const cp = race.checkpoints[racer.index];
            racer.wpTimer -= dt;
            if (racer.wpTimer <= 0) {
                const wp = nextWaypoint(roadGraph, racer.x, racer.z, cp.x, cp.z);
                racer.wpX = wp.x;
                racer.wpZ = wp.z;
                racer.wpTimer = 0.3;
            }
            const targetAngle = Math.atan2(racer.wpX - racer.x, racer.wpZ - racer.z);
            let diff = targetAngle - racer.rotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            racer.rotation += Math.sign(diff) * Math.min(Math.abs(diff), 2.8 * dt);
            // Rubber band: rivals ease off when far ahead and push when the player is close behind.
            const lead = racer.index - race.player.index;
            const speedTarget = racer.cruise * (Math.abs(diff) > 0.9 ? 0.55 : 1) * (lead > 0 ? 0.92 : lead < 0 ? 1.08 : 1);
            racer.speed += (speedTarget - racer.speed) * dt * 2.2;
            const moved = { x: racer.x + Math.sin(racer.rotation) * racer.speed * dt, z: racer.z + Math.cos(racer.rotation) * racer.speed * dt };
            if (pushOutBuildings(world, moved, 1.25)) {
                racer.speed *= 0.6;
                racer.rotation += 0.9 * Math.sign(diff || 1);
            }
            racer.x = clamp(moved.x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            racer.z = clamp(moved.z, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            racer.mesh.position.set(racer.x, 0.37, racer.z);
            racer.mesh.rotation.y = racer.rotation;
            updateCarVisuals(racer.mesh, dt, { speed: racer.speed });
            if (Math.hypot(cp.x - racer.x, cp.z - racer.z) < RACE.radius + 2) {
                racer.index += 1;
                if (racer.index >= total) {
                    racer.finished = true;
                    race.order.push(racer);
                    setStatus("Ein Rivale ist im Ziel!", 1.4);
                }
            }
        }

        if (race.timer <= 0) endRace(false, 0);
    }

    /** place: 1..n finished, 0 = out of time. `silent` just tears the race down (reset). */
    function endRace(silent, place = 0) {
        const race = state.race;
        if (!race) return;
        for (const racer of race.racers) removeMesh(racer.mesh);
        raceMarker.visible = false;
        state.race = null;
        if (silent) return;
        const payout = RACE.payouts[place - 1];
        if (!payout) {
            setStatus(place === 0 ? "Rennen verloren: Zeit abgelaufen." : "Rennen beendet ohne Platzierung.", 2.6);
            return;
        }
        addScore(payout.score, true, "events");
        const cash = addCash(payout.cash);
        addReputation(race.districtId, payout.rep);
        state.stats.events += 1;
        state.lifetime.events += 1;
        refreshProgress();
        spawnPopup(`PLATZ ${place}!`, "bounty");
        setStatus(`Rennen: Platz ${place} von ${race.racers.length + 1}. Preisgeld +$${cash}.`, 3.2);
        audio?.mission?.();
    }

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
        applyWeatherVisuals();
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
            applyWeatherVisuals();
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
                if (!state.race?.active) startRace(event);
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

    function updateCamera(dt) {
        const player = state.player;

        // Slow orbit for menu / garage screens
        if (state.screen === "menu" || state.screen === "garage") {
            const t = performance.now() * 0.00025;
            const orbitR = 58;
            const targetX = Math.cos(t) * orbitR;
            const targetZ = Math.sin(t) * orbitR;
            tempTarget.set(targetX, 42, targetZ);
            camera.position.lerp(tempTarget, 1 - Math.exp(-1.2 * dt));
            cameraBase.copy(camera.position);
            cameraBaseReady = true;
            camera.lookAt(0, 0, 0);
            const targetFov = CONFIG.camera.fovBase;
            camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-2 * dt));
            camera.updateProjectionMatrix();
            return;
        }

        const forwardX = Math.sin(player.rotation);
        const forwardZ = Math.cos(player.rotation);
        const latX = Math.cos(player.rotation);
        const latZ = -Math.sin(player.rotation);
        const speedMag = player.speedMag ?? Math.abs(player.speed);
        const maxSpeed = (CAR_MODELS[state.playerModelIndex]?.maxSpeed ?? 22) * 1.3;
        const speedRatio = Math.min(1, speedMag / maxSpeed);

        // Lateral velocity lean — camera shifts slightly in slide direction
        const vx = player.vx ?? 0;
        const vz = player.vz ?? 0;
        const latSpeed = vx * latX + vz * latZ;
        const leanX = latX * latSpeed * 0.06;
        const leanZ = latZ * latSpeed * 0.06;

        // Heat and cops close by raise the camera so more of the chase stays visible.
        const cameraMode = CONFIG.camera.modes[state.settings?.cameraMode ?? state.cameraMode] ?? CONFIG.camera.modes.normal;
        let copsNear = 0;
        for (const agent of police) {
            if (distanceSq(player.x, player.z, agent.x, agent.z) < 30 * 30) copsNear += 1;
        }
        const zoomTarget = Math.min(CONFIG.camera.zoomMax, state.wanted.level * CONFIG.camera.zoomPerHeat + copsNear * CONFIG.camera.zoomPerCop);
        cameraZoom += (zoomTarget - cameraZoom) * (1 - Math.exp(-1.5 * dt));

        const speedLift = Math.min(3.5, speedMag * speedMag * 0.0055);
        tempTarget.set(
            player.x - forwardX * (cameraMode.backOffset + cameraZoom * 0.4) + leanX,
            cameraMode.height + cameraZoom + speedLift,
            player.z - forwardZ * (cameraMode.backOffset + cameraZoom * 0.4) + leanZ
        );

        // Phase 4: adaptive position-lerp (FPS-invariant)
        const turnInputMag = Math.abs((state.lastTurnInput ?? 0));
        const driftFactor = Math.min(1, (player.drift ?? 0));
        const kPos = CONFIG.camera.followLerp + speedRatio * 3.5 + driftFactor * 1.2 + turnInputMag * 0.8;
        // The smoothed base position never receives the shake offset, so shake cannot feed back into the lerp.
        if (!cameraBaseReady) {
            cameraBase.copy(camera.position);
            cameraBaseReady = true;
        }
        cameraBase.lerp(tempTarget, 1 - Math.exp(-kPos * dt));
        camera.position.copy(cameraBase);
        post.setSpeed(speedRatio);

        // Phase 4: Shake-Profile (impact + engine + drift composite)
        const engineShake = speedRatio > 0.9 ? (speedRatio - 0.9) * 0.6 : 0;
        const driftShake = driftFactor > 0.7 ? (driftFactor - 0.7) * 0.55 : 0;
        const shakeScale = state.settings ? (state.settings.reducedMotion ? 0 : state.settings.shake) : 1;
        const composite = ((state.cameraShake ?? 0) + engineShake + driftShake) * shakeScale;
        if (state.cameraShake > 0) {
            state.cameraShake = Math.max(0, state.cameraShake - dt * 3.2);
        }
        if (composite > 0.01) {
            const shakeTime = performance.now() * 0.018;
            camera.position.x += Math.sin(shakeTime * 7.3) * composite * 0.55;
            camera.position.z += Math.sin(shakeTime * 5.9 + 1.2) * composite * 0.55;
        }

        // Dynamic FOV — widens with speed (+ provoke kick)
        const provokeFovKick = (state.provoke?.fxTimer ?? 0) > 0 ? 6 : 0;
        const targetFov = CONFIG.camera.fovBase + speedRatio * (CONFIG.camera.fovMax - CONFIG.camera.fovBase) + provokeFovKick;
        camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-2.8 * dt));
        camera.updateProjectionMatrix();

        // Phase 4: lateral + steering look-ahead, drift-lead
        const lookAheadFwd = speedMag * 0.24;
        const lookAheadLat = latSpeed * 0.35 + (state.lastTurnInput ?? 0) * speedMag * 0.18;
        camera.lookAt(
            player.x + forwardX * lookAheadFwd + latX * lookAheadLat,
            0,
            player.z + forwardZ * lookAheadFwd + latZ * lookAheadLat
        );
        if (composite > 0.01) {
            camera.rotateZ(Math.sin(performance.now() * 0.13) * composite * 0.018);
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
            mesh.rotation.y = axis === "x" ? direction * Math.PI / 2 : direction > 0 ? 0 : Math.PI;
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

    function spawnTraffic() {
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
        mesh.rotation.y = axis === "x" ? direction * Math.PI / 2 : direction > 0 ? 0 : Math.PI;
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

    function spawnPolice(near = true, forcedUnitType = null) {
        if (police.length >= CONFIG.police.maxCount) return;
        const unitType = forcedUnitType ?? pickPoliceUnitType();
        const model = createPoliceUnitModel(unitType);
        const mesh = createCar(model, sharedMaterials, { police: true });
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
            cooldown: 0,
            closeCooldown: 0,
            deployCooldown: unitType === "van" ? 3 : 0,
        });
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
        }
    }

    function addScore(amount, missionReward = false, category = missionReward ? "missions" : "other") {
        if (amount <= 0) return 0;
        if (missionReward) state.combo.chain += 3;
        else state.combo.chain += 1;
        state.combo.timer = missionReward ? 6 : 4.2;
        state.combo.maxTimer = state.combo.timer;
        state.combo.best = Math.max(state.combo.best, state.combo.chain);
        // Phase 6.1: provoke score boost
        const provokeBonus = (state.provoke?.active ?? 0) > 0 ? 0.5 : 0;
        state.combo.multiplier = clamp(
            HEAT_TIERS[state.wanted.level].score + Math.floor(Math.max(0, state.combo.chain - 1) / 4) * 0.25 + provokeBonus,
            1,
            4.3
        );
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
        if (state.combo.timer <= 0) {
            state.combo.chain = 0;
            state.combo.multiplier = 1;
            state.combo.driftBank = 0;
            return;
        }
        state.combo.timer = Math.max(0, state.combo.timer - dt);
        if (state.combo.timer === 0) {
            state.combo.chain = 0;
            state.combo.multiplier = 1;
        }
    }

    function getMaxHealth() {
        return CONFIG.player.maxHealth + state.upgrades.armor * 18;
    }

    function getNitroMax() {
        return CONFIG.player.nitroMax + state.upgrades.nitro * 18;
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
                audio?.upgrade();
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
            version: 2,
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

    function missionHelpers(districtId) {
        const district = DISTRICTS.find((entry) => entry.id === districtId) ?? DISTRICTS[0];
        return {
            getPoi,
            anchor: () => createDistrictAnchor(district),
            route: (count) => getDistrictWaypointRoute(districtId, count, state.mission.stage),
        };
    }

    function buildMissionConfig(stage, districtId, chainStage) {
        const chain = MISSION_CHAINS[districtId] ?? MISSION_CHAINS.downtown;
        return resolveMission(chain[chainStage] ?? chain[0], stage, missionHelpers(districtId));
    }

    function shouldSpawnBossMission(stage) {
        return stage > 0 && stage % 6 === 0;
    }

    function buildBossMissionConfig(stage, districtId) {
        const entry = BOSS_MISSIONS[Math.floor(stage / 6) % BOSS_MISSIONS.length];
        return resolveMission(entry, stage, missionHelpers(entry.districtId ?? districtId));
    }

    /** Every third regular mission rolls a modifier (kept on a retry) that pays a reward bonus. */
    function applyMissionModifier(config, stage, boss, keepId) {
        const modifiers = state.modifiers;
        modifiers.nightOnly = false;
        modifiers.noBrake = false;
        modifiers.forcedPursuit = false;
        modifiers.timeAttack = false;
        modifiers.label = "";
        modifiers.reward = 1;
        if (boss) return config;
        const rolled = keepId !== undefined ? keepId : stage % 3 === 0 ? MISSION_MODIFIERS[Math.floor(Math.random() * MISSION_MODIFIERS.length)].id : null;
        const modifier = MISSION_MODIFIERS.find((entry) => entry.id === rolled);
        modifiers.id = modifier?.id ?? null;
        if (!modifier) return config;
        modifiers[modifier.id] = true;
        modifiers.label = modifier.label;
        modifiers.reward = modifier.reward;
        if (modifier.id === "timeAttack") config.timer = Math.round(config.timer * 0.7);
        if (modifier.id === "forcedPursuit") config.minimumHeat = Math.max(config.minimumHeat ?? 0, 3);
        if (modifier.id === "nightOnly") {
            state.time.phase = "night";
            state.time.label = "Nacht";
            state.time.timer = 60;
        }
        return config;
    }

    function createDistrictAnchor(district) {
        return {
            name: `${district.name} Zone`,
            x: district.x * CONFIG.map.size * 0.3,
            z: district.z * CONFIG.map.size * 0.3,
        };
    }

    function getDistrictWaypointRoute(districtId, count, stage) {
        const points = DISTRICT_MISSION_POINTS[districtId] ?? DISTRICT_MISSION_POINTS.downtown;
        const route = [];
        for (let index = 0; index < count; index += 1) {
            const point = points[(stage + index) % points.length];
            route.push({ ...point });
        }
        return route;
    }

    function seedMissionDistrictPickups(district, count) {
        const preferred = Object.entries(district.pickupWeights ?? {})
            .sort((left, right) => right[1] - left[1])
            .map(([key]) => key)
            .filter((type) => type !== "intel");
        for (let index = 0; index < count; index += 1) {
            if (pickups.length >= CONFIG.pickups.maxCount + 4) break;
            const type = preferred[index % preferred.length] ?? "cash";
            const { x, z } = sampleDistrictSpawnPosition(district, district.id === "park", district.id !== "downtown");
            createPickupAt(type, x, z, district);
        }
    }

    function updateMissionBonusProgress() {
        const bonus = state.mission.bonus;
        if (!bonus) return;
        if (bonus.id === "quickFinish") {
            bonus.progress = Math.max(0, Math.ceil(state.mission.timer));
            bonus.completed = bonus.progress >= bonus.target;
            return;
        }
        if (bonus.id === "highHeat") {
            bonus.progress = Math.min(bonus.target, state.wanted.level);
            bonus.completed = state.wanted.level >= bonus.target;
            return;
        }
        if (bonus.id === "shortcut") {
            bonus.progress = Math.min(bonus.target, state.mission.shortcutEntries);
            bonus.completed = state.mission.shortcutEntries >= bonus.target;
            return;
        }
        if (bonus.id === "noRepair") {
            bonus.progress = state.mission.repairCount === 0 ? 1 : 0;
            bonus.completed = state.mission.repairCount === 0;
            return;
        }
        bonus.progress = state.mission.collisionCount === 0 ? 1 : 0;
        bonus.completed = state.mission.collisionCount === 0;
    }

    function canCashOutMission() {
        return state.mission.turnInReady && currentMissionTurnInTarget();
    }

    function currentMissionTurnInTarget() {
        return state.mission.to ?? null;
    }

    function pushMissionCashout() {
        const nextTier = state.mission.riskLevel + 1;
        state.mission.riskLevel = nextTier;
        state.mission.turnInReady = false;
        state.mission.cashoutMultiplier = 1 + nextTier * 0.35;
        state.mission.timer += 10 + nextTier * 2;
        updateWanted(Math.min(5, state.wanted.level + 1));
        const nextTarget = chooseHotDropTarget(state.mission.districtId, state.mission.to);
        if (nextTarget) state.mission.to = nextTarget;
        setStatus(`Hot Drop verlängert. Multiplikator x${state.mission.cashoutMultiplier.toFixed(2)}. Heat steigt.`, 2.2);
        audio?.upgrade();
    }

    function chooseHotDropTarget(districtId, previousTarget) {
        const districtPoints = DISTRICT_MISSION_POINTS[districtId] ?? [];
        const options = [...districtPoints, ...POIS].filter((target) => {
            if (!previousTarget) return true;
            return distanceSq(target.x, target.z, previousTarget.x, previousTarget.z) > 18 * 18;
        });
        if (!options.length) return previousTarget;
        const target = options[Math.floor(Math.random() * options.length)];
        return { ...target };
    }

    function spawnMissionBoss(config, district) {
        if (config.bossType === "armoredTransporter") {
            const axis = Math.random() < 0.5 ? "x" : "z";
            const streetOptions = getDistrictTrafficStreets(axis, district);
            const street = streetOptions[Math.floor(Math.random() * streetOptions.length)];
            const pos = getDistrictTrafficPosition(axis, district);
            const direction = Math.random() < 0.5 ? -1 : 1;
            const x = axis === "x" ? pos : street;
            const z = axis === "z" ? pos : street;
            const model = { ...CAR_MODELS[3], name: "APC Van", color: "#626b76", trim: "#171b21", width: 2.38, length: 5.3 };
            const mesh = createCar(model, sharedMaterials, { bodyColor: model.color, trimColor: model.trim });
            mesh.position.set(x, 0.38, z);
            mesh.rotation.y = axis === "x" ? direction * Math.PI / 2 : direction > 0 ? 0 : Math.PI;
            const escortLight = addAmbientHeadlights(mesh, model, "#ffc64d");
            scene.add(mesh);
            missionBoss = {
                type: "armoredTransporter",
                mesh,
                x,
                z,
                axis,
                direction,
                speed: 6.8,
                hackProgress: 0,
                hacked: false,
                lights: escortLight,
            };
            state.mission.from = { name: "APC Van", x, z };
            state.mission.to = { ...getPoi("safehouse") };
            setStatus("Boss-Dispatch: Gepanzerter Transporter gesichtet.", 2.4);
            return;
        }

        if (config.bossType === "helicopterHunt") {
            missionBoss = {
                type: "helicopterHunt",
                surviveTime: 18,
                maxSurviveTime: 18,
            };
            state.mission.progress = 0;
            state.mission.target = 18;
            setStatus("Boss-Dispatch: Helikopter setzt zur Volljagd an.", 2.4);
            return;
        }

        const blockers = [];
        const barrierPoints = [
            { x: -47, z: -26, axis: "x" },
            { x: -26, z: -47, axis: "z" },
        ];
        for (const point of barrierPoints) {
            const mesh = createRoadblockMesh(point.axis);
            mesh.position.set(point.x, 0.14, point.z);
            scene.add(mesh);
            const blocker = { mesh, x: point.x, z: point.z, radius: 4.2, life: 62, cooldown: 0, bossOwned: true };
            roadblocks.push(blocker);
            blockers.push(blocker);
        }
        missionBoss = {
            type: "harborBlockade",
            blockers,
            checkpoints: [{ name: "Dock Gap", x: -47, z: -26 }, { name: "Gate Split", x: -26, z: -47 }],
            checkpointIndex: 0,
        };
        state.mission.to = { ...missionBoss.checkpoints[0] };
        state.mission.progress = 0;
        state.mission.target = missionBoss.checkpoints.length;
        setStatus("Boss-Dispatch: Hafenblockade aktiv. Durchbruch markieren.", 2.4);
    }

    function updateMissionBoss(dt) {
        if (!missionBoss) return;

        if (missionBoss.type === "armoredTransporter") {
            const move = missionBoss.speed * missionBoss.direction * dt;
            if (missionBoss.axis === "x") missionBoss.x += move;
            else missionBoss.z += move;
            const district = DISTRICTS.find((entry) => entry.id === "industrial") ?? DISTRICTS[0];
            const minX = district.x < 0 ? -CONFIG.map.size / 2 + 4 : 4;
            const maxX = district.x < 0 ? -4 : CONFIG.map.size / 2 - 4;
            const minZ = district.z < 0 ? -CONFIG.map.size / 2 + 4 : 4;
            const maxZ = district.z < 0 ? -4 : CONFIG.map.size / 2 - 4;
            if (missionBoss.x <= minX || missionBoss.x >= maxX) {
                missionBoss.direction *= -1;
                missionBoss.x = clamp(missionBoss.x, minX, maxX);
            }
            if (missionBoss.z <= minZ || missionBoss.z >= maxZ) {
                missionBoss.direction *= -1;
                missionBoss.z = clamp(missionBoss.z, minZ, maxZ);
            }
            missionBoss.mesh.position.set(missionBoss.x, 0.38, missionBoss.z);
            missionBoss.mesh.rotation.y = missionBoss.axis === "x"
                ? missionBoss.direction > 0 ? Math.PI / 2 : -Math.PI / 2
                : missionBoss.direction > 0 ? 0 : Math.PI;
            state.mission.from = { name: "APC Van", x: missionBoss.x, z: missionBoss.z };

            if (!missionBoss.hacked) {
                const close = distanceTo(missionBoss.x, missionBoss.z) < 8.5;
                missionBoss.hackProgress = close ? Math.min(4.5, missionBoss.hackProgress + dt) : Math.max(0, missionBoss.hackProgress - dt * 0.45);
                state.mission.progress = Math.round((missionBoss.hackProgress / 4.5) * 100);
                state.mission.target = 100;
                if (close) state.actionPrompt = "Bleib dran: Transporter wird aufgebrochen";
                if (missionBoss.hackProgress >= 4.5) {
                    missionBoss.hacked = true;
                    state.mission.cargo = true;
                    state.mission.progress = 1;
                    state.mission.target = 1;
                    state.mission.from = null;
                    state.mission.to = { ...getPoi("safehouse") };
                    setStatus("Transporter geknackt. Bring die Fracht zum Safehouse.", 2.4);
                }
            } else if (distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                state.mission.turnInReady = true;
            }
            return;
        }

        if (missionBoss.type === "helicopterHunt") {
            updateWanted(Math.max(state.wanted.level, 5));
            missionBoss.surviveTime = Math.max(0, missionBoss.surviveTime - dt);
            state.mission.progress = Math.round((missionBoss.maxSurviveTime - missionBoss.surviveTime) * 10);
            state.mission.target = Math.round(missionBoss.maxSurviveTime * 10);
            if (missionBoss.surviveTime <= 0 && distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                state.mission.turnInReady = true;
            }
            if (missionBoss.surviveTime > 0) {
                state.mission.description = `Ueberlebe im Suchlicht. Noch ${Math.ceil(missionBoss.surviveTime)}s, dann zum Safehouse.`;
            }
            return;
        }

        if (missionBoss.type === "harborBlockade") {
            const nextCheckpoint = missionBoss.checkpoints[missionBoss.checkpointIndex];
            if (nextCheckpoint) {
                state.mission.to = { ...nextCheckpoint };
                if (distanceTo(nextCheckpoint.x, nextCheckpoint.z) < CONFIG.map.poiRadius) {
                    missionBoss.checkpointIndex += 1;
                    state.mission.progress += 1;
                    spawnParticle(nextCheckpoint.x, nextCheckpoint.z, "#ff9c45", 18);
                    setStatus(`${nextCheckpoint.name} durchbrochen.`, 1.8);
                    if (missionBoss.checkpointIndex >= missionBoss.checkpoints.length) {
                        state.mission.to = { ...getPoi("safehouse") };
                        state.mission.description = "Blockade offen. Bring den Run jetzt ins Safehouse.";
                    }
                }
            } else if (distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                state.mission.turnInReady = true;
            }
        }
    }

    function clearMissionBoss() {
        if (!missionBoss) return;
        if (missionBoss.mesh) removeMesh(missionBoss.mesh);
        if (missionBoss.blockers) {
            for (const blocker of missionBoss.blockers) {
                removeMesh(blocker.mesh);
                const roadblockIndex = roadblocks.indexOf(blocker);
                if (roadblockIndex >= 0) roadblocks.splice(roadblockIndex, 1);
            }
        }
        missionBoss = null;
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

    const visualColor = new THREE.Color();
    const NIGHT_TINT = new THREE.Color("#071018");
    const SUN_DAY = new THREE.Color("#fff7df");
    const SUN_DUSK = new THREE.Color("#ff8a4a");
    const GLOW_DAY = new THREE.Color("#63c8ff");
    const GLOW_NIGHT = new THREE.Color("#69d0ff");
    const lerp = (a, b, t) => a + (b - a) * t;
    let lightningTimer = 0;
    let secondFlash = 0;

    function applyWeatherVisuals() {
        const mode = state.weather.mode;
        const weather = WEATHER_MODES[mode] ?? WEATHER_MODES.clear;
        const day = state.time.daylight ?? 1;
        const smoothDay = day * day * (3 - 2 * day);
        const n = 1 - smoothDay;
        visualColor.set(weather.color).lerp(NIGHT_TINT, 0.38 * n);
        scene.background = visualColor;
        if (scene.fog) {
            scene.fog.color.copy(visualColor);
            const fogNear = mode === "fog" ? 20 : mode === "storm" ? 28 : 48;
            const fogFar = mode === "fog" ? 72 : mode === "storm" ? 102 : 130;
            scene.fog.near = fogNear * (1 - 0.08 * n);
            scene.fog.far = fogFar * (1 - 0.1 * n);
        }
        if (lights) {
            lights.ambient.intensity = lerp(mode === "storm" ? 0.92 : 1.25, 0.7, n);
            lights.sun.intensity = lerp(mode === "storm" ? 2.6 : 4.8, mode === "storm" ? 0.85 : 0.55, n);
            lights.sun.color.copy(SUN_DAY).lerp(SUN_DUSK, 4 * smoothDay * n * 0.9);
            lights.nightGlow.intensity = lerp(mode === "fog" ? 1.05 : 0.9, 1.7, n);
            lights.nightGlow.color.copy(GLOW_DAY).lerp(GLOW_NIGHT, n);
        }
        renderer.toneMappingExposure = lerp(mode === "storm" ? 0.98 : 1.08, 0.92, n);
        post.setAtmosphere(visualColor, n, mode);
        post.setDaylight(smoothDay);
    }

    /** Per-frame: ease day/night and wetness, run storm lightning, animate the world. */
    // Industrial steam: smokestack and tank vents puff while the player is nearby.
    const steamSources = [{ x: -38, z: 38, y: 15 }, ...world.obstacles.filter((o) => o.type === "tank").map((o) => ({ x: o.x, z: o.z, y: 3.9 }))];
    let steamTimer = 0;

    function updateSteam(dt) {
        steamTimer -= dt;
        if (steamTimer > 0) return;
        steamTimer = 0.32 / Math.max(0.3, post.getQualityConfig().particleDensity ?? 1);
        for (const source of steamSources) {
            if (distanceSq(state.player.x, state.player.z, source.x, source.z) > 70 * 70) continue;
            effects.spawnSmoke(source.x, source.z, { y: source.y, color: "#dfe4ea", alpha: 0.22, size: source.y > 8 ? 3.2 : 1.6, grow: 2.4, life: 2.2, rise: source.y > 8 ? 2.2 : 1.1 });
        }
    }

    function updateWorldVisuals(dt) {
        updateSteam(dt);
        const targetDay = state.time.phase === "night" ? 0 : 1;
        const day = state.time.daylight ?? targetDay;
        const step = dt / 9;
        state.time.daylight = day < targetDay ? Math.min(targetDay, day + step) : Math.max(targetDay, day - step);

        const mode = state.weather.mode;
        const wetTarget = mode === "rain" || mode === "storm" ? 1 : mode === "fog" ? 0.35 : 0;
        const wet = state.weather.wetness ?? wetTarget;
        state.weather.wetness = wet < wetTarget ? Math.min(wetTarget, wet + dt * 0.12) : Math.max(wetTarget, wet - dt * 0.05);

        if (mode === "storm") {
            lightningTimer -= dt;
            if (lightningTimer <= 0) {
                post.flashLightning(1);
                secondFlash = 0.16 + Math.random() * 0.12;
                lightningTimer = 3 + Math.random() * 7;
            }
        }
        if (secondFlash > 0) {
            secondFlash -= dt;
            if (secondFlash <= 0) post.flashLightning(0.7);
        }

        applyWeatherVisuals();
        world.updateVisuals(dt, 1 - state.time.daylight, state.weather.wetness);
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

    function distanceSq(ax, az, bx, bz) {
        const dx = ax - bx;
        const dz = az - bz;
        return dx * dx + dz * dz;
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function getPoliceVisibilityFactor() {
        let factor = 1;
        if (state.time.phase === "night") factor += 0.14;
        if (state.weather.mode === "fog") factor -= 0.34;
        if (state.weather.mode === "storm") factor -= 0.16;
        if (isInEscapeCover(state.player.x, state.player.z)) factor -= 0.16;
        if (activeScannerZoneId) factor += 0.12;
        if (state.helicopter.active && distanceSq(state.player.x, state.player.z, state.helicopter.x, state.helicopter.z) < 15 * 15) factor += 0.22;
        return clamp(factor, 0.55, 1.45);
    }

    function pickPoliceUnitType() {
        const heat = state.wanted.level;
        const roll = Math.random();
        if (heat >= 4 && roll < 0.24) return "van";
        if (heat >= 3 && roll < 0.52) return "suv";
        if (heat >= 2 && roll < 0.78) return "motorcycle";
        return "patrol";
    }

    function createPoliceUnitModel(unitType) {
        if (unitType === "suv") {
            return { ...CAR_MODELS[1], color: "#e9eef4", trim: "#182a46", name: "Pursuit SUV", maxSpeed: 16.8, acceleration: 22, turn: 2.95 };
        }
        if (unitType === "motorcycle") {
            return { ...CAR_MODELS[2], color: "#f4f7fb", trim: "#18324f", name: "Interceptor Bike", width: 0.96, length: 2.75, height: 0.42, maxSpeed: 22, acceleration: 28, turn: 4.8, roof: "sport" };
        }
        if (unitType === "van") {
            return { ...CAR_MODELS[3], color: "#d9e1eb", trim: "#1a2b45", name: "Blockade Van", maxSpeed: 14.8, acceleration: 18.5, turn: 2.45 };
        }
        return { ...CAR_MODELS[0], color: "#f4f7fb", trim: "#1c4274", name: "Patrol Cruiser", maxSpeed: 19.2, acceleration: 24, turn: 3.4 };
    }

    function getPoliceTargetSpeed(agent) {
        const unit = POLICE_UNITS[agent.unitType] ?? POLICE_UNITS.patrol;
        if (agent.state === "leave") return unit.idleSpeed * 0.8;
        if (agent.state !== "chase") return unit.idleSpeed;
        const night = state.time.phase === "night" ? unit.nightBonus : 0;
        return unit.chaseSpeed + state.wanted.level * unit.chaseSpeedPerHeat + night;
    }

    function getRoadblockPlacementTarget(options = {}) {
        const missionTarget = getMissionNavigationTarget();
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

    function getMissionNavigationTarget() {
        if (state.mission.type === "checkpoint") return state.mission.route[state.mission.routeIndex] ?? state.mission.to;
        return state.mission.to ?? state.mission.from ?? null;
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

    function scrambleNearbyPolice(x, z, radius = 24) {
        const radiusSq = radius * radius;
        for (const agent of police) {
            if (distanceSq(x, z, agent.x, agent.z) >= radiusSq) continue;
            agent.state = "search";
            agent.lastX = x + (Math.random() - 0.5) * 8;
            agent.lastZ = z + (Math.random() - 0.5) * 8;
            agent.speed *= 0.78;
        }
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
        event.mesh.rotation.y = event.axis === "x"
            ? event.direction > 0 ? Math.PI / 2 : -Math.PI / 2
            : event.direction > 0 ? 0 : Math.PI;
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
                scrambleNearbyPolice(obstacle.x, obstacle.z, 26);
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
        debug: import.meta.env?.DEV ? { startRace, tags } : null,
    };
}
