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
assert.equal(HEAT_TIERS.length, 6, "heat tiers should cover levels 0-5");
assert.ok(Object.values(WEATHER_MODES).every((weather) => weather.grip > 0 && weather.grip <= 1), "weather grip values must be usable");
assert.ok(WORLD_EVENTS.every((event) => event.score > 0), "world events need score rewards");
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

clearProfile();
assert.equal(loadProfile(CAR_MODELS, UPGRADES).cash, 0);

console.log("logic smoke ok");
