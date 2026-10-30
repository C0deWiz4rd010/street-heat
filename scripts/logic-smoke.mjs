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
const { PAINT_JOBS, FINISHES, LIVERIES, LOOK_GROUPS, DEFAULT_LOOK, normalizeLook, resolveLook, isUnlocked } = await import("../src/data/looks.js");
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

assert.equal(PAINT_JOBS[0].id, "default");
for (const group of LOOK_GROUPS) {
    assert.equal(new Set(group.options.map((option) => option.id)).size, group.options.length, `${group.key} ids are unique`);
    assert.ok(!group.options[0].unlock, `${group.key}: the first option is free`);
    assert.ok(group.options.some((option) => option.id === DEFAULT_LOOK[group.key]), `${group.key}: the default exists`);
    assert.ok(group.options.filter((option) => option.unlock).every((option) => REPUTATION_TIERS.some((tier) => tier.unlock === option.unlock)), `${group.key}: every locked option is a reputation reward`);
}
assert.ok(PAINT_JOBS.every((job) => FINISHES[job.finish]), "every paint job names a known finish");
assert.ok(PAINT_JOBS.every((job) => !job.livery || (LIVERIES.includes(job.livery) && job.color2)), "liveries are known and carry an accent colour");
assert.ok(LIVERIES.every((id) => PAINT_JOBS.some((job) => job.livery === id)), "every livery is used by a paint job");
const lookResolved = resolveLook({ paint: "chrome", rims: "neonRing", neon: "nope", flame: 5 }, []);
assert.deepEqual([lookResolved.paint.id, lookResolved.rims.id, lookResolved.neon.id, lookResolved.flame.id], ["default", "default", "cyan", "orange"], "locked or unknown ids fall back to the free default");
assert.equal(resolveLook({ paint: "chrome" }, ["Lackfarbe Chrom"]).paint.id, "chrome", "unlocked options resolve");
assert.deepEqual(normalizeLook(null), DEFAULT_LOOK);
assert.ok(isUnlocked({ unlock: null }, []) && !isUnlocked({ unlock: "x" }, []));

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

// --- Phase 7: bindings, gamepad reading, keyboard ramp -------------------------------------
const { DEFAULT_BINDINGS, normalizeBindings, rebind, translateKey } = await import("../src/bindings.js");
const { PAD, deadzone, readGamepad, rumbleFor, triggersToAxis } = await import("../src/gamepad.js");
globalThis.document = { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} } };
const { rampSteer } = await import("../src/input.js");

assert.equal(translateKey("w"), "w", "default bindings are the identity");
assert.equal(translateKey("arrowup"), "arrowup", "unowned keys pass through");
const custom = rebind(DEFAULT_BINDINGS, "nitro", "f");
assert.equal(custom.nitro, "f");
assert.equal(translateKey("f", custom), "shift", "the new key acts as nitro");
assert.equal(translateKey("shift", custom), null, "the old key no longer does");
const swapped = rebind(DEFAULT_BINDINGS, "throttle", "s");
assert.equal(swapped.brake, "w", "binding a taken key swaps the two actions");
assert.equal(translateKey("s", swapped), "w");
assert.deepEqual(rebind(DEFAULT_BINDINGS, "nitro", "escape"), DEFAULT_BINDINGS, "reserved keys are refused");
assert.deepEqual(normalizeBindings({ nitro: "f", throttle: "f" }), DEFAULT_BINDINGS, "clashing stored bindings reset");
assert.equal(normalizeBindings({ nitro: "f" }).nitro, "f");
assert.deepEqual(normalizeBindings("junk"), DEFAULT_BINDINGS);

assert.equal(deadzone(0.1), 0, "small stick drift is ignored");
assert.equal(deadzone(1), 1);
assert.ok(deadzone(0.5) > 0 && deadzone(0.5) < 0.5, "the response is rescaled past the dead zone");
assert.equal(deadzone(-1), -1);
const fakePad = {
    axes: [-0.8, 0.05],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === PAD.a, value: i === PAD.rt ? 0.6 : i === PAD.lt ? 0 : i === PAD.a ? 1 : 0 })),
};
const read = readGamepad(fakePad);
assert.ok(read.steer < -0.7, "left stick left steers left (negative)");
assert.ok(Math.abs(read.throttle - 0.6) < 0.05, "analog trigger gives partial throttle");
assert.equal(read.buttons.a, true);
assert.equal(read.buttons.b, false);
assert.ok(triggersToAxis(read.throttle, read.brake) < 0, "throttle is forward (negative axis)");
assert.ok(rumbleFor(1).strong > rumbleFor(0.1).strong && rumbleFor(1).duration > rumbleFor(0.1).duration, "harder hits rumble more");

assert.ok(rampSteer(0, 1, 1 / 60) > 0 && rampSteer(0, 1, 1 / 60) < 0.2, "keyboard steering ramps up gently");
let ramp = 0;
for (let i = 0; i < 30; i += 1) ramp = rampSteer(ramp, 1, 1 / 60);
assert.equal(ramp, 1, "and reaches full lock");
assert.ok(rampSteer(1, -1, 1 / 60) < rampSteer(1, 0, 1 / 60), "reversing is faster than centring");
assert.equal(rampSteer(0.05, 0, 1 / 30), 0, "centring does not overshoot zero");

// --- Phase 8: shared math, scoring, heat decay, capacity formulas, save migration ----------
const { SAVE_VERSION, migrateProfile } = await import("../src/save.js");
const { axisVelocity, axisYaw, clamp: clampValue, distanceSq: distSq, turnToward, wrapAngle } = await import("../src/util/math.js");
const { COMBO_MAX_MULTIPLIER, comboMultiplier, heatDecayDelay, registerCombo, stepHeatDecay, tickCombo } = await import("../src/scoring.js");
const { maxHealth, nitroCapacity } = await import("../src/economy.js");

assert.equal(clampValue(5, 0, 3), 3);
assert.ok(Math.abs(wrapAngle(Math.PI * 3) - Math.PI) < 1e-9 && Math.abs(wrapAngle(-Math.PI * 2.5) + Math.PI / 2) < 1e-9, "angles wrap into (-PI, PI]");
assert.equal(distSq(0, 0, 3, 4), 25);
assert.ok(Math.abs(turnToward(0, 0, 0, 10, 0, 10) - Math.PI / 2) < 1e-9, "heading 0 faces +z; a target on +x is 90 degrees away");
assert.equal(turnToward(0, 0, 0, 10, 0, 0.1), 0.1, "turning is limited per step");
assert.ok(turnToward(3, 0, 0, 0, -10, 1) > 3, "takes the short way round across +-PI");
assert.deepEqual(axisVelocity("x", 5, -1), { vx: -5, vz: 0 });
assert.equal(axisYaw("z", -1), Math.PI);
assert.equal(axisYaw("x", 1), Math.PI / 2);

assert.equal(comboMultiplier(1, 1), 1);
assert.equal(comboMultiplier(9, 1), 1.5, "+0.25 per four chained hits");
assert.equal(comboMultiplier(500, 3), COMBO_MAX_MULTIPLIER, "the multiplier is capped");
assert.equal(comboMultiplier(1, 1, 0.5), 1.5, "provoke adds a flat bonus");
const combo = { chain: 0, multiplier: 1, timer: 0, best: 0 };
registerCombo(combo, { heatScore: 1 });
registerCombo(combo, { missionReward: true, heatScore: 1 });
assert.equal(combo.chain, 4, "a mission reward counts as three hits");
assert.equal(combo.timer, 6, "and keeps the combo alive longer");
assert.equal(combo.best, 4);
assert.equal(tickCombo(combo, 5), false);
assert.equal(tickCombo(combo, 2), true, "the combo reports when it runs out");
assert.equal(combo.chain, 0);
assert.equal(combo.multiplier, 1);

assert.equal(heatDecayDelay(7, 0), 7);
assert.ok(heatDecayDelay(7, 5) > heatDecayDelay(7, 1), "higher heat takes longer to shake");
let decay = 0;
let drops = 0;
for (let i = 0; i < 100; i += 1) {
    const stepResult = stepHeatDecay({ decay, dt: 0.5, level: 2, baseDelay: 7 });
    decay = stepResult.decay;
    if (stepResult.drop) drops += 1;
}
assert.equal(drops, 4, "50 s at heat 2 (11.2 s delay, 0.5 s steps) drops heat four times");
assert.ok(stepHeatDecay({ decay: 5, dt: 1, level: 0, baseDelay: 7, covered: true }).decay > stepHeatDecay({ decay: 5, dt: 1, level: 0, baseDelay: 7 }).decay, "cover speeds up the decay");

assert.equal(maxHealth({ armor: 0 }), 100);
assert.equal(maxHealth({ armor: 3 }), 154);
assert.equal(nitroCapacity({ nitro: 2 }), 136);
assert.equal(maxHealth(undefined), 100, "missing upgrades fall back to the base value");

const oldProfile = { version: 2, bestScore: 321, cash: 77, selectedCarId: "needle", unlockedCars: ["comet", "needle", "ghost-car"], upgrades: { engine: 9, grip: -4 }, achievements: ["firstMission"], lifetime: { missions: 4 } };
const migrated = migrateProfile(oldProfile);
assert.equal(migrated.version, SAVE_VERSION, "v2 saves are lifted to the current version");
assert.deepEqual(migrated.reputation, { downtown: 0, industrial: 0, park: 0, harbor: 0 });
assert.deepEqual([migrated.tags, migrated.unlocks, migrated.look.paint, migrated.paint, migrated.contract], [[], [], "default", undefined, null]);
const migratedV3 = migrateProfile({ version: 3, paint: "pink" });
assert.deepEqual(migratedV3.look, { ...DEFAULT_LOOK, paint: "pink" }, "v3 paint moves into the look");
assert.equal(migratedV3.paint, undefined);
assert.deepEqual(migrateProfile({ version: 4, look: { paint: "camo", rims: 3 } }).look, { paint: "camo", rims: 3 }, "v4 data is left alone");
assert.equal(migrated.bestScore, 321, "old data survives the migration");
assert.equal(migrateProfile({ version: 1 }).version, SAVE_VERSION, "very old saves too");
assert.equal(migrateProfile({ ...migrated, reputation: { park: 50 } }).reputation.park, 50, "a v3 save is not touched");

storage.set("neon-pursuit-profile-v2", JSON.stringify(oldProfile));
const loadedOld = loadProfile(CAR_MODELS, UPGRADES);
assert.equal(loadedOld.version, SAVE_VERSION);
assert.equal(loadedOld.cash, 77);
assert.equal(loadedOld.selectedCarId, "needle");
assert.deepEqual(loadedOld.unlockedCars, ["comet", "needle"], "unknown car ids are dropped");
assert.equal(loadedOld.upgrades.engine, UPGRADES.engine.max, "upgrade levels are clamped to the maximum");
assert.equal(loadedOld.upgrades.grip, 0, "and to zero");
assert.equal(loadedOld.reputation.downtown, 0);
storage.set("neon-pursuit-profile-v2", "{ this is not json");
assert.equal(loadProfile(CAR_MODELS, UPGRADES).cash, 0, "a corrupt save falls back to a fresh profile");

// --- Vehicle archetypes and the car builder -----------------------------------------------
const { BODY_ARCHETYPES, archetypeFor, archetypeId, sideContour, wheelLayout } = await import("../src/data/vehicles.js");
const THREE_LIB = await import("three");
const canvasStub = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: "" };
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => canvasStub }) };
const { createCar, createMaterial: makeMaterial } = await import("../src/vehicles.js");
const builderMaterials = {
    glass: new THREE_LIB.MeshStandardMaterial({ color: "#a9d9ff" }),
    tire: new THREE_LIB.MeshStandardMaterial({ color: "#08090a" }),
    dark: makeMaterial("#10151c"),
};
for (const [id, archetype] of Object.entries(BODY_ARCHETYPES)) {
    assert.equal(archetype.id, id, `${id}: archetype id matches its key`);
    assert.ok(archetype.cabin.from < archetype.cabin.to && archetype.cabin.height > 0, `${id}: cabin has a positive extent`);
    assert.ok(archetype.profile.noseX > 0 && archetype.profile.noseX < 0.5 && archetype.profile.tailX > 0 && archetype.profile.tailX < 0.5, `${id}: hood and trunk stay inside the body`);
    const contour = sideContour(archetype, 4, 0.7);
    assert.ok(contour.length >= 4, `${id}: contour is a polygon`);
    assert.ok(Math.min(...contour.map((point) => point[0])) === -2 && Math.max(...contour.map((point) => point[0])) === 2, `${id}: contour spans the car length`);
    const layout = wheelLayout(archetype, 2, 4);
    const bike = archetype.wheels.layout === "bike";
    assert.equal(layout.filter((spot) => spot.front).length, bike ? 1 : 2, `${id}: steered wheels`);
    assert.ok(layout.every((spot) => (bike || Math.abs(spot.x) > 0) && Math.abs(spot.z) < 2), `${id}: wheels sit inside the body footprint`);
}
assert.equal(archetypeId({ roof: "van" }), "van", "the legacy roof field still selects the archetype");
assert.equal(archetypeId({ body: "sport", roof: "van" }), "sport", "body wins over roof");
assert.equal(archetypeId({ roof: "unknown" }), "coupe", "unknown shapes fall back to the default");
assert.equal(archetypeFor(CAR_MODELS[3]).id, "van");

for (const model of CAR_MODELS) {
    const car = createCar(model, builderMaterials);
    let meshCount = 0;
    car.traverse((node) => { if (node.isMesh) meshCount += 1; });
    assert.ok(meshCount <= 18, `${model.id}: static parts are merged (${meshCount} meshes)`);
    assert.equal(car.userData.parts.wheels.length, 4, `${model.id}: four wheels`);
    const again = createCar(model, builderMaterials);
    const geometries = [];
    car.traverse((node) => { if (node.isMesh) geometries.push(node.geometry); });
    const shared = [];
    again.traverse((node) => { if (node.isMesh && geometries.includes(node.geometry)) shared.push(node); });
    assert.ok(shared.length >= 6, `${model.id}: cars of one model share their merged geometry`);
    const police = createCar(model, builderMaterials, { police: true });
    assert.ok(police.userData.parts.siren, `${model.id}: police cars get a light bar`);
}

// --- Parts library: every part, light style, rim style and showcase model builds ------------
const parts = await import("../src/vehicleParts.js");
const { SHOWCASE_OVERRIDES } = await import("../src/data/vehicles.js");
const sampleModel = CAR_MODELS[0];
const sampleContext = parts.partContext(sampleModel, archetypeFor(sampleModel));
const KNOWN_GROUPS = new Set(["paint", "trim", "dark", "accent", "head", "tail", "glow"]);
for (const name of parts.PART_NAMES) {
    const built = parts.PARTS[name](sampleContext);
    const groups = Object.keys(built);
    assert.ok(groups.length > 0 && groups.every((group) => KNOWN_GROUPS.has(group)), `part ${name}: uses known material groups`);
    for (const list of Object.values(built)) {
        assert.ok(list.length > 0 && list.every((g) => g.attributes.position.count > 0 && !g.index), `part ${name}: non-empty, non-indexed geometry (mergeable)`);
    }
}
for (const name of parts.LIGHT_STYLE_NAMES) {
    const lights = parts.LIGHT_STYLES[name](sampleContext);
    assert.ok(lights.head.length > 0 && lights.tail.length > 0, `light style ${name}: has head and tail lights`);
    assert.ok([...lights.head, ...lights.tail].every((g) => !g.index), `light style ${name}: mergeable geometry`);
}
for (const name of parts.RIM_STYLE_NAMES) {
    const rim = parts.RIM_STYLES[name]();
    assert.ok(rim.attributes.position.count > 0, `rim style ${name}: builds`);
}
assert.ok(parts.TIRE_STYLES.fat.width > parts.TIRE_STYLES.standard.width, "fat tyres are wider");

const showcaseSeen = new Set();
for (const override of SHOWCASE_OVERRIDES) {
    const model = { ...CAR_MODELS[override.base], ...override.model };
    for (const feature of model.features ?? []) assert.ok(parts.PART_NAMES.includes(feature), `showcase ${model.name}: unknown feature ${feature}`);
    if (model.wheelStyle) assert.ok(parts.RIM_STYLE_NAMES.includes(model.wheelStyle), `showcase ${model.name}: unknown wheel style`);
    if (model.lights) assert.ok(parts.LIGHT_STYLE_NAMES.includes(model.lights), `showcase ${model.name}: unknown light style`);
    const car = createCar(model, builderMaterials);
    let meshCount = 0;
    car.traverse((node) => { if (node.isMesh) meshCount += 1; });
    assert.ok(meshCount <= 18, `showcase ${model.name}: still merged (${meshCount} meshes)`);
    assert.ok(car.userData.parts.wheelRadius >= 0.42, `showcase ${model.name}: wheel radius follows the tyre style`);
    showcaseSeen.add(model.name);
}
assert.equal(showcaseSeen.size, SHOWCASE_OVERRIDES.length, "showcase models have unique names");

// --- Civilian fleet: types, palettes, district weights, footprint radius ---------------------
const fleet = await import("../src/data/vehicles.js");
const { vehicleRadius } = await import("../src/physics/vehicle.js");
const cityDistricts = DISTRICTS.map((district) => district.id);
assert.deepEqual(Object.keys(fleet.DISTRICT_FLEETS).sort(), [...cityDistricts].sort(), "every district has a fleet");
for (const [id, type] of Object.entries(fleet.CIVILIAN_TYPES)) {
    assert.ok(fleet.BODY_ARCHETYPES[type.body], `${id}: body archetype ${type.body} exists`);
    assert.ok(type.width <= 2.3, `${id}: at most 2.3 m wide (streets are 5.4 m)`);
    assert.ok(type.length >= 1.5 && type.length <= 7.6, `${id}: sensible length`);
    assert.ok(type.mass > 0, `${id}: has a mass`);
    for (const feature of type.features ?? []) assert.ok(parts.PART_NAMES.includes(feature), `${id}: unknown feature ${feature}`);
    for (const accessory of type.accessories ?? []) assert.ok(parts.PART_NAMES.includes(accessory), `${id}: unknown accessory ${accessory}`);
    for (const style of type.lights ?? []) assert.ok(parts.LIGHT_STYLE_NAMES.includes(style), `${id}: unknown light style`);
    for (const style of type.wheelStyles ?? []) assert.ok(parts.RIM_STYLE_NAMES.includes(style), `${id}: unknown wheel style`);
    if (type.palette) assert.ok(fleet.PALETTES[type.palette], `${id}: palette ${type.palette} exists`);
}
for (const [districtId, entries] of Object.entries(fleet.DISTRICT_FLEETS)) {
    assert.ok(entries.length >= 5, `${districtId}: a varied fleet`);
    assert.ok(entries.every(([type, weight]) => fleet.CIVILIAN_TYPES[type] && weight > 0), `${districtId}: known types, positive weights`);
    assert.ok(fleet.PALETTES[districtId].length >= 4, `${districtId}: a palette with real choice`);
}
let rngSeed = 11;
const seeded = () => {
    rngSeed = (rngSeed * 16807) % 2147483647;
    return rngSeed / 2147483647;
};
const seenTypes = new Set();
for (const districtId of cityDistricts) {
    for (let i = 0; i < 400; i += 1) {
        const model = fleet.pickCivilian(districtId, seeded);
        seenTypes.add(`${districtId}:${model.type}`);
        assert.ok(/^#[0-9a-f]{6}$/.test(model.color) && /^#[0-9a-f]{6}$/.test(model.trim), "colours are valid hex");
        assert.ok(fleet.BODY_ARCHETYPES[model.body] && model.width <= 2.3, "picked models are buildable");
    }
}
for (const [districtId, entries] of Object.entries(fleet.DISTRICT_FLEETS)) {
    for (const [type] of entries) assert.ok(seenTypes.has(`${districtId}:${type}`), `${districtId}: ${type} actually spawns`);
}
assert.equal(fleet.pickCivilian("downtown", () => 0).type, "taxi", "the first weighted entry is picked at roll 0");
assert.equal(fleet.shadeColor("#808080", 1), "#808080");
assert.equal(fleet.shadeColor("#ffffff", 2), "#ffffff", "shading clamps at white");
assert.ok(fleet.shadeColor("#808080", 0.5) < "#808080", "shading darkens");

const sedan = fleet.buildCivilian("sedan", "downtown", () => 0.5);
const bus = fleet.buildCivilian("bus", "downtown", () => 0.5);
const scooter = fleet.buildCivilian("scooter", "downtown", () => 0.5);
assert.ok(vehicleRadius(scooter) < vehicleRadius(sedan) && vehicleRadius(sedan) < vehicleRadius(bus), "bigger footprint, bigger hitbox");
assert.ok(Math.abs(vehicleRadius(CAR_MODELS[0]) - 1.382) < 0.001, "the Comet keeps the radius traffic always used");
assert.equal(wheelLayout(fleet.BODY_ARCHETYPES.scooter, 0.8, 1.9).length, 2, "a scooter has two wheels");
assert.ok(wheelLayout(fleet.BODY_ARCHETYPES.scooter, 0.8, 1.9).every((spot) => spot.x === 0 && spot.scale < 1), "on the centre line, smaller");

for (const typeId of Object.keys(fleet.CIVILIAN_TYPES)) {
    const model = fleet.buildCivilian(typeId, "harbor", seeded);
    const car = createCar(model, builderMaterials);
    let meshCount = 0;
    car.traverse((node) => { if (node.isMesh) meshCount += 1; });
    assert.ok(meshCount <= 18, `${typeId}: merged (${meshCount} meshes)`);
    assert.equal(car.userData.parts.wheels.length, typeId === "scooter" ? 2 : 4, `${typeId}: wheel count`);
}

// --- Police looks, unmarked reveal, rival variety --------------------------------------------
const { POLICE_UNITS: policeUnitStats } = await import("../src/config.js");
assert.deepEqual(Object.keys(fleet.POLICE_LOOKS).sort(), Object.keys(policeUnitStats).sort(), "every police unit has a look and stats");
for (const [unitId, looks] of Object.entries(fleet.POLICE_LOOKS)) {
    for (const look of looks) {
        assert.ok(fleet.BODY_ARCHETYPES[look.body], `${unitId}/${look.id}: body exists`);
        assert.ok(look.width <= 2.4 && look.length <= 5.6, `${unitId}/${look.id}: fits the street`);
        assert.ok(look.color || look.colors?.length, `${unitId}/${look.id}: has a colour`);
        for (const feature of look.features ?? []) assert.ok(parts.PART_NAMES.includes(feature), `${unitId}/${look.id}: unknown feature ${feature}`);
        assert.ok(["bar", "dome", "grille"].includes(look.lightbar), `${unitId}/${look.id}: known light bar`);
        const model = fleet.policeModelFor(unitId, 5, () => 0);
        const car = createCar(model, builderMaterials, { police: true, lightbar: model.lightbar, hidden: model.hidden });
        assert.ok(car.userData.parts.siren, `${unitId}/${look.id}: has a siren`);
        let meshCount = 0;
        car.traverse((node) => { if (node.isMesh) meshCount += 1; });
        assert.ok(meshCount <= 24, `${unitId}/${look.id}: stays cheap (${meshCount} meshes)`);
    }
}
assert.equal(fleet.policeModelFor("patrol", 0, () => 0.99).id, "police-patrol-cruiser", "the Interceptor needs heat 3");
assert.ok(["police-patrol-cruiser", "police-patrol-interceptor"].includes(fleet.policeModelFor("patrol", 4, () => 0.99).id));
assert.equal(fleet.policeModelFor("patrol", 3, () => 0.99).id, "police-patrol-interceptor", "from heat 3 the Interceptor appears");
assert.equal(wheelLayout(fleet.BODY_ARCHETYPES.motorbike, 0.9, 2.5).length, 2, "the police motorcycle has two wheels");
assert.ok(vehicleRadius(fleet.policeModelFor("motorcycle")) < vehicleRadius(fleet.policeModelFor("patrol")) && vehicleRadius(fleet.policeModelFor("patrol")) < vehicleRadius(fleet.policeModelFor("van")), "bike < cruiser < SWAT truck");

const unmarkedModel = fleet.policeModelFor("unmarked", 1);
const hiddenCar = createCar(unmarkedModel, builderMaterials, { police: true, lightbar: unmarkedModel.lightbar, hidden: true });
const hiddenBeacons = [];
hiddenCar.traverse((node) => { if (node.isMesh && node.parent === hiddenCar.userData.parts.chassis && node.visible === false) hiddenBeacons.push(node); });
assert.ok(hiddenBeacons.length >= 4, "an unmarked car starts with its lights off");
assert.equal(hiddenCar.userData.parts.revealed, false);
hiddenCar.userData.parts.reveal();
let stillHidden = 0;
hiddenCar.traverse((node) => { if (node.isMesh && node.visible === false) stillHidden += 1; });
assert.equal(stillHidden, 0, "revealing switches every beacon on");
assert.equal(hiddenCar.userData.parts.revealed, true);

for (let round = 0; round < 25; round += 1) {
    const rivals = fleet.pickRivalModels(CAR_MODELS, 3, seeded);
    assert.equal(rivals.length, 3);
    assert.equal(new Set(rivals.map((rival) => rival.id)).size, 3, "rivals drive different bodies");
    assert.equal(new Set(rivals.map((rival) => rival.name)).size, 3, "and look different");
    assert.ok(rivals.every((rival) => fleet.RIVAL_STYLES.some((style) => style.color === rival.color)), "rival colours come from the style presets");
}
assert.equal(fleet.pickRivalModels(CAR_MODELS, 2, seeded).length, 2);

// --- Phase V4: the ten player cars, form-based hitbox, wheelbase, reputation gates ----------
const { carRequirement } = await import("../src/progression.js");
const { playerRadius, wheelbaseTurnFactor } = await import("../src/physics/vehicle.js");
const { reputationTier: tierOf } = await import("../src/progression.js");
assert.equal(CAR_MODELS.length, 10, "four classics plus six new cars");
assert.deepEqual(CAR_MODELS.slice(0, 4).map((car) => car.id), ["comet", "bulldog", "needle", "mule"], "the saved car ids keep their order");
assert.deepEqual(CAR_MODELS.slice(4).map((car) => car.id), ["hornet", "scarab", "barge", "forge", "tide", "wraith"]);
const silhouettes = new Set(CAR_MODELS.map((car) => `${car.body ?? car.roof}:${car.length}:${car.width}`));
assert.equal(silhouettes.size, CAR_MODELS.length, "every player car has its own shape and size");
for (const car of CAR_MODELS.slice(4)) {
    assert.ok(fleet.BODY_ARCHETYPES[car.body], `${car.id}: body exists`);
    for (const feature of car.features ?? []) assert.ok(parts.PART_NAMES.includes(feature), `${car.id}: unknown feature ${feature}`);
    assert.ok(car.unlockCost > 0 && car.description.length > 10, `${car.id}: priced and described`);
    if (car.requires) {
        assert.ok(car.requires.tier >= 1 && car.requires.tier < REPUTATION_TIERS.length, `${car.id}: tier in range`);
        if (car.requires.district) assert.ok(cityDistricts.includes(car.requires.district), `${car.id}: known district`);
    }
    assert.ok(car.width <= 2.3 && car.length <= 5.8, `${car.id}: fits the streets`);
}
assert.deepEqual(CAR_MODELS.slice(4).filter((car) => car.requires?.district).map((car) => car.requires.district).sort(), ["downtown", "harbor", "industrial", "park"], "one signature car per district");
assert.equal(CAR_MODELS.filter((car) => !car.requires && car.unlockCost > 0).length, 4, "Bulldog, Needle, Mule and Hornet are bought with cash alone");

const scarab = CAR_MODELS.find((car) => car.id === "scarab");
assert.equal(carRequirement(scarab, {}).met, false, "no reputation, no Scarab");
assert.match(carRequirement(scarab, {}).text, /Park/);
assert.equal(carRequirement(scarab, { park: REPUTATION_TIERS[2].at }).met, true, "tier 2 in the park unlocks it");
assert.equal(carRequirement(scarab, { downtown: 99999 }).met, false, "the wrong district does not count");
const wraith = CAR_MODELS.find((car) => car.id === "wraith");
assert.equal(carRequirement(wraith, { harbor: REPUTATION_TIERS[4].at }).met, true, "the Wraith accepts any district at tier 4");
assert.equal(carRequirement(wraith, { harbor: REPUTATION_TIERS[3].at }).met, false);
assert.equal(carRequirement(CAR_MODELS[1], {}).met, true, "cars without requirement are only gated by price");
assert.ok(tierOf(REPUTATION_TIERS[2].at).index === 2);

assert.ok(Math.abs(playerRadius(CAR_MODELS[0]) - 1.2438) < 0.01, "the Comet keeps its old ~1.25 contact radius");
const radii = CAR_MODELS.map((car) => playerRadius(car));
assert.ok(radii[2] < radii[0] && radii[0] < radii[1] && radii[1] < radii[3], "Needle < Comet < Bulldog < Mule");
assert.ok(playerRadius(CAR_MODELS.find((car) => car.id === "hornet")) < playerRadius(CAR_MODELS.find((car) => car.id === "barge")), "Hornet is tighter than Barge");
for (const car of CAR_MODELS) {
    const factor = wheelbaseTurnFactor(car);
    assert.ok(factor >= 0.9 && factor <= 1.1, `${car.id}: wheelbase factor stays gentle`);
}
assert.ok(wheelbaseTurnFactor({ length: 3.5 }) > wheelbaseTurnFactor({ length: 5.6 }), "short cars turn tighter than long ones");
assert.equal(wheelbaseTurnFactor({ length: 4.6 }), 1, "the reference length is neutral");
assert.ok(parts.RESERVED_KEYS === undefined, "parts module has no key table");
const { RESERVED_KEYS: reservedKeys } = await import("../src/bindings.js");
assert.ok(["1", "5", "9", "0"].every((digit) => reservedKeys.has(digit)), "all car-switch digits stay reserved");

clearProfile();
assert.equal(loadProfile(CAR_MODELS, UPGRADES).cash, 0);

console.log("logic smoke ok");
