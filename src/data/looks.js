// Cosmetic data for the player car: paint jobs (colour + finish + livery), rims, underglow, nitro flame and
// headlight colour. Pure data and lookups, so the save, the garage UI and the tests share one source.
// `unlock` names an entry in profile.unlocks (see REPUTATION_TIERS in config.js).

/** Finish = material look. `physical` finishes use a clearcoat material. */
export const FINISHES = {
    gloss: { roughness: 0.24, metalness: 0.36 },
    matte: { roughness: 0.88, metalness: 0.04 },
    satin: { roughness: 0.5, metalness: 0.3 },
    metallic: { roughness: 0.28, metalness: 0.85 },
    chrome: { roughness: 0.12, metalness: 0.95 },
    pearl: { roughness: 0.3, metalness: 0.45, physical: { clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.9, iridescenceIOR: 1.6 } },
    candy: { roughness: 0.16, metalness: 0.6, physical: { clearcoat: 1, clearcoatRoughness: 0.05 } },
};

/** Patterns drawn on a canvas and projected from above (the camera looks down, so the roof and hood read best). */
export const LIVERIES = ["stripes", "dualStripes", "flames", "checker", "hazard", "camo", "tribal"];

export const PAINT_JOBS = [
    { id: "default", label: "Original", color: null, finish: "gloss", unlock: null },
    { id: "white", label: "Weiß", color: "#e9edf2", finish: "gloss", unlock: null },
    { id: "black", label: "Schwarz", color: "#14171c", finish: "gloss", unlock: null },
    { id: "blue", label: "Blau", color: "#2f6fd6", finish: "gloss", unlock: null },
    { id: "taxi", label: "Taxi-Gelb", color: "#ffc23e", finish: "gloss", unlock: null },
    { id: "midnight", label: "Mitternacht", color: "#12161d", finish: "matte", unlock: null },
    { id: "steel", label: "Satin Stahl", color: "#6b7684", finish: "satin", unlock: null },
    { id: "graphite", label: "Metallic Graphit", color: "#3c4452", finish: "metallic", unlock: null },
    { id: "ice", label: "Eis & Nacht", color: "#e8eef5", color2: "#12161d", finish: "gloss", unlock: null },
    { id: "racing", label: "Rennstreifen", color: "#1f4fa8", color2: "#f2f2f2", finish: "gloss", livery: "stripes", unlock: null },
    { id: "twin", label: "Doppelstreifen", color: "#101216", color2: "#ff3fa4", finish: "gloss", livery: "dualStripes", unlock: null },
    { id: "checker", label: "Schachbrett", color: "#f2f2f2", color2: "#14171c", finish: "gloss", livery: "checker", unlock: null },
    { id: "hazard", label: "Warnstreifen", color: "#e8b923", color2: "#14171c", finish: "satin", livery: "hazard", unlock: null },
    { id: "camo", label: "Tarnmuster", color: "#4a5a3a", color2: "#2c3524", finish: "matte", livery: "camo", unlock: null },
    { id: "pink", label: "Neon-Pink", color: "#ff3fa4", finish: "gloss", unlock: "Lackfarbe Neon-Pink" },
    { id: "candy", label: "Candy-Rot", color: "#c4122f", finish: "candy", unlock: "Lackfarbe Neon-Pink" },
    { id: "chrome", label: "Chrom", color: "#c9d2dc", finish: "chrome", unlock: "Lackfarbe Chrom" },
    { id: "pearl", label: "Perlmutt", color: "#f2ecff", finish: "pearl", unlock: "Lackfarbe Chrom" },
    { id: "flames", label: "Flammen", color: "#14171c", color2: "#ff7a1a", finish: "gloss", livery: "flames", unlock: "Lackfarbe Chrom" },
    { id: "tribal", label: "Tribal", color: "#101216", color2: "#2ff3ff", finish: "gloss", livery: "tribal", unlock: "Kosmetik Unterboden-Neon" },
];

export const RIM_CHOICES = [
    { id: "default", label: "Original", style: null, unlock: null },
    { id: "disc", label: "Scheibe", style: "disc", unlock: null },
    { id: "fiveSpoke", label: "Fünfspeichen", style: "fiveSpoke", unlock: null },
    { id: "turbine", label: "Turbine", style: "turbine", unlock: null },
    { id: "neonRing", label: "Neonring", style: "neonRing", unlock: "Kosmetik Unterboden-Neon" },
];

// Glow colours are given as hex; the builder boosts them past the bloom threshold.
export const NEON_CHOICES = [
    { id: "cyan", label: "Cyan", color: "#2ff3ff", unlock: null },
    { id: "lime", label: "Limette", color: "#7dff4a", unlock: null },
    { id: "amber", label: "Bernstein", color: "#ffb02e", unlock: null },
    { id: "magenta", label: "Magenta", color: "#ff3fd8", unlock: "Lackfarbe Neon-Pink" },
    { id: "violet", label: "Violett", color: "#a56bff", unlock: "Lackfarbe Neon-Pink" },
    { id: "red", label: "Rot", color: "#ff3b4a", unlock: "Lackfarbe Chrom" },
];

export const FLAME_CHOICES = [
    { id: "orange", label: "Orange", color: "#ff8a2a", unlock: null },
    { id: "blue", label: "Blau", color: "#4aa8ff", unlock: null },
    { id: "green", label: "Grün", color: "#5dff8a", unlock: null },
    { id: "pink", label: "Pink", color: "#ff5cc0", unlock: "Lackfarbe Neon-Pink" },
    { id: "white", label: "Weiß", color: "#e8f2ff", unlock: "Lackfarbe Chrom" },
];

export const LIGHT_CHOICES = [
    { id: "warm", label: "Warm", color: "#fff6a8", beam: "#fff1c4", unlock: null },
    { id: "cold", label: "Kalt", color: "#d8ecff", beam: "#e4f2ff", unlock: null },
    { id: "violet", label: "Violett", color: "#caa8ff", beam: "#d6bdff", unlock: "Lackfarbe Neon-Pink" },
    { id: "amber", label: "Bernstein", color: "#ffc062", beam: "#ffd08a", unlock: "Lackfarbe Chrom" },
];

/** The garage groups, in display order. `key` is the field in the look object. */
export const LOOK_GROUPS = [
    { key: "paint", label: "Lack", options: PAINT_JOBS },
    { key: "rims", label: "Felgen", options: RIM_CHOICES },
    { key: "neon", label: "Unterboden-Neon", options: NEON_CHOICES },
    { key: "flame", label: "Nitro-Flamme", options: FLAME_CHOICES },
    { key: "lights", label: "Scheinwerfer", options: LIGHT_CHOICES },
];

export const DEFAULT_LOOK = { paint: "default", rims: "default", neon: "cyan", flame: "orange", lights: "warm" };

/** A look from untrusted data (save file, UI): only known string fields, everything else falls back to the default. */
export function normalizeLook(raw) {
    const look = { ...DEFAULT_LOOK };
    if (raw && typeof raw === "object") {
        for (const key of Object.keys(DEFAULT_LOOK)) if (typeof raw[key] === "string") look[key] = raw[key];
    }
    return look;
}

export function isUnlocked(option, unlocks = []) {
    return !option.unlock || unlocks.includes(option.unlock);
}

/**
 * Turns a look into the option objects the builder needs. Unknown or still locked ids fall back to the group's first
 * (free) option, so a save from a reset profile never shows a locked item.
 */
export function resolveLook(look, unlocks = []) {
    const source = normalizeLook(look);
    const pick = (options, id) => {
        const found = options.find((option) => option.id === id);
        return found && isUnlocked(found, unlocks) ? found : options[0];
    };
    return {
        paint: pick(PAINT_JOBS, source.paint),
        rims: pick(RIM_CHOICES, source.rims),
        neon: pick(NEON_CHOICES, source.neon),
        flame: pick(FLAME_CHOICES, source.flame),
        lights: pick(LIGHT_CHOICES, source.lights),
    };
}

/** A stable string for caching "is this look already applied". */
export function lookKey(resolved) {
    return [resolved.paint.id, resolved.rims.id, resolved.neon.id, resolved.flame.id, resolved.lights.id].join("|");
}
