import assert from "node:assert/strict";

const storage = new Map();
globalThis.window = {
    localStorage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
    },
};

const { ACHIEVEMENTS, CAR_MODELS, CONTRACTS, DISTRICTS, HEAT_TIERS, PICKUP_TYPES, UPGRADES, WEATHER_MODES, WORLD_EVENTS } = await import("../src/config.js");
const { createDefaultProfile, loadProfile, saveProfile, clearProfile } = await import("../src/save.js");
const { createInitialState } = await import("../src/state.js");

assert.equal(new Set(CAR_MODELS.map((car) => car.id)).size, CAR_MODELS.length, "car ids must be unique");
assert.equal(new Set(DISTRICTS.map((district) => district.id)).size, DISTRICTS.length, "district ids must be unique");
assert.ok(DISTRICTS.every((district) => district.traffic > 0), "district traffic weights must stay positive");
assert.ok(DISTRICTS.every((district) => district.cashMultiplier > 0), "district cash multipliers must stay positive");
assert.ok(DISTRICTS.every((district) => district.eventRate > 0), "district event rates must stay positive");
assert.ok(DISTRICTS.every((district) => district.pickupWeights && district.eventWeights), "district effect tables must be configured");
assert.ok(DISTRICTS.every((district) => Object.keys(district.eventWeights).length >= 6), "districts should support the expanded event pool");
assert.equal(HEAT_TIERS.length, 6, "heat tiers should cover levels 0-5");
assert.ok(Object.values(WEATHER_MODES).every((weather) => weather.grip > 0 && weather.grip <= 1), "weather grip values must be usable");
assert.ok(WEATHER_MODES.storm, "storm weather mode must exist");
assert.ok(WORLD_EVENTS.every((event) => event.score > 0), "world events need score rewards");
assert.ok(WORLD_EVENTS.some((event) => event.id === "vipConvoy" && event.kind === "convoy"), "vip convoy event must exist");
assert.ok(WORLD_EVENTS.some((event) => event.id === "streetRace" && event.kind === "race"), "street race event must exist");
assert.ok(WORLD_EVENTS.some((event) => event.id === "roadClosure" && event.kind === "closure"), "road closure event must exist");
assert.ok(WORLD_EVENTS.some((event) => event.id === "hiddenCache" && event.kind === "stash"), "hidden cache event must exist");
assert.ok(CONTRACTS.every((contract) => contract.target > 0 && contract.reward > 0), "contracts need targets and rewards");
assert.ok(ACHIEVEMENTS.every((achievement) => achievement.target > 0 && achievement.reward > 0), "achievements need targets and rewards");
assert.equal(PICKUP_TYPES.emp.emp, true, "EMP pickup must be configured");

const fresh = createDefaultProfile(CAR_MODELS, UPGRADES);
fresh.cash = 1234;
fresh.unlockedCars.push(CAR_MODELS[1].id);
fresh.selectedCarId = CAR_MODELS[1].id;
fresh.upgrades.engine = 2;
fresh.achievements.push("firstMission");
fresh.lifetime.pickups = 9;
saveProfile(fresh);
const loaded = loadProfile(CAR_MODELS, UPGRADES);
assert.equal(loaded.cash, 1234);
assert.equal(loaded.selectedCarId, CAR_MODELS[1].id);
assert.equal(loaded.upgrades.engine, 2);
assert.equal(loaded.achievements.includes("firstMission"), true);
assert.equal(loaded.lifetime.pickups, 9);

const state = createInitialState();
assert.equal(state.cash, 1234);
assert.equal(state.playerModelIndex, 1);
assert.equal(state.upgrades.engine, 2);
assert.equal(state.achievements.includes("firstMission"), true);
assert.equal(state.lifetime.pickups, 9);
assert.equal(state.time.phase, "day");
assert.equal(state.player.inShortcut, false);
assert.equal(typeof state.mission.bonus.id, "string");
assert.equal(state.mission.cashoutMultiplier, 1);
assert.equal(state.mission.isBoss, false);

// --- Vehicle physics: a headless test course per car ---------------------------------------
const { applyEngine, applyGrip, applySpeedFactor, applySteering, cancelNormalVelocity, deriveSpec, surfaceAt, updateDrift } = await import("../src/physics/vehicle.js");
const { SURFACES } = await import("../src/config.js");

function drive(model, ctl, seconds, start = {}, surface = SURFACES.road) {
    const p = { x: 0, z: 0, rotation: 0, vx: 0, vz: 0, speed: 0, speedMag: 0, drift: 0, gripBlend: 0, ...start };
    const spec = deriveSpec(model, { upgrades: {}, weatherGrip: 1, surface });
    const dt = 1 / 60;
    let peakDrift = 0;
    for (let i = 0; i < seconds * 60; i += 1) {
        const fx = Math.sin(p.rotation);
        const fz = Math.cos(p.rotation);
        let fwd = p.vx * fx + p.vz * fz;
        let lat = p.vx * Math.cos(p.rotation) - p.vz * Math.sin(p.rotation);
        const ratio = Math.min(1, Math.abs(fwd) / spec.maxSpeed);
        fwd = applyEngine(fwd, ctl, spec, spec.maxSpeed, dt);
        p.speed = fwd;
        updateDrift(p, fwd, lat, ctl, spec, ratio, dt);
        applySteering(p, fwd, ctl, spec, spec.maxSpeed, dt);
        lat = applyGrip(lat, p, ctl, spec, dt);
        const nfx = Math.sin(p.rotation);
        const nfz = Math.cos(p.rotation);
        p.vx = nfx * fwd + Math.cos(p.rotation) * lat;
        p.vz = nfz * fwd - Math.sin(p.rotation) * lat;
        p.speed = fwd;
        p.speedMag = Math.hypot(p.vx, p.vz);
        p.x += p.vx * dt;
        p.z += p.vz * dt;
        peakDrift = Math.max(peakDrift, p.drift);
    }
    return { p, spec, peakDrift };
}

for (const model of CAR_MODELS) {
    const none = { forward: false, reverse: false, handbrake: false, turn: 0 };
    const full = drive(model, { ...none, forward: true }, 8);
    assert.ok(full.p.speed > model.maxSpeed * 0.8, `${model.id} should reach 80% top speed in 8 s (got ${full.p.speed.toFixed(1)})`);
    assert.ok(full.p.speed <= full.spec.maxSpeed + 0.01, `${model.id} must not exceed its top speed`);

    const braked = drive(model, { ...none, reverse: true }, 5, { vz: full.p.speed, speed: full.p.speed, speedMag: full.p.speed });
    assert.ok(braked.p.speed < 0.5, `${model.id} should stop (or start reversing) within 5 s of braking, got ${braked.p.speed.toFixed(1)}`);

    const turned = drive(model, { ...none, forward: true, turn: 1 }, 2, { vz: 10, speed: 10, speedMag: 10 });
    assert.ok(turned.p.rotation > 0.3, `${model.id} should yaw left when steering left`);

    const slide = drive(model, { ...none, forward: true, handbrake: true, turn: 1 }, 2, { vz: model.maxSpeed, speed: model.maxSpeed, speedMag: model.maxSpeed });
    assert.ok(slide.peakDrift > 0.3, `${model.id} should drift with handbrake at speed`);
}

const needle = CAR_MODELS.find((car) => car.id === "needle");
const mule = CAR_MODELS.find((car) => car.id === "mule");
const noCtl = { forward: true, reverse: false, handbrake: false, turn: 0 };
assert.ok(drive(needle, noCtl, 4).p.speed > drive(mule, noCtl, 4).p.speed, "needle must accelerate harder than mule");
const grassRun = drive(CAR_MODELS[0], noCtl, 8, {}, SURFACES.grass);
const roadRun = drive(CAR_MODELS[0], noCtl, 8);
assert.ok(grassRun.p.speed < roadRun.p.speed * 0.85, "grass must slow the car down");

const hit = { vx: 10, vz: 10, speed: 14, speedMag: 14 };
applySpeedFactor(hit, 0.5);
assert.equal(hit.vx, 5, "speed factor must scale velocity");
assert.equal(hit.speedMag, 7);
const edge = { vx: -4, vz: 6 };
cancelNormalVelocity(edge, 1, 0);
assert.deepEqual([edge.vx, edge.vz], [0, 6], "edge only removes the normal component");
assert.equal(surfaceAt(0, 10, "park", false).id, "road");
assert.equal(surfaceAt(13, 13, "park", false).id, "grass");

// --- Police AI: street graph, A* and line of sight -----------------------------------------
const { buildRoadGraph, findPath, hasLineOfSight, nearestNode, nextWaypoint } = await import("../src/ai/police.js");
const { buildGrid } = await import("../src/world.js");
const { POLICE_UNITS } = await import("../src/config.js");
assert.ok(["patrol", "suv", "van", "motorcycle"].every((id) => POLICE_UNITS[id]?.chaseSpeed > 0), "police units must be configured");

const graph = buildRoadGraph();
assert.equal(graph.nodes.length, 25, "5x5 street crossings");
const corner = nearestNode(graph, -60, -60);
const farCorner = nearestNode(graph, 60, 60);
const route = findPath(graph, corner, farCorner);
assert.equal(route.length, 9, "corner-to-corner route follows the grid (8 hops)");
assert.equal(route[0], corner);
assert.equal(route.at(-1), farCorner);
const wp = nextWaypoint(graph, -52, -52, 52, 52);
assert.ok(wp.x === -26 || wp.z === -26, "next waypoint is an adjacent crossing");

const wallWorld = { buildings: [{ x: 0, z: 0, hw: 4, hd: 4, h: 10 }], obstacles: [] };
wallWorld.grid = { buildings: buildGrid(wallWorld.buildings, 6), obstacles: buildGrid([], 8) };
assert.equal(hasLineOfSight(wallWorld, -20, 0, 20, 0), false, "a building blocks the view");
assert.equal(hasLineOfSight(wallWorld, -20, 12, 20, 12), true, "open street keeps the view");

// --- Missions: declarative data resolves for every district and stage -----------------------
const { BOSS_MISSIONS, MISSION_CHAINS, MISSION_MODIFIERS, resolveMission } = await import("../src/data/missions.js");
const missionHelpers = {
    getPoi: (id) => ({ name: id, x: 1, z: 2 }),
    anchor: () => ({ name: "Zone", x: 3, z: 4 }),
    route: (count) => Array.from({ length: count }, (_, i) => ({ name: `wp${i}`, x: i, z: i })),
};
assert.deepEqual(Object.keys(MISSION_CHAINS).sort(), DISTRICTS.map((district) => district.id).sort(), "every district needs a mission chain");
for (const [districtId, chain] of Object.entries(MISSION_CHAINS)) {
    assert.equal(chain.length, 3, `${districtId} chain has three steps`);
    for (let stage = 1; stage <= 24; stage += 1) {
        const config = resolveMission(chain[(stage - 1) % 3], stage, missionHelpers);
        assert.ok(config.target > 0 && config.timer > 0, `${districtId} stage ${stage} needs target and timer`);
        assert.ok(config.type === "pursuit" || config.to || config.route?.length === config.target, `${districtId} stage ${stage} needs a destination`);
    }
}
assert.equal(resolveMission(MISSION_CHAINS.downtown[1], 1, missionHelpers).target, 3);
assert.equal(resolveMission(MISSION_CHAINS.downtown[1], 19, missionHelpers).target, 5, "target scaling is capped");
assert.equal(resolveMission(MISSION_CHAINS.downtown[0], 4, missionHelpers).timer, 54, "timer grows per stage block");
assert.equal(BOSS_MISSIONS.length, 3);
assert.ok(BOSS_MISSIONS.every((boss) => boss.isBoss && boss.bossType && boss.districtId));
assert.ok(MISSION_MODIFIERS.every((modifier) => modifier.reward > 1), "modifiers must pay a bonus");

// --- Progression: reputation tiers, graffiti tags, persistence ------------------------------
const { generateTags, reputationTier } = await import("../src/progression.js");
const { REPUTATION_TIERS, RACE, TAGS_PER_DISTRICT } = await import("../src/config.js");
assert.equal(reputationTier(0).index, 0);
assert.equal(reputationTier(REPUTATION_TIERS[2].at).index, 2);
assert.equal(reputationTier(99999).next, null, "top tier has no next tier");
assert.ok(REPUTATION_TIERS.every((tier, i) => i === 0 || tier.at > REPUTATION_TIERS[i - 1].at), "tiers must ascend");
assert.equal(RACE.payouts.length, RACE.rivals + 1, "one payout per finishing place");

const fakeBuildings = [];
for (const bx of [-39, -13, 13, 39]) for (const bz of [-39, -13, 13, 39]) {
    fakeBuildings.push({ x: bx - 4, z: bz - 4, hw: 4, hd: 4, h: 8 + ((bx + bz) % 9 + 9) % 9 });
    fakeBuildings.push({ x: bx + 4, z: bz + 4, hw: 4, hd: 4, h: 20 });
}
const districtOfPoint = (x, z) => DISTRICTS.find((d) => d.x === (x < 0 ? -1 : 1) && d.z === (z < 0 ? -1 : 1)).id;
const tagList = generateTags({ buildings: fakeBuildings, districtIds: DISTRICTS.map((d) => d.id), districtIdOf: districtOfPoint });
assert.equal(tagList.length, DISTRICTS.length * TAGS_PER_DISTRICT, "ten tags per district");
assert.equal(new Set(tagList.map((t) => t.id)).size, tagList.length, "tag ids are unique");
assert.ok(tagList.every((t) => districtOfPoint(t.x, t.z) === t.districtId), "tags lie in their own district");
assert.deepEqual(tagList, generateTags({ buildings: fakeBuildings, districtIds: DISTRICTS.map((d) => d.id), districtIdOf: districtOfPoint }), "tags are deterministic");

const progress = createDefaultProfile(CAR_MODELS, UPGRADES);
progress.reputation.park = 250;
progress.tags = ["park-1", "park-2"];
progress.unlocks = ["Lackfarbe Neon-Pink"];
progress.contract = { id: "chaosDriver", progress: 5, claimed: false };
saveProfile(progress);
const reloaded = loadProfile(CAR_MODELS, UPGRADES);
assert.equal(reloaded.reputation.park, 250);
assert.deepEqual(reloaded.tags, ["park-1", "park-2"]);
assert.deepEqual(reloaded.contract, { id: "chaosDriver", progress: 5, claimed: false }, "contract progress survives a reload");
assert.equal(createInitialState(CAR_MODELS, UPGRADES, reloaded).contract.progress, 5);

// --- Settings and onboarding ---------------------------------------------------------------
const { SETTINGS_DEFAULTS, createSettings, normalizeSettings } = await import("../src/settings.js");
const { ONBOARDING_STEPS, createOnboarding } = await import("../src/onboarding.js");
const junk = normalizeSettings({ master: 9, music: "abc", sfx: -1, quality: "ultra", cameraMode: "far", shake: 7, muted: "yes" });
assert.equal(junk.master, 1, "volume is clamped");
assert.equal(junk.music, SETTINGS_DEFAULTS.music, "garbage falls back to the default");
assert.equal(junk.sfx, 0);
assert.equal(junk.quality, "medium");
assert.equal(junk.cameraMode, "far");
assert.equal(junk.shake, 1.5);
assert.equal(junk.muted, false, "only a real boolean mutes");
assert.equal(normalizeSettings({}, true).reducedMotion, true, "prefers-reduced-motion is the default");
assert.equal(normalizeSettings({ reducedMotion: false }, true).reducedMotion, false, "an explicit choice wins");

const settingsStore = new Map();
const changes = [];
const settingsA = createSettings({ storage: { getItem: (k) => settingsStore.get(k) ?? null, setItem: (k, v) => settingsStore.set(k, v) }, onChange: (key) => changes.push(key) });
settingsA.set("quality", "high");
settingsA.set("muted", true);
settingsA.set("quality", "nonsense");
assert.equal(settingsA.values.quality, "medium", "invalid values are rejected");
settingsA.set("music", 0.3);
const settingsB = createSettings({ storage: { getItem: (k) => settingsStore.get(k) ?? null, setItem: () => {} } });
assert.equal(settingsB.values.muted, true, "mute persists");
assert.equal(settingsB.values.music, 0.3, "settings persist under their own key");
assert.deepEqual(changes.slice(0, 2), ["quality", "muted"]);

const tipState = { screen: "playing", paused: false, running: true, player: { speed: 0, drift: 0, nitroActive: false }, wanted: { level: 0 }, stats: { missions: 0 } };
let finished = false;
const tour = createOnboarding({ onComplete: () => { finished = true; } });
assert.equal(tour.update(tipState, 0.1), ONBOARDING_STEPS[0].text);
tipState.player.speed = 10;
assert.equal(tour.update(tipState, 1), ONBOARDING_STEPS[0].text, "a step stays visible for a minimum time");
assert.equal(tour.update(tipState, 3), ONBOARDING_STEPS[1].text, "then advances once the action is done");
tipState.paused = true;
assert.equal(tour.update(tipState, 500), ONBOARDING_STEPS[1].text, "paused time does not count");
tipState.paused = false;
for (let i = 0; i < 30; i += 1) tour.update(tipState, 20);
assert.equal(tour.active, false, "all steps time out eventually");
assert.equal(finished, true);
assert.equal(createOnboarding({ isDone: () => true }).update(tipState, 1), "", "finished tutorial stays hidden");

// --- Wall response, paints, economy ---------------------------------------------------------
const { glancingWallImpact, headOnDamp } = await import("../src/physics/vehicle.js");
const { PAINTS } = await import("../src/config.js");
const { economyTable, estimateRunCash } = await import("../src/economy.js");
const slider = { vx: 10, vz: 6 };
const slideSignal = glancingWallImpact(slider, -1, 0, Math.hypot(10, 6), 0.5, 1, 1 / 60);
assert.ok(slider.vx <= 0.01, "the velocity component into the wall is removed (bounce is at most tiny)");
assert.ok(slider.vz > 5 && slider.vz < 6, "tangential speed survives with slight friction");
assert.ok(slideSignal > 0 && slideSignal <= 1, "sliding produces an audio signal");
assert.equal(glancingWallImpact({ vx: -5, vz: 0 }, -1, 0, 5, 0.3, 1, 1 / 60), 0, "moving away from the wall does nothing");
const crash = { vx: 12, vz: 0 };
headOnDamp(crash, 1.9);
assert.ok(crash.vx < 6.5, "head-on hits shed most of the speed");

assert.equal(PAINTS[0].id, "default");
assert.equal(new Set(PAINTS.map((paint) => paint.id)).size, PAINTS.length, "paint ids are unique");
assert.ok(PAINTS.filter((paint) => paint.unlock).every((paint) => REPUTATION_TIERS.some((tier) => tier.unlock === paint.unlock)), "every locked paint is a reputation reward");

const economy = economyTable();
assert.ok(economy.perRun > 500, "a run pays something");
assert.ok(estimateRunCash({ missions: 6 }) > estimateRunCash({ missions: 3 }), "more missions pay more");
assert.ok(economy.rows.every((row) => row.price > 0 && Number.isFinite(row.runs)));
assert.ok(economy.rows.filter((row) => row.item.startsWith("Auto")).every((row) => row.runs >= 2.5 && row.runs <= 5.5), "a new car should cost roughly 3-5 typical runs");
console.log(`economy: ~$${economy.perRun}/run -> ` + economy.rows.filter((row) => row.item.startsWith("Auto")).map((row) => `${row.item} ${row.runs.toFixed(1)} Runs`).join(", "));

// --- Music data ----------------------------------------------------------------------------
const music = await import("../src/music.js");
assert.ok(music.semitoneHz(0) === 55 && Math.abs(music.semitoneHz(0, 1) - 110) < 1e-9, "octaves double the frequency");
assert.ok(music.stepSeconds("menu") > music.stepSeconds("game"), "the menu track is slower");
const calm = music.layerGains(0), warm = music.layerGains(2), hot = music.layerGains(4);
assert.ok(calm.kick === 0 && calm.lead === 0 && calm.pad > 0, "heat 0 is calm: only pad and a soft bass");
assert.ok(warm.kick > 0 && warm.snare === 0 && warm.lead === 0, "drums come in at heat 2");
assert.ok(hot.kick > 0 && hot.snare > 0 && hot.lead > 0, "lead joins at heat 4");
for (let h = 1; h <= 5; h += 1) {
    const now = music.layerGains(h), before = music.layerGains(h - 1);
    assert.ok(Object.keys(now).every((k) => now[k] >= before[k]), "layers only get louder with heat");
}
assert.equal(music.layerGains(5, "menu").kick, 0, "the menu track has no drums");
assert.equal(music.musicModeFor("playing"), "game");
assert.equal(music.musicModeFor("garage"), "menu");
assert.equal(music.musicModeFor("gameover"), "off");
assert.notEqual(music.chordRoot(0, "downtown"), music.chordRoot(0, "harbor"), "each district has its own key");
assert.equal(music.chordRoot(4, "park"), music.chordRoot(0, "park"), "the progression loops every four bars");
assert.ok([music.BASS_STEPS, music.KICK_STEPS, music.SNARE_STEPS, music.HAT_STEPS].every((p) => p.length === music.STEPS_PER_BAR), "patterns span one bar");

// --- Siren: pattern choice and loudness (the synthesis itself is verified by an offline render) ---
const { SIREN_MODES, sirenLevelFor, sirenModeFor } = await import("../src/siren.js");
assert.equal(sirenModeFor(0, 10), null, "no heat, no siren");
assert.equal(sirenModeFor(2, 400), null, "too far to hear");
assert.equal(sirenModeFor(1, 40), "wail");
assert.equal(sirenModeFor(3, 40), "hilo");
assert.equal(sirenModeFor(5, 12), "yelp", "yelp only when a cop is right behind you at max heat");
assert.equal(sirenModeFor(5, 80), "hilo");
assert.ok(sirenLevelFor(3, 10, "hilo") > sirenLevelFor(3, 90, "hilo"), "closer is louder");
assert.ok(sirenLevelFor(5, 5, "yelp") <= 1 && sirenLevelFor(1, 5, "wail") < sirenLevelFor(5, 5, "wail"), "level is bounded and grows with heat");
assert.equal(sirenLevelFor(3, 10, null), 0);
assert.ok(Object.values(SIREN_MODES).every((m) => m.base - m.depth > 300 && m.base + m.depth < 1400), "all notes stay in a pleasant horn range");

clearProfile();
assert.equal(loadProfile(CAR_MODELS, UPGRADES).cash, 0);

console.log("logic smoke ok");
