import { normalizeLook } from "./data/looks.js";

// The storage key keeps its old name so existing saves are found; the format version lives inside the data.
const SAVE_KEY = "neon-pursuit-profile-v2";
export const SAVE_VERSION = 4;

/**
 * Brings a stored profile up to the current format. v2 -> v3 adds district reputation, graffiti tags,
 * reputation unlocks, the paint job and the carried-over contract. v3 -> v4 replaces `paint` by `look`
 * (paint, rims, neon, flame, lights).
 */
export function migrateProfile(raw) {
    const profile = { ...raw };
    const version = Number(profile.version) || 1;
    if (version < 3) {
        profile.reputation = profile.reputation ?? { downtown: 0, industrial: 0, park: 0, harbor: 0 };
        profile.tags = profile.tags ?? [];
        profile.unlocks = profile.unlocks ?? [];
        profile.paint = profile.paint ?? "default";
        profile.contract = profile.contract ?? null;
    }
    if (version < 4) {
        profile.look = normalizeLook({ ...profile.look, paint: profile.paint });
        delete profile.paint;
    }
    profile.version = Math.max(version, SAVE_VERSION);
    return profile;
}

export function createDefaultProfile(carModels, upgrades) {
    const firstCar = carModels[0]?.id ?? "comet";
    return {
        version: SAVE_VERSION,
        bestScore: 0,
        cash: 0,
        selectedCarId: firstCar,
        unlockedCars: [firstCar],
        upgrades: Object.fromEntries(Object.keys(upgrades).map((id) => [id, 0])),
        achievements: [],
        reputation: { downtown: 0, industrial: 0, park: 0, harbor: 0 },
        tags: [],
        unlocks: [],
        look: normalizeLook(),
        contract: null,
        lifetime: {
            missions: 0,
            pickups: 0,
            props: 0,
            events: 0,
            closeCalls: 0,
        },
    };
}

export function loadProfile(carModels, upgrades) {
    const fallback = createDefaultProfile(carModels, upgrades);
    try {
        const raw = window.localStorage.getItem(SAVE_KEY);
        if (!raw) return fallback;
        const parsed = migrateProfile(JSON.parse(raw));
        const unlockedCars = Array.isArray(parsed.unlockedCars) && parsed.unlockedCars.length > 0
            ? parsed.unlockedCars.filter((id) => carModels.some((car) => car.id === id))
            : fallback.unlockedCars;
        const selectedCarId = unlockedCars.includes(parsed.selectedCarId) ? parsed.selectedCarId : unlockedCars[0];
        return {
            ...fallback,
            ...parsed,
            version: SAVE_VERSION,
            bestScore: Number(parsed.bestScore) || 0,
            cash: Number(parsed.cash) || 0,
            selectedCarId,
            unlockedCars,
            upgrades: {
                ...fallback.upgrades,
                ...Object.fromEntries(Object.keys(upgrades).map((id) => {
                    const value = Number(parsed.upgrades?.[id]) || 0;
                    return [id, Math.max(0, Math.min(upgrades[id].max, value))];
                })),
            },
            achievements: Array.isArray(parsed.achievements) ? parsed.achievements : [],
            reputation: {
                ...fallback.reputation,
                ...Object.fromEntries(Object.entries(parsed.reputation ?? {}).map(([key, value]) => [key, Math.max(0, Number(value) || 0)])),
            },
            tags: Array.isArray(parsed.tags) ? parsed.tags.filter((id) => typeof id === "string") : [],
            look: normalizeLook(parsed.look),
            unlocks: Array.isArray(parsed.unlocks) ? parsed.unlocks.filter((id) => typeof id === "string") : [],
            contract: parsed.contract && typeof parsed.contract.id === "string"
                ? { id: parsed.contract.id, progress: Number(parsed.contract.progress) || 0, claimed: Boolean(parsed.contract.claimed) }
                : null,
            lifetime: {
                ...fallback.lifetime,
                ...Object.fromEntries(Object.entries(parsed.lifetime ?? {}).map(([key, value]) => [key, Number(value) || 0])),
            },
        };
    } catch {
        return fallback;
    }
}

export function saveProfile(profile) {
    try {
        window.localStorage.setItem(SAVE_KEY, JSON.stringify(profile));
    } catch {
        // Saving is a convenience layer; gameplay continues when storage is blocked.
    }
}

export function clearProfile() {
    try {
        window.localStorage.removeItem(SAVE_KEY);
        window.localStorage.removeItem("neon-pursuit-best");
    } catch {
        // Nothing to recover here; callers reset the in-memory state too.
    }
}
