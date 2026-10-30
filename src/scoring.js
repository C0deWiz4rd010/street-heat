import { clamp } from "./util/math.js";

export const COMBO_MAX_MULTIPLIER = 4.3;
const HIT_SECONDS = 4.2;
const MISSION_SECONDS = 6;

/** Multiplier for a chain: the heat tier's base, +0.25 for every four chained hits, plus any provoke bonus. */
export function comboMultiplier(chain, heatScore, provokeBonus = 0) {
    return clamp(heatScore + Math.floor(Math.max(0, chain - 1) / 4) * 0.25 + provokeBonus, 1, COMBO_MAX_MULTIPLIER);
}

/** Registers one scoring event: mission rewards count as three hits and keep the combo alive longer. */
export function registerCombo(combo, { missionReward = false, heatScore = 1, provokeBonus = 0 } = {}) {
    combo.chain += missionReward ? 3 : 1;
    combo.timer = missionReward ? MISSION_SECONDS : HIT_SECONDS;
    combo.maxTimer = combo.timer;
    combo.best = Math.max(combo.best, combo.chain);
    combo.multiplier = comboMultiplier(combo.chain, heatScore, provokeBonus);
    return combo;
}

/** Ticks the combo timer; returns true when the combo just ran out. */
export function tickCombo(combo, dt) {
    if (combo.timer <= 0) {
        combo.chain = 0;
        combo.multiplier = 1;
        return false;
    }
    combo.timer = Math.max(0, combo.timer - dt);
    if (combo.timer === 0) {
        combo.chain = 0;
        combo.multiplier = 1;
        return true;
    }
    return false;
}

/** Seconds out of sight before one heat level drops; higher heat takes longer to shake. */
export function heatDecayDelay(baseDelay, level) {
    return baseDelay * (1 + level * 0.3);
}

/** Advances the out-of-sight timer (faster inside escape cover). Returns the new timer and whether heat drops now. */
export function stepHeatDecay({ decay, dt, level, covered = false, baseDelay }) {
    const next = decay + dt * (covered ? 1.45 : 1);
    if (next > heatDecayDelay(baseDelay, level)) return { decay: 0, drop: true };
    return { decay: next, drop: false };
}
