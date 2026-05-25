import * as THREE from "three";
import { ACHIEVEMENTS, CONFIG, CAR_MODELS, CONTRACTS, DISTRICTS, HEAT_TIERS, PICKUP_TYPES, POIS, UPGRADES, WEATHER_MODES, WORLD_EVENTS } from "./config.js";
import { clearProfile, createDefaultProfile, saveProfile } from "./save.js";
import { hideGameOver, renderHud, showGameOver } from "./ui.js";
import { createCar, createMaterial, replaceCarModel } from "./vehicles.js";
import { insideBuilding, obstacleAt, pushOutBuildings, snapStreet } from "./world.js";

export function createGameRuntime({ scene, camera, renderer, world, ui, state, sharedMaterials, audio }) {
    const pickups = [];
    const police = [];
    const traffic = [];
    const roadblocks = [];
    const hazards = [];
    const eventPickups = [];
    const particles = [];
    const skidMarks = [];
    const rainDrops = [];
    const helicopter = createHelicopterMesh();
    const pickupGeo = new THREE.OctahedronGeometry(0.55, 0);
    const particleGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const eventGeo = new THREE.DodecahedronGeometry(0.85, 0);
    const hazardGeo = new THREE.BoxGeometry(4.8, 0.08, 0.7);
    const tempTarget = new THREE.Vector3();
    const debugClock = { frames: 0, timer: 0 };
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
        state.player.health = getMaxHealth();
        state.player.nitro = 24;
        state.player.drift = 0;
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
        state.weather.mode = "clear";
        state.weather.label = WEATHER_MODES.clear.label;
        state.weather.timer = 28;
        state.weather.intensity = 0;
        state.district = getDistrictAt(0, 0);
        setMission(1);
        setStatus(options.showMenu ? "Waehle einen Run oder pruefe die Garage." : "Direkt im Spiel. Fahre los.", 2.8);
        hideGameOver(ui);

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
        updateDebug(dt);

        if (!state.running || state.paused || state.screen !== "playing") {
            updateParticles(dt);
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
        const typeIndex = (stage - 1) % 6;
        state.mission.stage = stage;
        state.mission.progress = 0;
        state.mission.cargo = false;
        state.mission.route = [];
        state.mission.routeIndex = 0;
        state.mission.timer = 62 + stage * 5;

        if (typeIndex === 0) {
            state.mission.type = "pickup";
            state.mission.target = 3 + stage;
            state.mission.from = null;
            state.mission.to = null;
        } else if (typeIndex === 1) {
            state.mission.type = "delivery";
            state.mission.target = 1;
            state.mission.from = getPoi("depot");
            state.mission.to = getPoi(stage % 2 ? "garage" : "fuel");
            state.mission.timer = 58 + stage * 6;
        } else if (typeIndex === 2) {
            state.mission.type = "checkpoint";
            state.mission.target = Math.min(5, 3 + Math.floor(stage / 4));
            state.mission.route = chooseRoute(stage, state.mission.target);
            state.mission.to = state.mission.route[0];
            state.mission.from = null;
            state.mission.timer = 48 + stage * 5;
        } else if (typeIndex === 3) {
            state.mission.type = "pursuit";
            state.mission.target = 3 + Math.floor(stage / 3);
            state.mission.from = null;
            state.mission.to = null;
            state.mission.timer = 42 + stage * 4;
            updateWanted(Math.max(state.wanted.level, 2 + Math.floor(stage / 4)));
        } else if (typeIndex === 4) {
            state.mission.type = "heist";
            state.mission.target = 1;
            state.mission.from = getPoi("precinct");
            state.mission.to = getPoi("safehouse");
            state.mission.timer = 54 + stage * 5;
            updateWanted(Math.max(state.wanted.level, 3));
        } else {
            state.mission.type = "escape";
            state.mission.target = 1;
            state.mission.from = null;
            state.mission.to = getPoi("safehouse");
            state.mission.timer = 34 + stage * 4;
            updateWanted(Math.max(state.wanted.level, Math.min(4, 1 + Math.floor(stage / 2))));
        }
    }

    function updatePlayer(dt, input) {
        const model = CAR_MODELS[state.playerModelIndex];
        const player = state.player;
        const engineLevel = state.upgrades.engine;
        const gripLevel = state.upgrades.grip;
        const nitroLevel = state.upgrades.nitro;
        const weatherGrip = WEATHER_MODES[state.weather.mode]?.grip ?? 1;
        const maxSpeed = model.maxSpeed * (1 + engineLevel * 0.075);
        const acceleration = model.acceleration * (1 + engineLevel * 0.085) * (0.92 + weatherGrip * 0.08);
        const turnPower = model.turn * (1 + gripLevel * 0.045) * weatherGrip;
        const brakePower = (8.5 + gripLevel * 1.9) * weatherGrip;
        const nitroMax = getNitroMax();
        const keys = input.keys;
        const forward = keys.w || keys.arrowup ? 1 : 0;
        const reverse = keys.s || keys.arrowdown ? 1 : 0;
        const left = keys.a || keys.arrowleft ? 1 : 0;
        const right = keys.d || keys.arrowright ? 1 : 0;
        const handbrake = Boolean(keys[" "]);
        const nitro = Boolean(keys.shift && player.nitro > 0 && Math.abs(player.speed) > 2);
        const boostedMax = maxSpeed + (nitro ? CONFIG.player.nitroBonus + nitroLevel * 2.4 : 0);

        if (nitro) {
            player.nitro = Math.max(0, player.nitro - dt * CONFIG.player.nitroBurn);
            spawnParticle(player.x - Math.sin(player.rotation) * 2, player.z - Math.cos(player.rotation) * 2, "#63c8ff", 2);
        } else {
            player.nitro = Math.min(nitroMax, player.nitro + dt * (CONFIG.player.nitroRegen + nitroLevel * 0.9));
        }

        if (forward) {
            player.speed += acceleration * dt;
        } else if (reverse) {
            player.speed -= (player.speed > 0 ? 24 + gripLevel * 2.5 : acceleration * 0.65) * dt;
        } else {
            player.speed -= Math.sign(player.speed) * Math.min(Math.abs(player.speed), (handbrake ? 15 + gripLevel * 2 : brakePower) * dt);
        }

        player.speed = clamp(player.speed, -boostedMax * CONFIG.player.reverseFactor, boostedMax);
        const turnInput = left - right;
        if (Math.abs(player.speed) > 0.12) {
            const turnScale = 1 - Math.min(0.58, Math.abs(player.speed) / boostedMax * 0.45);
            player.rotation += turnInput * turnPower * (handbrake ? 1.45 + gripLevel * 0.04 : 1) * turnScale * dt * Math.sign(player.speed);
        }

        player.drift = handbrake && Math.abs(player.speed) > 5 && Math.abs(turnInput) > 0
            ? 1
            : Math.max(0, player.drift - dt * 3);
        if (player.drift > 0) {
            const driftGain = Math.abs(player.speed) * dt * (0.8 + gripLevel * 0.08);
            state.combo.driftBank += driftGain;
            state.combo.driftScore += driftGain * 10;
            state.stats.driftScore += driftGain * 10;
            if (state.combo.driftBank >= 14) {
                state.combo.driftBank = 0;
                addScore(18 + gripLevel * 5);
            }
        }

        const next = {
            x: clamp(player.x + Math.sin(player.rotation) * player.speed * dt, -CONFIG.map.size / 2, CONFIG.map.size / 2),
            z: clamp(player.z + Math.cos(player.rotation) * player.speed * dt, -CONFIG.map.size / 2, CONFIG.map.size / 2),
        };

        const hitBuilding = pushOutBuildings(world, next, CONFIG.player.radius);
        const hitObstacle = obstacleAt(world, next.x, next.z, CONFIG.player.radius);
        if (hitObstacle) {
            const dx = next.x - hitObstacle.x;
            const dz = next.z - hitObstacle.z;
            const distance = Math.sqrt(dx * dx + dz * dz) || 1;
            next.x += (dx / distance) * 1.2;
            next.z += (dz / distance) * 1.2;
            if (hitObstacle.destructible && Math.abs(player.speed) > 6) {
                destroyObstacle(hitObstacle, Math.abs(player.speed));
            }
        }

        if (hitBuilding || hitObstacle) {
            const impact = Math.abs(player.speed);
            player.speed *= 0.34;
            if (impact > 5) {
                damagePlayer(impact * (hitBuilding ? 0.8 : 0.55));
                state.cameraShake = Math.min(1, impact * 0.04);
                spawnParticle(next.x, next.z, hitBuilding ? "#ff6a4f" : "#ffc64d", 18);
            }
        }

        player.x = next.x;
        player.z = next.z;
        playerCar.position.set(player.x, 0.38, player.z);
        playerCar.rotation.y = player.rotation;

        if (player.drift > 0) addSkidMark();
    }

    function updateMission(dt) {
        state.mission.timer -= dt;
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
            if (state.mission.cargo && distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) completeMission();
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
            if (state.mission.cargo && distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) completeMission();
        }

        if (state.mission.type === "escape") {
            if (state.wanted.level < 1) updateWanted(1);
            if (distanceTo(state.mission.to.x, state.mission.to.z) < CONFIG.map.poiRadius) {
                updateWanted(Math.max(0, state.wanted.level - 2));
                completeMission();
            }
        }
    }

    function completeMission() {
        const reward = 850 + state.mission.stage * 230 + (state.mission.type === "heist" ? 600 : 0);
        addScore(reward, true);
        addCash(Math.floor(reward * 0.34));
        state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 30);
        state.stats.missions += 1;
        state.lifetime.missions += 1;
        if (state.wanted.level <= 2) state.stats.missionsLowHeat += 1;
        refreshProgress();
        audio?.mission();
        setStatus(`Mission ${state.mission.stage} abgeschlossen. Bonus $${Math.floor(reward * 0.34)}.`, 3);
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
        const gained = addScore(info.score);
        addCash(info.cash || 0);
        if (info.heal) state.player.health = Math.min(getMaxHealth(), state.player.health + info.heal);
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
            state.mission.progress += 1;
            if (state.mission.progress >= state.mission.target) completeMission();
        }
    }

    function updateTraffic(dt) {
        for (const car of traffic) {
            car.cooldown = Math.max(0, car.cooldown - dt);
            const move = car.speed * car.direction * dt;
            if (car.axis === "x") car.x += move;
            else car.z += move;

            if (car.x > CONFIG.map.size / 2 + 6) car.x = -CONFIG.map.size / 2 - 6;
            if (car.x < -CONFIG.map.size / 2 - 6) car.x = CONFIG.map.size / 2 + 6;
            if (car.z > CONFIG.map.size / 2 + 6) car.z = -CONFIG.map.size / 2 - 6;
            if (car.z < -CONFIG.map.size / 2 - 6) car.z = CONFIG.map.size / 2 + 6;

            car.mesh.position.set(car.x, 0.35, car.z);
            if (distanceSq(state.player.x, state.player.z, car.x, car.z) < CONFIG.traffic.collisionRadius * CONFIG.traffic.collisionRadius && car.cooldown <= 0) {
                car.cooldown = 1.1;
                damagePlayer(Math.abs(state.player.speed) * 0.55 + 5);
                audio?.crash();
                state.player.speed *= 0.42;
                spawnParticle((state.player.x + car.x) * 0.5, (state.player.z + car.z) * 0.5, "#ffb14c", 18);
                updateWanted(state.wanted.level + 1);
            }
        }
    }

    function updatePolice(dt) {
        const heatTier = getHeatTier();
        state.wanted.emp = Math.max(0, state.wanted.emp - dt);
        const targetPolice = Math.max(0, heatTier.police - (state.wanted.emp > 0 ? 6 : 0));
        while (police.length < targetPolice && police.length < CONFIG.police.maxCount) spawnPolice(true);
        while (police.length > targetPolice && police.length > 0) scene.remove(police.pop().mesh);

        let near = false;
        for (const agent of police) {
            agent.cooldown = Math.max(0, agent.cooldown - dt);
            agent.closeCooldown = Math.max(0, agent.closeCooldown - dt);
            const dx = state.player.x - agent.x;
            const dz = state.player.z - agent.z;
            const dist = Math.sqrt(dx * dx + dz * dz);
            if (dist < 34) near = true;
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

            if (dist < CONFIG.police.searchDistance && state.wanted.level > 0) {
                agent.state = "chase";
                agent.lastX = state.player.x;
                agent.lastZ = state.player.z;
            } else if (agent.state === "chase") {
                agent.state = "search";
            }

            const flank = agent.role === "flank" ? (agent.side || 1) * 7 : 0;
            const intercept = agent.role === "intercept" ? Math.min(12, Math.abs(state.player.speed) * 0.7) : 0;
            const playerForwardX = Math.sin(state.player.rotation);
            const playerForwardZ = Math.cos(state.player.rotation);
            const playerSideX = Math.cos(state.player.rotation);
            const playerSideZ = -Math.sin(state.player.rotation);
            const targetX = (agent.state === "chase" ? state.player.x : agent.lastX) + playerForwardX * intercept + playerSideX * flank;
            const targetZ = (agent.state === "chase" ? state.player.z : agent.lastZ) + playerForwardZ * intercept + playerSideZ * flank;
            const targetAngle = Math.atan2(targetX - agent.x, targetZ - agent.z);
            let diff = targetAngle - agent.rotation;
            while (diff > Math.PI) diff -= Math.PI * 2;
            while (diff < -Math.PI) diff += Math.PI * 2;
            agent.rotation += Math.sign(diff) * Math.min(Math.abs(diff), (2.1 + state.wanted.level * 0.35) * dt);
            agent.targetSpeed = agent.state === "chase" ? 11 + state.wanted.level * 1.6 + (agent.heavy ? -1 : 1.2) : 8;
            agent.speed += (agent.targetSpeed - agent.speed) * dt * 2.4;

            const next = {
                x: agent.x + Math.sin(agent.rotation) * agent.speed * dt,
                z: agent.z + Math.cos(agent.rotation) * agent.speed * dt,
            };
            if (pushOutBuildings(world, next, 1.25) || obstacleAt(world, next.x, next.z, 1.15)) {
                agent.rotation += 1.6;
                agent.speed *= 0.55;
            }
            agent.x = clamp(next.x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            agent.z = clamp(next.z, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            agent.mesh.position.set(agent.x, 0.37, agent.z);
            agent.mesh.rotation.y = agent.rotation;

            if (distanceSq(state.player.x, state.player.z, agent.x, agent.z) < CONFIG.police.collisionRadius * CONFIG.police.collisionRadius && agent.cooldown <= 0) {
                agent.cooldown = 0.9;
                damagePlayer((Math.abs(agent.speed) + Math.abs(state.player.speed)) * 0.9);
                audio?.crash();
                state.player.speed *= 0.45;
                agent.speed *= 0.35;
                spawnParticle((state.player.x + agent.x) * 0.5, (state.player.z + agent.z) * 0.5, "#ff5a4c", 20);
            }
        }

        if (state.wanted.level > 0 && !near) {
            state.wanted.decay += dt;
            if (state.wanted.decay > CONFIG.police.decayDelay) {
                state.wanted.decay = 0;
                updateWanted(state.wanted.level - 1);
            }
        } else {
            state.wanted.decay = 0;
        }

        state.wanted.status = state.wanted.level <= 0 ? "CLEAR" : near ? "CHASE" : "SEARCH";
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
                damagePlayer(10 + Math.abs(state.player.speed) * 0.65);
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
            else spawnRoadblock();
            state.roadblockCooldown = Math.max(3.5, CONFIG.police.roadblockCooldown - state.wanted.level * 0.55);
        }
    }

    function updateHazards(dt) {
        for (let index = hazards.length - 1; index >= 0; index -= 1) {
            const hazard = hazards[index];
            hazard.life -= dt;
            hazard.mesh.material.opacity = Math.max(0.18, hazard.life / hazard.maxLife);
            if (distanceSq(state.player.x, state.player.z, hazard.x, hazard.z) < (hazard.radius + CONFIG.player.radius) ** 2) {
                damagePlayer(7 + Math.abs(state.player.speed) * 0.45);
                state.player.speed *= 0.28;
                state.player.nitro = Math.max(0, state.player.nitro - 32);
                spawnParticle(hazard.x, hazard.z, "#f7fbff", 18);
                setStatus("Spike-Strip erwischt. Reifen verlieren Grip.", 1.8);
                scene.remove(hazard.mesh);
                hazards.splice(index, 1);
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
        state.helicopter.pressure = clamp(state.helicopter.pressure + (inCone ? dt * 0.28 : -dt * 0.18), 0, 1);
        state.helicopter.cooldown = Math.max(0, state.helicopter.cooldown - dt);
        if (state.helicopter.pressure >= 1 && state.helicopter.cooldown <= 0) {
            state.helicopter.cooldown = 3.4;
            state.helicopter.pressure = 0.38;
            damagePlayer(9);
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

        if (nearGarage) {
            state.actionPrompt = "E Garage oeffnen";
            if (input.consume("e")) openGarage();
        }

        if (nearGarage && state.garageCooldown <= 0) {
            if (state.player.health < getMaxHealth() || state.player.nitro < getNitroMax() - 4) {
                state.player.health = Math.min(getMaxHealth(), state.player.health + 18);
                state.player.nitro = Math.min(getNitroMax(), state.player.nitro + 20);
                state.garageCooldown = 3.5;
                setStatus("Garage: Reparatur und Nitro aufgefuellt.", 2);
            }
        }
        if (nearSafehouse && state.wanted.level > 0) {
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

    function updateDistrict() {
        const nextDistrict = getDistrictAt(state.player.x, state.player.z);
        if (nextDistrict.id !== state.district.id) {
            state.district = nextDistrict;
            setStatus(`${nextDistrict.name}: Bezirksbonus ${nextDistrict.bonus}.`, 1.7);
        }
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

        if (state.weather.mode === "rain") {
            for (let i = 0; i < 3; i += 1) {
                spawnRainDrop(
                    state.player.x + (Math.random() - 0.5) * 54,
                    state.player.z + (Math.random() - 0.5) * 54
                );
            }
        }
        updateRain(dt);
    }

    function updateWorldEvents(dt) {
        state.worldEvent.timer -= dt;
        if (!state.worldEvent.active && state.worldEvent.timer <= 0) spawnWorldEvent();

        for (let index = eventPickups.length - 1; index >= 0; index -= 1) {
            const event = eventPickups[index];
            event.life -= dt;
            event.mesh.rotation.y += dt * 1.8;
            event.mesh.position.y = 1.4 + Math.sin(event.life * 3) * 0.18;
            state.worldEvent.timer = Math.max(0, event.life);
            if (distanceSq(state.player.x, state.player.z, event.x, event.z) < 13) {
                addScore(event.score, true);
                addCash(event.cash || 0);
                if (event.heal) state.player.health = Math.min(getMaxHealth(), state.player.health + event.heal);
                updateWanted(state.wanted.level + event.heat);
                state.stats.events += 1;
                state.lifetime.events += 1;
                refreshProgress();
                spawnParticle(event.x, event.z, event.color, 34);
                setStatus(`${event.label} gesichert. Bank +$${event.cash || 0}.`, 2.5);
                scene.remove(event.mesh);
                eventPickups.splice(index, 1);
                state.worldEvent.active = false;
                state.worldEvent.label = "Ruhige Strassen";
                state.worldEvent.timer = 22 + Math.random() * 24;
                audio?.mission();
            } else if (event.life <= 0) {
                scene.remove(event.mesh);
                eventPickups.splice(index, 1);
                state.worldEvent.active = false;
                state.worldEvent.label = "Ruhige Strassen";
                state.worldEvent.timer = 18 + Math.random() * 28;
                setStatus("Event verpasst. Dispatch ist weitergezogen.", 1.6);
            }
        }
    }

    function updateCamera(dt) {
        const player = state.player;
        const forwardX = Math.sin(player.rotation);
        const forwardZ = Math.cos(player.rotation);
        const speedLift = Math.min(6, Math.abs(player.speed) * 0.18);
        tempTarget.set(
            player.x - forwardX * CONFIG.camera.backOffset,
            CONFIG.camera.height + speedLift,
            player.z - forwardZ * CONFIG.camera.backOffset
        );
        camera.position.lerp(tempTarget, Math.min(1, dt * CONFIG.camera.followLerp));
        if (state.cameraShake > 0) {
            state.cameraShake = Math.max(0, state.cameraShake - dt * 2.8);
            camera.position.x += (Math.random() - 0.5) * state.cameraShake;
            camera.position.z += (Math.random() - 0.5) * state.cameraShake;
        }
        camera.lookAt(player.x + forwardX * Math.abs(player.speed) * 0.2, 0, player.z + forwardZ * Math.abs(player.speed) * 0.2);
    }

    function spawnPickup() {
        const roll = Math.random();
        const type = roll < 0.44 ? "cash" : roll < 0.6 ? "repair" : roll < 0.76 ? "nitro" : roll < 0.88 ? "intel" : roll < 0.96 ? "parts" : "emp";
        let x = 0;
        let z = 0;
        for (let tries = 0; tries < 30; tries += 1) {
            x = snapStreet((Math.random() - 0.5) * CONFIG.map.size * 0.92);
            z = snapStreet((Math.random() - 0.5) * CONFIG.map.size * 0.92);
            if (!insideBuilding(world, x, z, 1.5)) break;
        }
        const info = PICKUP_TYPES[type];
        const mesh = new THREE.Mesh(pickupGeo, createMaterial(info.color, {
            roughness: 0.14,
            metalness: 0.78,
            emissive: info.color,
            emissiveIntensity: 0.55,
        }));
        mesh.position.set(x, 1.35, z);
        mesh.castShadow = true;
        scene.add(mesh);
        pickups.push({ mesh, type, x, z, baseY: 1.35, spin: 1.6 + Math.random() * 2.8, t: Math.random() * 10 });
    }

    function spawnWorldEvent() {
        if (eventPickups.length > 0) return;
        const event = WORLD_EVENTS[Math.floor(Math.random() * WORLD_EVENTS.length)];
        const poi = POIS[Math.floor(Math.random() * POIS.length)];
        const x = snapStreet(poi.x + (Math.random() - 0.5) * 18);
        const z = snapStreet(poi.z + (Math.random() - 0.5) * 18);
        const mesh = new THREE.Mesh(eventGeo, createMaterial(event.color, {
            roughness: 0.18,
            metalness: 0.7,
            emissive: event.color,
            emissiveIntensity: 0.55,
        }));
        mesh.position.set(x, 1.4, z);
        mesh.castShadow = true;
        scene.add(mesh);
        eventPickups.push({ mesh, ...event, x, z, life: 38 });
        state.worldEvent.active = true;
        state.worldEvent.label = event.label;
        state.worldEvent.timer = 38;
        state.worldEvent.x = x;
        state.worldEvent.z = z;
        setStatus(`Event entdeckt: ${event.label}.`, 2);
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
        scene.add(mesh);
        const baseSpeed = district.id === "park" ? 3.1 : district.id === "harbor" ? 3.8 : district.id === "industrial" ? 4.2 : 5.1;
        traffic.push({ mesh, x, z, axis, direction, speed: baseSpeed + Math.random() * 3.2, model, cooldown: 0, districtId: district.id });
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
            return Math.random() < 0.55 ? CAR_MODELS[3] : CAR_MODELS[1];
        }
        if (district.id === "harbor") {
            return Math.random() < 0.5
                ? { ...CAR_MODELS[3], color: "#6f8ea5", trim: "#1a2128", name: "Dock Van" }
                : { ...CAR_MODELS[0], color: "#4d6e84", trim: "#162129", name: "Dock Runner" };
        }
        return Math.random() < 0.7
            ? { ...CAR_MODELS[0], color: "#7dcf82", trim: "#1d2a1e", name: "Park Shuttle" }
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

    function spawnPolice(near = true) {
        if (police.length >= CONFIG.police.maxCount) return;
        const heavy = state.wanted.level >= 4 && Math.random() < 0.45;
        const model = heavy
            ? { ...CAR_MODELS[1], color: "#e9eef4", trim: "#182a46", maxSpeed: 17, acceleration: 22, turn: 3.05 }
            : { ...CAR_MODELS[0], color: "#f4f7fb", trim: "#1c4274", maxSpeed: 19, acceleration: 24, turn: 3.45 };
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
            role: state.wanted.level >= 3 ? ["chase", "flank", "intercept"][Math.floor(Math.random() * 3)] : "chase",
            side: Math.random() < 0.5 ? -1 : 1,
            heavy,
            cooldown: 0,
            closeCooldown: 0,
        });
    }

    function spawnRoadblock() {
        const forwardX = Math.sin(state.player.rotation);
        const forwardZ = Math.cos(state.player.rotation);
        const dist = 28 + Math.random() * 22;
        const axis = Math.abs(forwardX) > Math.abs(forwardZ) ? "x" : "z";
        let x = state.player.x + forwardX * dist;
        let z = state.player.z + forwardZ * dist;
        if (axis === "x") z = snapStreet(z);
        else x = snapStreet(x);
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
        });
        setStatus("Dispatch: Roadblock voraus.", 1.7);
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
        state.cameraShake = Math.max(state.cameraShake, 0.36);
        spawnParticle(x, z, "#f7fbff", 42);
        setStatus(`EMP gezuendet. ${disabled} Einheiten deaktiviert.`, 2);
    }

    function addSkidMark() {
        if (skidMarks.length > 80) {
            const old = skidMarks.shift();
            scene.remove(old.mesh);
        }
        const mark = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.018, 1.5),
            createMaterial("#060708", { roughness: 1, transparent: true, opacity: 0.38 })
        );
        mark.position.set(state.player.x - Math.sin(state.player.rotation) * 1.6, 0.13, state.player.z - Math.cos(state.player.rotation) * 1.6);
        mark.rotation.y = state.player.rotation;
        scene.add(mark);
        skidMarks.push({ mesh: mark, life: 5 });
    }

    function updateSkidMarks(dt) {
        for (let index = skidMarks.length - 1; index >= 0; index -= 1) {
            skidMarks[index].life -= dt;
            skidMarks[index].mesh.material.opacity = Math.max(0, skidMarks[index].life / 5) * 0.38;
            if (skidMarks[index].life <= 0) {
                scene.remove(skidMarks[index].mesh);
                skidMarks.splice(index, 1);
            }
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
            particle.vy -= 12 * dt;
            particle.mesh.position.x += particle.vx * dt;
            particle.mesh.position.y += particle.vy * dt;
            particle.mesh.position.z += particle.vz * dt;
            particle.mesh.scale.setScalar(1 - particle.age / particle.life);
            particle.mesh.material.opacity = 1 - particle.age / particle.life;
        }
    }

    function damagePlayer(amount) {
        if (!state.running) return;
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
        state.cash += amount;
        persistProfile();
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

    function chooseRoute(stage, count) {
        const route = [];
        for (let offset = 0; route.length < count && offset < POIS.length; offset += 1) {
            route.push(POIS[(stage + offset) % POIS.length]);
        }
        return route;
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
        spawnParticle(obstacle.x, obstacle.z, obstacle.color ?? "#ffc64d", 14);
        setStatus(`${obstacle.label ?? "Prop"} zerlegt. +${reward} Score.`, 1.4);
    }

    function applyWeatherVisuals() {
        const weather = WEATHER_MODES[state.weather.mode] ?? WEATHER_MODES.clear;
        const color = new THREE.Color(weather.color);
        scene.background = color;
        if (scene.fog) {
            scene.fog.color.copy(color);
            scene.fog.near = state.weather.mode === "fog" ? 24 : 48;
            scene.fog.far = state.weather.mode === "fog" ? 92 : 130;
        }
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
