import { CAR_MODELS, UPGRADES } from "./config.js";

// Balancing assumptions for a "typical" run. The formulas mirror completeMission(), the pickup table
// and the district cash multiplier, so changing a reward in the game shows up here.
export const RUN_ASSUMPTIONS = {
    missions: 3,
    stage: 3,
    bonusChance: 0.5,
    bonusReward: 240,
    cashPickups: 6,
    cashPerPickup: 60,
    partsPickups: 3,
    cashPerPart: 35,
    events: 1,
    eventCash: 260,
    districtCashMultiplier: 1.1,
};

/** Expected cash from one run under the given assumptions. */
export function estimateRunCash(assumptions = RUN_ASSUMPTIONS) {
    const a = { ...RUN_ASSUMPTIONS, ...assumptions };
    const missionReward = 850 + a.stage * 230;
    const perMission = Math.floor(missionReward * 0.34) + a.bonusChance * Math.round(a.bonusReward * 0.72);
    const chain = Math.floor(a.missions / 3) * (180 + a.stage * 35);
    const raw = a.missions * perMission + chain + a.cashPickups * a.cashPerPickup + a.partsPickups * a.cashPerPart + a.events * a.eventCash;
    return Math.round(raw * a.districtCashMultiplier);
}

export function upgradeCost(id, level) {
    return Math.round((UPGRADES[id].baseCost * (1 + level * 0.72 + level * level * 0.18)) / 10) * 10;
}

/** Table of price / expected run cash, one row per purchasable item. */
export function economyTable(assumptions = RUN_ASSUMPTIONS) {
    const perRun = estimateRunCash(assumptions);
    const rows = [];
    for (const car of CAR_MODELS) {
        if (car.unlockCost > 0) rows.push({ item: `Auto ${car.name}`, price: car.unlockCost, runs: car.unlockCost / perRun });
    }
    for (const [id, upgrade] of Object.entries(UPGRADES)) {
        for (let level = 0; level < upgrade.max; level += 1) {
            const price = upgradeCost(id, level);
            rows.push({ item: `${upgrade.label} Stufe ${level + 1}`, price, runs: price / perRun });
        }
    }
    return { perRun, rows };
}
