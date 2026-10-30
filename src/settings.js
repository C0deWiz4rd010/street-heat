import { DEFAULT_BINDINGS, normalizeBindings } from "./bindings.js";

const SETTINGS_KEY = "street-heat-settings";

export const SETTINGS_DEFAULTS = {
    master: 0.8,
    music: 0.7,
    sfx: 0.9,
    quality: "medium",
    cameraMode: "normal",
    shake: 1,
    reducedMotion: false,
    muted: false,
    onboardingDone: false,
    bindings: { ...DEFAULT_BINDINGS },
};

const QUALITIES = ["low", "medium", "high"];
const CAMERA_MODES = ["near", "normal", "far"];
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback, min, max) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? clamp(Number(value), min, max) : fallback);

/** Validates untrusted stored values; anything unusable falls back to the default. */
export function normalizeSettings(raw = {}, prefersReducedMotion = false) {
    const defaults = { ...SETTINGS_DEFAULTS, reducedMotion: prefersReducedMotion };
    return {
        master: number(raw.master, defaults.master, 0, 1),
        music: number(raw.music, defaults.music, 0, 1),
        sfx: number(raw.sfx, defaults.sfx, 0, 1),
        quality: QUALITIES.includes(raw.quality) ? raw.quality : defaults.quality,
        cameraMode: CAMERA_MODES.includes(raw.cameraMode) ? raw.cameraMode : defaults.cameraMode,
        shake: number(raw.shake, defaults.shake, 0, 1.5),
        reducedMotion: typeof raw.reducedMotion === "boolean" ? raw.reducedMotion : defaults.reducedMotion,
        muted: raw.muted === true,
        onboardingDone: raw.onboardingDone === true,
        bindings: normalizeBindings(raw.bindings),
    };
}

/**
 * Settings live under their own storage key (separate from the game profile).
 * `values` is one mutable object so game code can read it every frame.
 */
export function createSettings({ storage = null, prefersReducedMotion = false, onChange = () => {} } = {}) {
    let store = storage;
    if (!store) {
        try {
            store = window.localStorage;
        } catch {
            store = null;
        }
    }
    let stored = {};
    try {
        stored = JSON.parse(store?.getItem(SETTINGS_KEY) ?? "{}") ?? {};
    } catch {
        stored = {};
    }
    const values = normalizeSettings(stored, prefersReducedMotion);

    function save() {
        try {
            store?.setItem(SETTINGS_KEY, JSON.stringify(values));
        } catch {
            // Settings are a convenience; a blocked storage must never break the game.
        }
    }

    function set(key, value) {
        if (!(key in SETTINGS_DEFAULTS)) return;
        Object.assign(values, normalizeSettings({ ...values, [key]: value }, prefersReducedMotion));
        save();
        onChange(key, values[key], values);
    }

    return { values, set, save };
}
