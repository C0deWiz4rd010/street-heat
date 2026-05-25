const SAVE_KEY = "neon-pursuit-profile-v2";

export function createDefaultProfile(carModels, upgrades) {
    const firstCar = carModels[0]?.id ?? "comet";
    return {
        version: 2,
        bestScore: 0,
        cash: 0,
        selectedCarId: firstCar,
        unlockedCars: [firstCar],
        upgrades: Object.fromEntries(Object.keys(upgrades).map((id) => [id, 0])),
        achievements: [],
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
        const parsed = JSON.parse(raw);
        const unlockedCars = Array.isArray(parsed.unlockedCars) && parsed.unlockedCars.length > 0
            ? parsed.unlockedCars.filter((id) => carModels.some((car) => car.id === id))
            : fallback.unlockedCars;
        const selectedCarId = unlockedCars.includes(parsed.selectedCarId) ? parsed.selectedCarId : unlockedCars[0];
        return {
            ...fallback,
            ...parsed,
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
