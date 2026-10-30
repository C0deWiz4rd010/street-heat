import { BOSS_MISSIONS, MISSION_CHAINS, MISSION_MODIFIERS, resolveMission } from "../data/missions.js";
import { CAR_MODELS, CONFIG, DISTRICTS, POIS } from "../config.js";
import { axisYaw, clamp, distanceSq } from "../util/math.js";
import { createCar } from "../vehicles.js";
import { REPUTATION_GAINS } from "../config.js";

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

const MISSION_DISTRICT_ORDER = ["downtown", "industrial", "park", "harbor"];

/** Missions: chain selection from data, modifiers, bonus goals, cash-out, boss encounters and the fail/retry flow. */
export function createMissionSystem({
    state,
    updateWanted,
    audio,
    spawnPopup,
    setStatus,
    spendCash,
    distanceTo,
    addScore,
    addCash,
    getNitroMax,
    addReputation,
    refreshProgress,
    getPoi,
    pickups,
    sampleDistrictSpawnPosition,
    createPickupAt,
    getDistrictTrafficStreets,
    getDistrictTrafficPosition,
    sharedMaterials,
    addAmbientHeadlights,
    scene,
    createRoadblockMesh,
    roadblocks,
    spawnParticle,
    removeMesh,
}) {
    let missionBoss = null;

    function set(stage, options = {}) {
        clearBoss();
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

    function failMission() {
        const mission = state.mission;
        mission.failed = true;
        mission.failTimer = 8;
        mission.failCost = Math.round(60 + mission.stage * 12);
        clearBoss();
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
        set(mission.stage, { keepModifier: state.modifiers.id ?? null });
        setStatus("Neuer Versuch. Gleiche Mission, gleiche Regeln.", 2);
    }

    function update(dt) {
        if (state.mission.failed) {
            state.mission.failTimer -= dt;
            if (state.mission.failTimer <= 0 && state.running) {
                setStatus("Mission übersprungen. Nächster Auftrag.", 2);
                set(state.mission.stage + 1);
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
                if (state.mission.progress >= state.mission.target) complete();
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

    function complete() {
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
        set(state.mission.stage + 1);
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
            mesh.rotation.y = axisYaw(axis, direction);
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

    function clearBoss() {
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

    function interact(input) {
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
                complete();
                return;
            }
        }

        if (state.mission.turnInReady && !inZone && dist > CONFIG.map.poiRadius * 2.1 && state.mission.riskLevel < state.mission.maxRiskLevel) {
            pushMissionCashout();
        }
    }

    function getMissionNavigationTarget() {
        if (state.mission.type === "checkpoint") return state.mission.route[state.mission.routeIndex] ?? state.mission.to;
        return state.mission.to ?? state.mission.from ?? null;
    }

    return { set, update, complete, interact, clearBoss, retry: retryMission, getNavigationTarget: getMissionNavigationTarget, currentTurnInTarget: currentMissionTurnInTarget, getDistrictWaypointRoute };
}
