import * as THREE from "three";
import { ACHIEVEMENTS, CONFIG, CAR_MODELS, CONTRACTS, DISTRICTS, HEAT_TIERS, PICKUP_TYPES, POIS, UPGRADES, WEATHER_MODES, WORLD_EVENTS } from "./config.js";
import { clearProfile, createDefaultProfile, saveProfile } from "./save.js";
import { hideGameOver, renderHud, showGameOver } from "./ui.js";
import { createCar, createMaterial, replaceCarModel } from "./vehicles.js";
import { insideBuilding, obstacleAt, pushOutBuildings, snapStreet } from "./world.js";

const MISSION_DISTRICT_ORDER = ["downtown", "industrial", "park", "harbor"];

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

export function createGameRuntime({ scene, camera, renderer, world, ui, state, sharedMaterials, audio, lights }) {
    const pickups = [];
    const police = [];
    const traffic = [];
    const roadblocks = [];
    const hazards = [];
    const eventPickups = [];
    const particles = [];
    const skidMarks = [];
    const rainDrops = [];
    let missionBoss = null;
    const helicopter = createHelicopterMesh();
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const eventGeo = new THREE.DodecahedronGeometry(0.85, 0);
    const hazardGeo = new THREE.BoxGeometry(4.8, 0.08, 0.7);
    const tempTarget = new THREE.Vector3();
    const debugClock = { frames: 0, timer: 0 };
    let scannerCharge = 0;
    let activeScannerZoneId = null;
    const playerCar = createCar(CAR_MODELS[state.playerModelIndex], sharedMaterials);
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
        state.popup = { text: "", timer: 0, type: "normal" };
        state.nearMiss = { count: 0, timer: 0, streak: 0, streakTimer: 0 };
        state.nearestPoliceDistance = Infinity;
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
        state.contract.id = CONTRACTS[Math.floor(Math.random() * CONTRACTS.length)].id;
        state.contract.progress = 0;
        state.contract.completed = false;
        state.contract.claimed = false;
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
        state.worldEvent.label = "Ruhige Strassen";
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
        setStatus(options.showMenu ? "Waehle einen Run oder pruefe die Garage." : "Direkt im Spiel. Fahre los.", 2.8);
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
        clearEntities(particles);
        clearEntities(skidMarks);
        clearEntities(rainDrops);

        setMission(1);
        for (let index = 0; index < CONFIG.pickups.startCount; index += 1) spawnPickup();
        for (let index = 0; index < CONFIG.traffic.startCount; index += 1) spawnTraffic();
        applyWeatherVisuals();
        persistProfile();
        renderHud(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
    }

    function update(dt, input) {
        if (state.statusTimer > 0) state.statusTimer = Math.max(0, state.statusTimer - dt);
        if (input.consume("f3")) state.debug.enabled = !state.debug.enabled;
        if (input.consume("g")) toggleGarage();
        if (state.running && input.consume("p")) {
            state.paused = !state.paused;
            setStatus(state.paused ? "Pause." : "Zurueck auf der Strasse.", 1.4);
        }

        if (!state.paused) updateCombo(dt);
        if (state.popup?.timer > 0) state.popup.timer = Math.max(0, state.popup.timer - dt);
        if (state.nearMiss?.streakTimer > 0) {
            state.nearMiss.streakTimer -= dt;
            if (state.nearMiss.streakTimer <= 0) state.nearMiss.streak = 0;
        }
        updateDebug(dt);

        if (!state.running || state.paused || state.screen !== "playing") {
            updateParticles(dt);
            updateTimeOfDay(dt, true);
            updateWeather(dt, true);
            updateCamera(dt);
            audio?.update(state, dt);
            renderHud(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
            renderer.render(scene, camera);
            return;
        }

        updatePlayer(dt, input);
        updateMission(dt);
        updateDistrict();
        updateScannerZones(dt);
        updateTimeOfDay(dt);
        updateWeather(dt);
        updateWorldEvents(dt);
        updatePickups(dt);
        updateTraffic(dt);
        updatePolice(dt);
        updateRoadblocks(dt);
        updateHazards(dt);
        updateHelicopter(dt);
        updateParticles(dt);
        updateSkidMarks(dt);
        updatePoiEffects(dt, input);
        updateMissionInteraction(input);
        updateCamera(dt);
        audio?.update(state, dt);
        renderHud(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
        renderer.render(scene, camera);
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

    function setMission(stage) {
        clearMissionBoss();
        const chainStage = (stage - 1) % 3;
        const bossMission = shouldSpawnBossMission(stage);
        const baseDistrictId = MISSION_DISTRICT_ORDER[Math.floor((stage - 1) / 3) % MISSION_DISTRICT_ORDER.length];
        const missionConfig = bossMission
            ? buildBossMissionConfig(stage, baseDistrictId)
            : buildMissionConfig(stage, baseDistrictId, chainStage);
        const missionDistrict = DISTRICTS.find((district) => district.id === (missionConfig.districtId ?? baseDistrictId)) ?? DISTRICTS[0];
        state.mission.stage = stage;
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
        state.mission.chainName = missionConfig.title;
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
        const engineLevel = state.upgrades.engine;
        const gripLevel = state.upgrades.grip;
        const nitroLevel = state.upgrades.nitro;
        const weatherGrip = WEATHER_MODES[state.weather.mode]?.grip ?? 1;
        const mass = model.mass ?? 1.0;
        const maxSpeed = model.maxSpeed * (1 + engineLevel * 0.075) + (inShortcut ? district.shortcutBoost ?? 0 : 0);
        const acceleration = (model.acceleration / Math.sqrt(mass)) * (1 + engineLevel * 0.085) * (0.92 + weatherGrip * 0.08);
        const turnPower = model.turn * (1 + gripLevel * 0.045) * weatherGrip * (inShortcut ? 1.08 : 1);
        const brakePower = (8.5 + gripLevel * 1.9) * (model.brakeFactor ?? 0.68) * weatherGrip;
        const nitroMax = getNitroMax();
        const keys = input.keys;
        const forward = keys.w || keys.arrowup ? 1 : 0;
        const reverse = keys.s || keys.arrowdown ? 1 : 0;
        const left = keys.a || keys.arrowleft ? 1 : 0;
        const right = keys.d || keys.arrowright ? 1 : 0;
        const handbrake = Boolean(keys[" "]);
        const turnInput = left - right;

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
        const boostedMax = maxSpeed + (nitro ? CONFIG.player.nitroBonus + nitroLevel * 2.4 : 0);

        if (nitro) {
            player.nitro = Math.max(0, player.nitro - dt * CONFIG.player.nitroBurn);
            spawnParticle(player.x - fwdX * 2, player.z - fwdZ * 2, "#63c8ff", 2);
        } else {
            const districtNitro = district.nitroRegenBonus ?? 0;
            const shortcutNitro = inShortcut ? 0.95 : 0;
            player.nitro = Math.min(nitroMax, player.nitro + dt * (CONFIG.player.nitroRegen + nitroLevel * 0.9 + districtNitro + shortcutNitro));
        }

        // Longitudinal (forward) dynamics
        if (forward) {
            fwdSpeed += acceleration * dt;
        } else if (reverse) {
            fwdSpeed -= (fwdSpeed > 0 ? 24 + gripLevel * 2.5 : acceleration * 0.65) * dt;
        } else {
            fwdSpeed -= Math.sign(fwdSpeed) * Math.min(Math.abs(fwdSpeed), (handbrake ? 15 + gripLevel * 2 : brakePower) * dt);
        }
        fwdSpeed = clamp(fwdSpeed, -boostedMax * CONFIG.player.reverseFactor, boostedMax);

        // Drift state — builds up smoothly, falls off with release
        const driftSpeedThreshold = (model.driftThreshold ?? 0.38) * maxSpeed;
        const isDrifting = handbrake && Math.abs(fwdSpeed) > driftSpeedThreshold && Math.abs(turnInput) > 0;
        const wasDrifting = player.drift > 0.5;
        player.drift = isDrifting
            ? Math.min(1, player.drift + dt * 4.5)
            : Math.max(0, player.drift - dt * 2.8);

        // Turning — more responsive in drift, reduced at high speed
        if (Math.abs(fwdSpeed) > 0.12) {
            const speedRatio = Math.abs(fwdSpeed) / boostedMax;
            const turnScale = 1 - Math.min(0.55, speedRatio * 0.5);
            const driftBoost = isDrifting ? 1.55 + gripLevel * 0.04 : 1;
            player.rotation += turnInput * turnPower * driftBoost * turnScale * dt * Math.sign(fwdSpeed);
        }

        // Recalculate axes after rotation change
        const newFwdX = Math.sin(player.rotation);
        const newFwdZ = Math.cos(player.rotation);
        const newLatX = Math.cos(player.rotation);
        const newLatZ = -Math.sin(player.rotation);

        // Lateral grip / drift friction
        const baseGrip = (0.76 + gripLevel * 0.038) * weatherGrip;
        const driftGrip = (0.18 + gripLevel * 0.055) * weatherGrip;
        const lateralGrip = isDrifting ? driftGrip : baseGrip;
        const lateralFrictionFactor = Math.pow(Math.max(0.01, lateralGrip), dt * 60);
        latSpeed *= lateralFrictionFactor;

        // Reconstruct world-space velocity
        player.vx = newFwdX * fwdSpeed + newLatX * latSpeed;
        player.vz = newFwdZ * fwdSpeed + newLatZ * latSpeed;
        player.speed = fwdSpeed;
        player.speedMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);

        // Drift scoring and session tracking
        const prevDriftSession = player.driftSessionScore ?? 0;
        if (player.drift > 0.1) {
            const driftGain = Math.abs(fwdSpeed) * dt * (0.8 + gripLevel * 0.08);
            state.combo.driftBank += driftGain;
            state.combo.driftScore += driftGain * 10;
            state.stats.driftScore += driftGain * 10;
            player.driftSessionScore = (player.driftSessionScore ?? 0) + driftGain * 10;
            if (state.combo.driftBank >= 14) {
                state.combo.driftBank = 0;
                addScore(18 + gripLevel * 5);
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

        // Position update using velocity vector
        const next = {
            x: clamp(player.x + player.vx * dt, -CONFIG.map.size / 2, CONFIG.map.size / 2),
            z: clamp(player.z + player.vz * dt, -CONFIG.map.size / 2, CONFIG.map.size / 2),
        };

        const hitBuilding = pushOutBuildings(world, next, CONFIG.player.radius);
        const hitObstacle = obstacleAt(world, next.x, next.z, CONFIG.player.radius);
        let destroyedReaction = null;
        if (hitObstacle) {
            const dx = next.x - hitObstacle.x;
            const dz = next.z - hitObstacle.z;
            const distance = Math.sqrt(dx * dx + dz * dz) || 1;
            next.x += (dx / distance) * 1.2;
            next.z += (dz / distance) * 1.2;
            const impactMag = player.speedMag;
            if (hitObstacle.destructible && impactMag > (hitObstacle.minImpact ?? 6)) {
                destroyedReaction = destroyObstacle(hitObstacle, impactMag);
            }
        }

        if (hitBuilding || hitObstacle) {
            const impactMag = player.speedMag;
            const obstacleDamping = destroyedReaction?.speedDamping ?? hitObstacle?.speedDamping ?? 0.34;
            const massRetention = Math.min(0.88, 0.28 + mass * 0.28);
            const dampFactor = hitBuilding ? Math.min(0.52, 0.22 + mass * 0.18) : Math.min(obstacleDamping + mass * 0.14, 0.72);
            player.vx *= dampFactor;
            player.vz *= dampFactor;
            player.speed = newFwdX * player.vx + newFwdZ * player.vz;
            player.speedMag = Math.sqrt(player.vx * player.vx + player.vz * player.vz);
            if (impactMag > 5) {
                const obstacleDamageScale = destroyedReaction?.hitDamageScale ?? hitObstacle?.hitDamageScale ?? 0.55;
                damagePlayer(impactMag * (hitBuilding ? 0.8 : obstacleDamageScale) / (mass * 0.75 + 0.25), "crash");
                state.cameraShake = Math.min(1, Math.max(impactMag * 0.04, destroyedReaction?.shake ?? hitObstacle?.shake ?? 0));
                spawnParticle(next.x, next.z, hitBuilding ? "#ff6a4f" : (destroyedReaction?.color ?? hitObstacle?.color ?? "#ffc64d"), destroyedReaction?.particleCount ?? 18);
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

    function updateMission(dt) {
        state.mission.timer -= dt;
        updateMissionBonusProgress();
        updateMissionBoss(dt);
        if (state.mission.timer <= 0) {
            damagePlayer(16);
            setStatus("Mission verpasst. Neue Chance, aber Karosserie leidet.", 2.6);
            if (state.running) setMission(state.mission.stage);
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
                setStatus(target ? `${target.name} passiert. Naechster Marker aktualisiert.` : "Checkpoint passiert.", 1.6);
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
        updateMissionBonusProgress();
        const bonus = state.mission.bonus;
        const bonusAchieved = Boolean(bonus?.completed);
        const baseReward = 850 + state.mission.stage * 230 + (state.mission.type === "heist" ? 600 : 0) + (state.mission.isBoss ? 520 : 0);
        const hotMultiplier = state.mission.cashoutMultiplier ?? 1;
        const reward = Math.round(baseReward * hotMultiplier);
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
        state.stats.missions += 1;
        state.lifetime.missions += 1;
        if (state.wanted.level <= 2) state.stats.missionsLowHeat += 1;
        refreshProgress();
        audio?.mission();
        const missionName = state.mission.chainName;
        const statusParts = [`${missionName} abgeschlossen.`, `Bank +$${cashGain}`];
        if (hotMultiplier > 1) statusParts.push(`Hot Drop x${hotMultiplier.toFixed(2)}`);
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
        const gained = addScore(info.score);
        addCash(info.cash || 0);
        if (info.heal) {
            const healAmount = Math.round(info.heal * (district.healMultiplier ?? 1));
            state.player.health = Math.min(getMaxHealth(), state.player.health + healAmount);
        }
        if (info.nitro) state.player.nitro = Math.min(getNitroMax(), state.player.nitro + info.nitro);
        if (info.emp) triggerEmp(pickup.x, pickup.z);
        if (info.wanted) updateWanted(state.wanted.level + info.wanted);
        state.stats.pickups += 1;
        state.lifetime.pickups += 1;
        refreshProgress();
        audio?.collect();
        spawnParticle(pickup.x, pickup.z, info.color, 16);
        setStatus(`${info.label} aufgenommen. +${Math.round(gained)} Score.`, 1.5);
        scene.remove(pickup.mesh);
        pickups.splice(index, 1);

        if (state.mission.type === "pickup") {
            if (pickup.districtId === state.mission.districtId) {
                state.mission.progress += 1;
            } else {
                setStatus(`${info.label} gesichert, aber der Auftrag laeuft in ${state.mission.districtName}.`, 1.2);
            }
            if (state.mission.progress >= state.mission.target) completeMission();
        }
    }

    function updateTraffic(dt) {
        for (const car of traffic) {
            car.cooldown = Math.max(0, car.cooldown - dt);
            const move = car.speed * car.direction * dt;
            if (car.axis === "x") car.x += move;
            else car.z += move;
            if (car.headlights) {
                const headlightIntensity = state.time.phase === "night" ? 0.85 : state.weather.mode === "fog" ? 0.55 : 0.2;
                for (const light of car.headlights) light.material.emissiveIntensity = headlightIntensity;
            }

            if (car.x > CONFIG.map.size / 2 + 6) car.x = -CONFIG.map.size / 2 - 6;
            if (car.x < -CONFIG.map.size / 2 - 6) car.x = CONFIG.map.size / 2 + 6;
            if (car.z > CONFIG.map.size / 2 + 6) car.z = -CONFIG.map.size / 2 - 6;
            if (car.z < -CONFIG.map.size / 2 - 6) car.z = CONFIG.map.size / 2 + 6;

            car.mesh.position.set(car.x, 0.35, car.z);
            const distToPlayer = Math.sqrt(distanceSq(state.player.x, state.player.z, car.x, car.z));
            const playerSpeedMag = state.player.speedMag ?? Math.abs(state.player.speed);
            const model = CAR_MODELS[state.playerModelIndex];
            const mass = model.mass ?? 1.0;

            // Near-miss detection
            if (distToPlayer > CONFIG.traffic.collisionRadius && distToPlayer < CONFIG.traffic.collisionRadius + 2.8 && playerSpeedMag > 8) {
                car.nearMissCooldown = (car.nearMissCooldown ?? 0);
                if (car.nearMissCooldown <= 0) {
                    car.nearMissCooldown = 2.2;
                    triggerNearMiss();
                }
            }
            car.nearMissCooldown = Math.max(0, (car.nearMissCooldown ?? 0) - dt);

            if (distToPlayer < CONFIG.traffic.collisionRadius && car.cooldown <= 0) {
                car.cooldown = 1.1;
                const trafficMass = car.model?.mass ?? 1.0;
                const massRatio = trafficMass / mass;
                const impactDamage = playerSpeedMag * (0.45 * massRatio) + (massRatio > 1.1 ? 2.5 : 5.5) / mass;
                damagePlayer(impactDamage, "crash");
                audio?.crash();
                const velocityRetain = Math.min(0.72, 0.34 + mass * 0.22);
                state.player.vx *= velocityRetain;
                state.player.vz *= velocityRetain;
                state.player.speed = Math.sin(state.player.rotation) * state.player.vx + Math.cos(state.player.rotation) * state.player.vz;
                state.player.speedMag = Math.sqrt(state.player.vx ** 2 + state.player.vz ** 2);
                spawnParticle((state.player.x + car.x) * 0.5, (state.player.z + car.z) * 0.5, "#ffb14c", 18);
                updateWanted(state.wanted.level + 1);
            }
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

    function updatePolice(dt) {
        const heatTier = getHeatTier();
        const visibilityFactor = getPoliceVisibilityFactor();
        const retiredAgents = [];
        state.wanted.emp = Math.max(0, state.wanted.emp - dt);
        const targetPolice = Math.max(0, heatTier.police - (state.wanted.emp > 0 ? 6 : 0));
        while (police.length < targetPolice && police.length < CONFIG.police.maxCount) spawnPolice(true);
        while (police.length > targetPolice && police.length > 0) scene.remove(police.pop().mesh);

        let near = false;
        for (const agent of police) {
            agent.cooldown = Math.max(0, agent.cooldown - dt);
            agent.closeCooldown = Math.max(0, agent.closeCooldown - dt);
            agent.deployCooldown = Math.max(0, (agent.deployCooldown ?? 0) - dt);
            const dx = state.player.x - agent.x;
            const dz = state.player.z - agent.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < 34 * visibilityFactor) near = true;
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
                addScore(45 + state.wanted.level * 12);
            }

            if (dist < CONFIG.police.searchDistance * visibilityFactor && state.wanted.level > 0) {
                agent.state = "chase";
                agent.lastX = state.player.x;
                agent.lastZ = state.player.z;
            } else if (agent.state === "chase") {
                agent.state = "search";
            }

            const playerForwardX = Math.sin(state.player.rotation);
            const playerForwardZ = Math.cos(state.player.rotation);
            const playerSideX = Math.cos(state.player.rotation);
            const playerSideZ = -Math.sin(state.player.rotation);
            const baseTargetX = agent.state === "chase" ? state.player.x : agent.lastX;
            const baseTargetZ = agent.state === "chase" ? state.player.z : agent.lastZ;
            const intercept = agent.unitType === "suv"
                ? Math.min(14, Math.abs(state.player.speed) * 0.85)
                : agent.unitType === "motorcycle"
                    ? Math.min(9, Math.abs(state.player.speed) * 0.4)
                    : agent.unitType === "van"
                        ? 6
                        : Math.min(10, Math.abs(state.player.speed) * 0.55);
            const flank = agent.unitType === "motorcycle" ? (agent.side || 1) * 5.5 : 0;
            const targetX = baseTargetX + playerForwardX * intercept + playerSideX * flank;
            const targetZ = baseTargetZ + playerForwardZ * intercept + playerSideZ * flank;
            const targetAngle = Math.atan2(targetX - agent.x, targetZ - agent.z);
            let diff = targetAngle - agent.rotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            const turnRate = agent.unitType === "motorcycle" ? 3.2 : agent.unitType === "suv" ? 1.85 : agent.unitType === "van" ? 1.55 : 2.35;
            agent.rotation += Math.sign(diff) * Math.min(Math.abs(diff), (turnRate + state.wanted.level * 0.2) * dt);
            agent.targetSpeed = getPoliceTargetSpeed(agent);
            agent.speed += (agent.targetSpeed - agent.speed) * dt * 2.4;

            const next = {
                x: agent.x + Math.sin(agent.rotation) * agent.speed * dt,
                z: agent.z + Math.cos(agent.rotation) * agent.speed * dt,
            };
            if (pushOutBuildings(world, next, 1.25) || obstacleAt(world, next.x, next.z, 1.15)) {
                agent.rotation += agent.unitType === "motorcycle" ? 2.6 : 1.6;
                if (agent.unitType === "motorcycle" && Math.random() < 0.25) {
                    retiredAgents.push(agent);
                    spawnParticle(next.x, next.z, "#f7fbff", 10);
                    continue;
                }
                agent.speed *= agent.unitType === "suv" ? 0.68 : 0.55;
            }
            agent.x = clamp(next.x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            agent.z = clamp(next.z, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            agent.mesh.position.set(agent.x, 0.37, agent.z);
            agent.mesh.rotation.y = agent.rotation;

            if (agent.unitType === "van" && agent.state === "chase" && dist < 34 && state.roadblockCooldown <= 0 && agent.deployCooldown <= 0) {
                spawnRoadblock({ sourceAgent: agent, tactical: true });
                agent.deployCooldown = 10;
            }

            if (distanceSq(state.player.x, state.player.z, agent.x, agent.z) < CONFIG.police.collisionRadius * CONFIG.police.collisionRadius && agent.cooldown <= 0) {
                agent.cooldown = 0.9;
                const playerModel = CAR_MODELS[state.playerModelIndex];
                const playerMass = playerModel.mass ?? 1.0;
                const playerSpeedMag = state.player.speedMag ?? Math.abs(state.player.speed);
                const crashDamage = (agent.speed + playerSpeedMag) * (agent.unitType === "suv" ? 1.08 : 0.9) / playerMass;
                damagePlayer(crashDamage, "crash");
                audio?.crash();
                const dampFwd = agent.unitType === "suv" ? 0.34 : 0.45;
                state.player.vx *= dampFwd;
                state.player.vz *= dampFwd;
                state.player.speed = Math.sin(state.player.rotation) * state.player.vx + Math.cos(state.player.rotation) * state.player.vz;
                state.player.speedMag = Math.sqrt(state.player.vx ** 2 + state.player.vz ** 2);
                agent.speed *= agent.unitType === "motorcycle" ? 0.12 : 0.35;
                spawnParticle((state.player.x + agent.x) * 0.5, (state.player.z + agent.z) * 0.5, "#ff5a4c", 20);
                if (agent.unitType === "motorcycle" && playerSpeedMag > 8) {
                    retiredAgents.push(agent);
                    setStatus("Motorrad-Einheit ausgeschaltet.", 1.2);
                }
            }
        }

        for (const agent of retiredAgents) {
            const agentIndex = police.indexOf(agent);
            if (agentIndex >= 0) {
                scene.remove(agent.mesh);
                police.splice(agentIndex, 1);
            }
        }

        if (state.wanted.level > 0 && !near) {
            state.wanted.decay += dt * (isInEscapeCover(state.player.x, state.player.z) ? 1.45 : 1);
            if (state.wanted.decay > CONFIG.police.decayDelay) {
                state.wanted.decay = 0;
                updateWanted(state.wanted.level - 1);
            }
        } else {
            state.wanted.decay = 0;
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
                damagePlayer(10 + Math.abs(state.player.speed) * 0.65, "hazard");
                state.player.speed *= 0.22;
                state.cameraShake = Math.max(state.cameraShake, 0.55);
                state.stats.roadblocks += 1;
                audio?.crash();
                spawnParticle(block.x, block.z, "#ff9c45", 26);
                setStatus("Roadblock getroffen. Raus aus der Linie.", 1.8);
            }

            if (block.life <= 0 || state.wanted.level < 2) {
                scene.remove(block.mesh);
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
            hazard.life -= dt;
            hazard.mesh.material.opacity = Math.max(0.18, hazard.life / hazard.maxLife);
            if (distanceSq(state.player.x, state.player.z, hazard.x, hazard.z) < (hazard.radius + CONFIG.player.radius) ** 2) {
                if (hazard.type === "debris") {
                    damagePlayer((hazard.damage ?? 3.5) + Math.abs(state.player.speed) * 0.18, "hazard");
                    state.player.speed *= hazard.slowdown ?? 0.58;
                    spawnParticle(hazard.x, hazard.z, hazard.color ?? "#d9a06a", 10);
                    setStatus(hazard.message ?? "Truemmerfeld bremst dich aus.", 1.2);
                    if (hazard.consumeOnHit !== false) {
                        scene.remove(hazard.mesh);
                        hazards.splice(index, 1);
                    }
                } else if (hazard.type === "fallenLamp") {
                    damagePlayer(5 + Math.abs(state.player.speed) * 0.28, "hazard");
                    state.player.speed *= hazard.slowdown ?? 0.44;
                    state.cameraShake = Math.max(state.cameraShake, 0.28);
                    spawnParticle(hazard.x, hazard.z, hazard.color ?? "#ffe08a", 12);
                    setStatus("Gefallene Laterne blockiert die Spur.", 1.4);
                } else if (hazard.type === "closureBarrier") {
                    damagePlayer(6 + Math.abs(state.player.speed) * 0.34, "hazard");
                    state.player.speed *= 0.22;
                    state.cameraShake = Math.max(state.cameraShake, 0.32);
                    spawnParticle(hazard.x, hazard.z, "#ff9c45", 14);
                    setStatus("Sperrung blockiert die Route.", 1.4);
                } else {
                    damagePlayer(7 + Math.abs(state.player.speed) * 0.45, "hazard");
                    state.player.speed *= 0.28;
                    state.player.nitro = Math.max(0, state.player.nitro - 32);
                    spawnParticle(hazard.x, hazard.z, "#f7fbff", 18);
                    setStatus("Spike-Strip erwischt. Reifen verlieren Grip.", 1.8);
                    scene.remove(hazard.mesh);
                    hazards.splice(index, 1);
                }
                continue;
            }
            if (hazard.life <= 0) {
                scene.remove(hazard.mesh);
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
            state.actionPrompt = "E Garage oeffnen";
            if (input.consume("e")) openGarage();
        }

        if (nearGarage && state.garageCooldown <= 0) {
            if (state.player.health < getMaxHealth() || state.player.nitro < getNitroMax() - 4) {
                state.mission.repairCount += 1;
                state.player.health = Math.min(getMaxHealth(), state.player.health + 18);
                state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 20);
                state.garageCooldown = 3.5;
                setStatus("Garage: Reparatur und Nitro aufgefuellt.", 2);
            }
        }
        if (nearSafehouse && state.wanted.level > 0 && !missionUsesSafehouse) {
            state.actionPrompt = state.safehouseCooldown > 0
                ? "E Safehouse: Kontakt fuer $120 bestechen"
                : "Safehouse: Heat-Kontakt aktiv";
            if (input.consume("e")) {
                if (spendCash(120)) {
                    updateWanted(state.wanted.level - 1);
                    state.safehouseCooldown = 1.8;
                    setStatus("Safehouse: Heat reduziert.", 2);
                    audio?.upgrade();
                } else {
                    setStatus("Nicht genug Cash fuer den Safehouse-Kontakt.", 1.6);
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
        if (!canCashOutMission()) return;
        const target = currentMissionTurnInTarget();
        if (!target) return;

        const dist = distanceTo(target.x, target.z);
        const inZone = dist < CONFIG.map.poiRadius;
        if (inZone) {
            const nextHot = state.mission.riskLevel < state.mission.maxRiskLevel
                ? ` | Weiterziehen fuer x${(state.mission.cashoutMultiplier + 0.35).toFixed(2)}`
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

    function updateDistrict() {
        const nextDistrict = getDistrictAt(state.player.x, state.player.z);
        if (nextDistrict.id !== state.district.id) {
            state.district = nextDistrict;
            setStatus(`${nextDistrict.name}: Bezirksbonus ${nextDistrict.bonus}.`, 1.7);
        }
    }

    function updateTimeOfDay(dt, passive = false) {
        if (passive) return;
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
                ? "Nacht faellt ein. Mehr Neon, mehr Suchlichter, hoehere Event-Auszahlungen."
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
            const rainBursts = state.weather.mode === "storm" ? 5 : 3;
            for (let i = 0; i < rainBursts; i += 1) {
                spawnRainDrop(
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
            if (event.kind === "convoy" || event.kind === "race") {
                advanceEventMover(event, dt);
            } else {
                event.mesh.rotation.y += dt * 1.8;
                event.mesh.position.y = event.baseY + Math.sin(event.life * 3) * 0.18;
            }
            state.worldEvent.timer = Math.max(0, event.life);
            state.worldEvent.x = event.x;
            state.worldEvent.z = event.z;
            if (distanceSq(state.player.x, state.player.z, event.x, event.z) < (event.collectRadius ?? 13) ** 2) {
                addScore(event.score, true);
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
            camera.position.lerp(tempTarget, Math.min(1, dt * 1.2));
            camera.lookAt(0, 0, 0);
            const targetFov = CONFIG.camera.fovBase;
            camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 2);
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

        const speedLift = Math.min(3.5, speedMag * 0.1);
        tempTarget.set(
            player.x - forwardX * CONFIG.camera.backOffset + leanX,
            CONFIG.camera.height + speedLift,
            player.z - forwardZ * CONFIG.camera.backOffset + leanZ
        );
        camera.position.lerp(tempTarget, Math.min(1, dt * CONFIG.camera.followLerp));

        if (state.cameraShake > 0) {
            state.cameraShake = Math.max(0, state.cameraShake - dt * 2.8);
            camera.position.x += (Math.random() - 0.5) * state.cameraShake * 1.2;
            camera.position.z += (Math.random() - 0.5) * state.cameraShake * 1.2;
        }

        // Dynamic FOV — widens with speed for rush feeling
        const targetFov = CONFIG.camera.fovBase + speedRatio * (CONFIG.camera.fovMax - CONFIG.camera.fovBase);
        camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 2.8);
        camera.updateProjectionMatrix();

        camera.lookAt(
            player.x + forwardX * speedMag * 0.22,
            0,
            player.z + forwardZ * speedMag * 0.22
        );
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
            collectRadius: event.kind === "convoy" || event.kind === "race" ? 6.2 : 13,
        };

        if (event.kind === "convoy" || event.kind === "race") {
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
        scene.remove(event.mesh);
        if (event.barriers) {
            for (const barrier of event.barriers) {
                scene.remove(barrier.mesh);
                const hazardIndex = hazards.indexOf(barrier);
                if (hazardIndex >= 0) hazards.splice(hazardIndex, 1);
            }
        }
        eventPickups.splice(index, 1);
        state.worldEvent.active = false;
        state.worldEvent.label = "Ruhige Strassen";
        state.worldEvent.timer = 18 + Math.random() * 28;
    }

    function spawnRainDrop(x, z) {
        if (rainDrops.length > 90) return;
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(0.035, 1.1, 0.035),
            createMaterial("#8fd8ff", { emissive: "#63c8ff", emissiveIntensity: 0.35, transparent: true, opacity: 0.45 })
        );
        mesh.position.set(x, 12 + Math.random() * 12, z);
        scene.add(mesh);
        rainDrops.push({ mesh, life: 0.55 + Math.random() * 0.35 });
    }

    function updateRain(dt) {
        for (let index = rainDrops.length - 1; index >= 0; index -= 1) {
            const drop = rainDrops[index];
            drop.life -= dt;
            drop.mesh.position.y -= dt * 24;
            if (drop.life <= 0 || drop.mesh.position.y <= 0.35) {
                scene.remove(drop.mesh);
                rainDrops.splice(index, 1);
            }
        }
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
        traffic.push({ mesh, x, z, axis, direction, speed: baseSpeed + Math.random() * 3.2, model, cooldown: 0, districtId: district.id, headlights });
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

    function spawnPolice(near = true) {
        if (police.length >= CONFIG.police.maxCount) return;
        const unitType = pickPoliceUnitType();
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
            role: unitType === "suv" ? "ram" : unitType === "motorcycle" ? "rapid" : unitType === "van" ? "blocker" : "direct",
            side: Math.random() < 0.5 ? -1 : 1,
            heavy: unitType === "suv" || unitType === "van",
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
        hazards.push({ mesh, x, z, radius: 3.2, life: 12, maxLife: 12 });
        setStatus("Dispatch: Spike-Strip gelegt.", 1.7);
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
                scene.remove(agent.mesh);
                police.splice(index, 1);
                disabled += 1;
            }
        }
        for (let index = hazards.length - 1; index >= 0; index -= 1) {
            const hazard = hazards[index];
            if (distanceSq(x, z, hazard.x, hazard.z) < 34 * 34) {
                scene.remove(hazard.mesh);
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
        setStatus(`EMP gezuendet. ${disabled} Einheiten deaktiviert.`, 2);
    }

    function addSkidMark() {
        if (skidMarks.length > 160) {
            const old = skidMarks.shift();
            scene.remove(old.mesh);
        }
        const driftIntensity = Math.min(1, state.player.drift);
        const markWidth = 0.32 + driftIntensity * 0.14;
        const mark = new THREE.Mesh(
            new THREE.BoxGeometry(markWidth, 0.018, 2.1),
            createMaterial("#040506", { roughness: 1, transparent: true, opacity: 0.48 })
        );
        const rearX = state.player.x - Math.sin(state.player.rotation) * 1.7;
        const rearZ = state.player.z - Math.cos(state.player.rotation) * 1.7;
        mark.position.set(rearX, 0.13, rearZ);
        mark.rotation.y = state.player.rotation;
        scene.add(mark);
        skidMarks.push({ mesh: mark, life: 16 });
    }

    function updateSkidMarks(dt) {
        for (let index = skidMarks.length - 1; index >= 0; index -= 1) {
            skidMarks[index].life -= dt;
            skidMarks[index].mesh.material.opacity = Math.max(0, skidMarks[index].life / 16) * 0.48;
            if (skidMarks[index].life <= 0) {
                scene.remove(skidMarks[index].mesh);
                skidMarks.splice(index, 1);
            }
        }
    }

    function spawnPopup(text, type = "normal") {
        state.popup = { text, timer: 1.6, type };
    }

    function spawnDriftSmoke(x, z) {
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.22 + Math.random() * 0.18, 6, 6),
            createMaterial("#c8cdd6", { roughness: 1, transparent: true, opacity: 0.28 })
        );
        mesh.position.set(x, 0.28, z);
        scene.add(mesh);
        particles.push({
            mesh,
            vx: (Math.random() - 0.5) * 1.4,
            vy: 0.8 + Math.random() * 0.7,
            vz: (Math.random() - 0.5) * 1.4,
            life: 0.6 + Math.random() * 0.5,
            age: 0,
            smoke: true,
        });
    }

    function triggerNearMiss() {
        const nearMiss = state.nearMiss;
        nearMiss.count += 1;
        nearMiss.streak += 1;
        nearMiss.timer = 8;
        nearMiss.streakTimer = 6;
        const earned = Math.round(80 + state.combo.chain * 5);
        addScore(earned);
        spawnParticle(state.player.x, state.player.z, "#ffc64d", 6);
        spawnPopup(`CLOSE! +${earned}`, "nearMiss");
        audio?.nearMiss?.();
        if (nearMiss.streak >= 3) {
            setStatus(`Near-Miss Streak x${nearMiss.streak}! Tempo behalten.`, 1.4);
        }
    }

    function spawnParticle(x, z, color, count) {
        for (let index = 0; index < count; index += 1) {
            const mesh = new THREE.Mesh(particleGeo, createMaterial(color, { emissive: color, emissiveIntensity: 0.65, transparent: true }));
            mesh.position.set(x, 0.8 + Math.random() * 0.8, z);
            scene.add(mesh);
            particles.push({
                mesh,
                vx: (Math.random() - 0.5) * 10,
                vy: 3 + Math.random() * 7,
                vz: (Math.random() - 0.5) * 10,
                life: 0.45 + Math.random() * 0.7,
                age: 0,
            });
        }
    }

    function updateParticles(dt) {
        for (let index = particles.length - 1; index >= 0; index -= 1) {
            const particle = particles[index];
            particle.age += dt;
            if (particle.age >= particle.life) {
                scene.remove(particle.mesh);
                particles.splice(index, 1);
                continue;
            }
            const t = particle.age / particle.life;
            if (particle.smoke) {
                particle.vx *= 0.96;
                particle.vz *= 0.96;
                particle.mesh.position.x += particle.vx * dt;
                particle.mesh.position.y += particle.vy * dt;
                particle.mesh.position.z += particle.vz * dt;
                particle.mesh.scale.setScalar(1 + t * 1.8);
                particle.mesh.material.opacity = 0.28 * (1 - t);
            } else {
                particle.vy -= 12 * dt;
                particle.mesh.position.x += particle.vx * dt;
                particle.mesh.position.y += particle.vy * dt;
                particle.mesh.position.z += particle.vz * dt;
                particle.mesh.scale.setScalar(1 - t);
                particle.mesh.material.opacity = 1 - t;
            }
        }
    }

    function damagePlayer(amount, source = "generic") {
        if (!state.running) return;
        if (source === "crash" || source === "hazard") state.mission.collisionCount += 1;
        const mitigated = amount * (1 - state.upgrades.armor * 0.075);
        state.player.health -= mitigated;
        state.cameraShake = Math.max(state.cameraShake, mitigated * 0.02);
        if (state.player.health <= 0) {
            state.player.health = 0;
            state.running = false;
            state.screen = "gameover";
            state.bestScore = Math.max(state.bestScore, Math.round(state.score));
            persistProfile();
            showGameOver(ui, state);
        }
    }

    function updateWanted(level) {
        const previous = state.wanted.level;
        state.wanted.level = clamp(Math.round(level), 0, 5);
        state.wanted.tier = getHeatTier().name;
        if (state.wanted.level > previous) {
            state.cameraShake = Math.max(state.cameraShake, 0.12 + state.wanted.level * 0.03);
        }
    }

    function addScore(amount, missionReward = false) {
        if (amount <= 0) return 0;
        if (missionReward) state.combo.chain += 3;
        else state.combo.chain += 1;
        state.combo.timer = missionReward ? 6 : 4.2;
        state.combo.best = Math.max(state.combo.best, state.combo.chain);
        state.combo.multiplier = clamp(
            HEAT_TIERS[state.wanted.level].score + Math.floor(Math.max(0, state.combo.chain - 1) / 4) * 0.25,
            1,
            3.8
        );
        const gained = amount * state.combo.multiplier;
        state.score += gained;
        refreshProgress();
        return gained;
    }

    function addCash(amount) {
        if (!amount) return;
        const multiplier = state.screen === "playing" ? state.district?.cashMultiplier ?? 1 : 1;
        const gained = Math.round(amount * multiplier);
        state.cash += gained;
        persistProfile();
        return gained;
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

    function refreshProgress() {
        const contract = CONTRACTS.find((item) => item.id === state.contract.id) ?? CONTRACTS[0];
        state.contract.progress = Math.min(contract.target, getRunMetric(contract.metric));
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

    function getNextUpgrade() {
        let best = null;
        for (const id of Object.keys(UPGRADES)) {
            const level = state.upgrades[id] ?? 0;
            if (level >= UPGRADES[id].max) continue;
            const cost = getUpgradeCost(id);
            if (!best || level < best.level || (level === best.level && cost < best.cost)) {
                best = { id, level, cost };
            }
        }
        return best;
    }

    function buyNextUpgrade() {
        const next = getNextUpgrade();
        if (!next) {
            setStatus("Garage: alle Upgrades sind voll ausgebaut.", 1.8);
            audio?.denied();
            return;
        }
        if (!spendCash(next.cost)) {
            setStatus(`Garage: $${next.cost} benoetigt fuer ${UPGRADES[next.id].label}.`, 1.8);
            audio?.denied();
            return;
        }

        state.upgrades[next.id] += 1;
        if (next.id === "armor") state.player.health = Math.min(getMaxHealth(), state.player.health + 26);
        if (next.id === "nitro") state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 32);
        spawnParticle(state.player.x, state.player.z, "#c9a5ff", 18);
        setStatus(`${UPGRADES[next.id].label} Level ${state.upgrades[next.id]} installiert: ${UPGRADES[next.id].effect}.`, 2.6);
        audio?.upgrade();
        persistProfile();
    }

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
            setStatus(`Garage: $${cost} benoetigt fuer ${UPGRADES[id].label}.`, 1.8);
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

    function resetProfile() {
        clearProfile();
        const fresh = createDefaultProfile(CAR_MODELS, UPGRADES);
        state.cash = fresh.cash;
        state.bestScore = 0;
        state.unlockedCars = [...fresh.unlockedCars];
        state.achievements = [];
        state.lifetime = { ...fresh.lifetime };
        state.upgrades = { ...fresh.upgrades };
        state.playerModelIndex = 0;
        state.profile = fresh;
        replaceCarModel(playerCar, CAR_MODELS[0], sharedMaterials);
        setStatus("Profil geloescht. Neustart bereit.", 2);
        openMenu();
    }

    function persistProfile() {
        state.profile = {
            version: 2,
            bestScore: Math.max(state.bestScore, Math.round(state.score)),
            cash: Math.max(0, Math.round(state.cash)),
            selectedCarId: CAR_MODELS[state.playerModelIndex].id,
            unlockedCars: [...state.unlockedCars],
            upgrades: { ...state.upgrades },
            achievements: [...state.achievements],
            lifetime: { ...state.lifetime },
        };
        state.bestScore = state.profile.bestScore;
        saveProfile(state.profile);
    }

    function buildMissionConfig(stage, districtId, chainStage) {
        const stageScale = Math.floor((stage - 1) / 3);
        const district = DISTRICTS.find((entry) => entry.id === districtId) ?? DISTRICTS[0];

        if (districtId === "downtown") {
            if (chainStage === 0) {
                return {
                    type: "delivery",
                    title: "Downtown Warm-up",
                    description: "Kurierfahrt durch die engen Straassenschluchten.",
                    target: 1,
                    timer: 50 + stageScale * 4,
                    from: { name: "Courier Hub", x: 18, z: 40 },
                    to: { name: "Skyline Drop", x: 47, z: 19 },
                    maxRiskLevel: 3,
                    bonus: { id: "quickFinish", label: "Tempo-Bonus", description: "Schliesse frueh ab.", target: 20, reward: 220 },
                };
            }
            if (chainStage === 1) {
                return {
                    type: "checkpoint",
                    title: "Neon Line",
                    description: "Nimm die Boulevard-Linie durch Downtown.",
                    target: 3 + Math.min(2, stageScale),
                    timer: 46 + stageScale * 4,
                    route: getDistrictWaypointRoute(districtId, 3 + Math.min(2, stageScale), stage),
                    bonus: { id: "noCrash", label: "Saubere Linie", description: "Ohne Einschlag bleiben.", target: 1, reward: 240 },
                };
            }
            return {
                type: "pursuit",
                title: "Blue Light Bait",
                description: "Zieh die Verfolger durch die Hochhauskanten.",
                target: 3 + stageScale,
                timer: 40 + stageScale * 4,
                minimumHeat: 2 + Math.min(2, stageScale),
                bonus: { id: "highHeat", label: "Heisses Finale", description: "Mit Heat 3+ abschliessen.", target: 3, reward: 280 },
            };
        }

        if (districtId === "industrial") {
            if (chainStage === 0) {
                return {
                    type: "pickup",
                    title: "Scrapyard Sweep",
                    description: "Sichere Teile im Industriebezirk.",
                    target: 3 + stageScale,
                    timer: 54 + stageScale * 4,
                    to: createDistrictAnchor(district),
                    pickupSeed: 4,
                    bonus: { id: "noRepair", label: "Werkstattverbot", description: "Keine Garage waehrend des Auftrags.", target: 1, reward: 210 },
                };
            }
            if (chainStage === 1) {
                return {
                    type: "delivery",
                    title: "Parts Run",
                    description: "Bring den Werkstatt-Transfer aus dem Yard raus.",
                    target: 1,
                    timer: 52 + stageScale * 4,
                    from: getPoi("yard"),
                    to: getPoi("depot"),
                    maxRiskLevel: 2,
                    bonus: { id: "quickFinish", label: "Schichtende", description: "Unter Zeitdruck liefern.", target: 18, reward: 240 },
                };
            }
            return {
                type: "heist",
                title: "Foundry Grab",
                description: "Zieh heisse Ware aus dem Rostguerel und bring sie raus.",
                target: 1,
                timer: 48 + stageScale * 4,
                from: { name: "Schmelzhof", x: -18, z: 22 },
                to: getPoi("safehouse"),
                minimumHeat: 3,
                maxRiskLevel: 3,
                bonus: { id: "noCrash", label: "Keine Dellen", description: "Ohne Einschlag rausfahren.", target: 1, reward: 300 },
            };
        }

        if (districtId === "park") {
            if (chainStage === 0) {
                return {
                    type: "checkpoint",
                    title: "Green Drift",
                    description: "Zieh die Route ueber Wege und Wiesenlinien.",
                    target: 3 + Math.min(2, stageScale),
                    timer: 50 + stageScale * 4,
                    route: getDistrictWaypointRoute(districtId, 3 + Math.min(2, stageScale), stage),
                    bonus: { id: "shortcut", label: "Shortcut-Line", description: "Nutze Parkwege mehrfach.", target: 2, reward: 230 },
                };
            }
            if (chainStage === 1) {
                return {
                    type: "pickup",
                    title: "Nitro Bloom",
                    description: "Raeum mobile Caches im Parkbecken ab.",
                    target: 3 + stageScale,
                    timer: 48 + stageScale * 4,
                    to: createDistrictAnchor(district),
                    pickupSeed: 4,
                    bonus: { id: "shortcut", label: "Pfadfinder", description: "Bleib ueber die Park-Cuts in Bewegung.", target: 2, reward: 220 },
                };
            }
            return {
                type: "escape",
                title: "Quiet Exit",
                description: "Bring den Run sauber zur Garage, bevor Heat zuschnappt.",
                target: 1,
                timer: 38 + stageScale * 4,
                to: getPoi("garage"),
                minimumHeat: 1 + Math.min(2, stageScale),
                maxRiskLevel: 2,
                bonus: { id: "noCrash", label: "Soft Touch", description: "Ohne Einschlag zur Ausfahrt.", target: 1, reward: 260 },
            };
        }

        if (chainStage === 0) {
            return {
                type: "delivery",
                title: "Dock Runner",
                description: "Schmuggelware aus der Hafenzone herausziehen.",
                target: 1,
                timer: 48 + stageScale * 4,
                from: { name: "Pier Safe", x: -44, z: -19 },
                to: getPoi("safehouse"),
                minimumHeat: 2,
                maxRiskLevel: 3,
                bonus: { id: "highHeat", label: "Heisse Route", description: "Mit Heat 3+ abgeben.", target: 3, reward: 280 },
            };
        }
        if (chainStage === 1) {
            return {
                type: "checkpoint",
                title: "Crane Loop",
                description: "Spring die Dock-Linie von Rampe zu Rampe ab.",
                target: 3 + Math.min(2, stageScale),
                timer: 44 + stageScale * 4,
                route: getDistrictWaypointRoute(districtId, 3 + Math.min(2, stageScale), stage),
                bonus: { id: "quickFinish", label: "Schnelle Uebergabe", description: "Mit Zeitreserve beenden.", target: 16, reward: 250 },
            };
        }
        return {
            type: "escape",
            title: "Breakwater Exit",
            description: "Schuettel den Druck ab und bring den Run heim.",
            target: 1,
            timer: 36 + stageScale * 4,
            to: getPoi("safehouse"),
            minimumHeat: 3,
            bonus: { id: "highHeat", label: "Harter Cut", description: "Mit Heat 4+ rauskommen.", target: 4, reward: 320 },
        };
    }

    function shouldSpawnBossMission(stage) {
        return stage > 0 && stage % 6 === 0;
    }

    function buildBossMissionConfig(stage, districtId) {
        const bossIndex = Math.floor(stage / 6) % 3;
        if (bossIndex === 1) {
            return {
                type: "bossArmored",
                title: "Boss: Gepanzerter Transporter",
                description: "Brich den Konvoi auf, sichere die Ladung und bring sie heim.",
                target: 1,
                timer: 64,
                to: getPoi("safehouse"),
                minimumHeat: 4,
                isBoss: true,
                bossType: "armoredTransporter",
                districtId: "industrial",
                maxRiskLevel: 3,
                bonus: { id: "highHeat", label: "Grosswild", description: "Mit Heat 4+ abgeben.", target: 4, reward: 420 },
            };
        }
        if (bossIndex === 2) {
            return {
                type: "bossHeli",
                title: "Boss: Helikopterjagd",
                description: "Halte die Jagd aus, dann tauch am Safehouse ab.",
                target: 1,
                timer: 58,
                to: getPoi("safehouse"),
                minimumHeat: 5,
                isBoss: true,
                bossType: "helicopterHunt",
                districtId: "downtown",
                maxRiskLevel: 2,
                bonus: { id: "quickFinish", label: "Aus dem Licht", description: "Finde frueh den Ausstieg.", target: 24, reward: 400 },
            };
        }
        return {
            type: "bossBlockade",
            title: "Boss: Hafenblockade",
            description: "Spreng die Sperre auf und finde den Ausweg durch die Docks.",
            target: 2,
            timer: 60,
            to: { name: "Breakwater Gate", x: -44, z: -14 },
            minimumHeat: 4,
            isBoss: true,
            bossType: "harborBlockade",
            districtId: "harbor",
            maxRiskLevel: 3,
            bonus: { id: "noCrash", label: "Sauberer Durchbruch", description: "Ohne Einschlag durch die Blockade.", target: 1, reward: 430 },
        };
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
        setStatus(`Hot Drop verlaengert. Multiplikator x${state.mission.cashoutMultiplier.toFixed(2)}. Heat steigt.`, 2.2);
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
        if (missionBoss.mesh) scene.remove(missionBoss.mesh);
        if (missionBoss.blockers) {
            for (const blocker of missionBoss.blockers) {
                scene.remove(blocker.mesh);
                const roadblockIndex = roadblocks.indexOf(blocker);
                if (roadblockIndex >= 0) roadblocks.splice(roadblockIndex, 1);
            }
        }
        missionBoss = null;
    }

    function destroyObstacle(obstacle, impact) {
        if (!obstacle.mesh || obstacle.destroyed) return;
        obstacle.destroyed = true;
        scene.remove(obstacle.mesh);
        const index = world.obstacles.indexOf(obstacle);
        if (index >= 0) world.obstacles.splice(index, 1);
        const reward = obstacle.reward ?? Math.round(20 + impact * 5);
        addScore(reward);
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
        if (obstacle.type === "dumpster") return `Muellcontainer weggeschoben. +${reward} Score.`;
        if (obstacle.type === "constructionBeacon") return `Baustellenbake zerlegt. +${reward} Score.`;
        return `${obstacle.label ?? "Prop"} zerlegt. +${reward} Score.`;
    }

    function applyWeatherVisuals() {
        const weather = WEATHER_MODES[state.weather.mode] ?? WEATHER_MODES.clear;
        const color = new THREE.Color(weather.color);
        if (state.time.phase === "night") color.lerp(new THREE.Color("#071018"), 0.38);
        scene.background = color;
        if (scene.fog) {
            scene.fog.color.copy(color);
            const fogNear = state.weather.mode === "fog" ? 20 : state.weather.mode === "storm" ? 28 : 48;
            const fogFar = state.weather.mode === "fog" ? 72 : state.weather.mode === "storm" ? 102 : 130;
            scene.fog.near = state.time.phase === "night" ? fogNear * 0.92 : fogNear;
            scene.fog.far = state.time.phase === "night" ? fogFar * 0.9 : fogFar;
        }
        if (lights) {
            lights.ambient.intensity = state.time.phase === "night" ? 0.7 : state.weather.mode === "storm" ? 0.92 : 1.25;
            lights.sun.intensity = state.time.phase === "night"
                ? (state.weather.mode === "storm" ? 0.85 : 0.55)
                : state.weather.mode === "storm" ? 2.6 : 4.8;
            lights.nightGlow.intensity = state.time.phase === "night" ? 1.7 : state.weather.mode === "fog" ? 1.05 : 0.9;
            lights.nightGlow.color.set(state.time.phase === "night" ? "#69d0ff" : "#63c8ff");
        }
        renderer.toneMappingExposure = state.time.phase === "night" ? 0.92 : state.weather.mode === "storm" ? 0.98 : 1.08;
    }

    function updateDebug(dt) {
        debugClock.frames += 1;
        debugClock.timer += dt;
        if (debugClock.timer >= 0.5) {
            state.debug.fps = debugClock.frames / debugClock.timer;
            state.debug.entities = traffic.length + police.length + pickups.length + roadblocks.length + hazards.length + eventPickups.length;
            debugClock.frames = 0;
            debugClock.timer = 0;
        }
    }

    function setStatus(text, duration) {
        state.statusMessage = text;
        state.statusTimer = duration;
    }

    function clearEntities(array) {
        for (let index = array.length - 1; index >= 0; index -= 1) {
            scene.remove(array[index].mesh);
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
        if (agent.state !== "chase") return agent.unitType === "motorcycle" ? 9.5 : 8;
        if (agent.unitType === "motorcycle") return 13.5 + state.wanted.level * 1.35 + (state.time.phase === "night" ? 0.8 : 0);
        if (agent.unitType === "suv") return 10.8 + state.wanted.level * 1.1;
        if (agent.unitType === "van") return 9.2 + state.wanted.level * 0.85;
        return 11.5 + state.wanted.level * 1.4 + (state.time.phase === "night" ? 0.8 : 0);
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
        for (const building of world.buildings) {
            if ((building.h ?? 0) < 12) continue;
            const edgeDx = Math.max(0, Math.abs(x - building.x) - building.hw);
            const edgeDz = Math.max(0, Math.abs(z - building.z) - building.hd);
            const edgeDistance = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
            if (edgeDistance < 3.4) return true;
        }
        return false;
    }

    function isNearCraneCover(x, z) {
        for (const obstacle of world.obstacles) {
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
                setStatus("Zaun durchbrochen. Sichtlinie kurz gestoert.", 1.4);
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
            message: "Zaunreste schlittern ueber den Asphalt.",
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
        resetProfile,
    };
}
