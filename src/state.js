import { CAR_MODELS, CONTRACTS, DISTRICTS, UPGRADES, WEATHER_MODES } from "./config.js";
import { createDefaultProfile, loadProfile } from "./save.js";

export function createInitialState() {
    const profile = loadProfile(CAR_MODELS, UPGRADES);
    const playerModelIndex = Math.max(0, CAR_MODELS.findIndex((car) => car.id === profile.selectedCarId));
    return {
        score: 0,
        bestScore: Math.max(profile.bestScore, loadLegacyBestScore()),
        cash: profile.cash,
        running: true,
        paused: true,
        screen: "menu",
        playerModelIndex,
        unlockedCars: [...profile.unlockedCars],
        achievements: [...profile.achievements],
        lifetime: { ...profile.lifetime },
        profile,
        player: {
            x: 0,
            z: 0,
            rotation: 0,
            speed: 0,
            health: 100,
            nitro: 18,
            drift: 0,
            inShortcut: false,
        },
        wanted: {
            level: 0,
            status: "CLEAR",
            decay: 0,
            tier: "CLEAR",
            emp: 0,
        },
        mission: {
            stage: 1,
            type: "pickup",
            target: 4,
            progress: 0,
            timer: 68,
            startTimer: 68,
            from: null,
            to: null,
            cargo: false,
            route: [],
            routeIndex: 0,
            districtId: DISTRICTS[0].id,
            districtName: DISTRICTS[0].name,
            chainName: "Downtown Warm-up",
            chainStep: 1,
            chainLength: 3,
            description: "Sammle Beute und bleib in Bewegung.",
            collisionCount: 0,
            repairCount: 0,
            shortcutEntries: 0,
            turnInReady: false,
            cashoutMultiplier: 1,
            riskLevel: 0,
            maxRiskLevel: 2,
            isBoss: false,
            bossType: null,
            bonus: {
                id: "quickFinish",
                label: "Tempo-Bonus",
                description: "Schliesse den Auftrag schnell ab.",
                target: 18,
                reward: 180,
                progress: 0,
                completed: false,
            },
        },
        combo: {
            chain: 0,
            multiplier: 1,
            timer: 0,
            best: 0,
            driftBank: 0,
            driftScore: 0,
        },
        contract: {
            id: CONTRACTS[0].id,
            progress: 0,
            completed: false,
            claimed: false,
        },
        upgrades: { ...createDefaultProfile(CAR_MODELS, UPGRADES).upgrades, ...profile.upgrades },
        stats: {
            pickups: 0,
            missions: 0,
            missionsLowHeat: 0,
            roadblocks: 0,
            closeCalls: 0,
            highHeatCloseCalls: 0,
            propsDestroyed: 0,
            events: 0,
            driftScore: 0,
        },
        helicopter: {
            active: false,
            x: 0,
            z: 0,
            angle: 0,
            pressure: 0,
            cooldown: 0,
        },
        district: DISTRICTS[0],
        weather: {
            mode: "clear",
            label: WEATHER_MODES.clear.label,
            timer: 32,
            intensity: 0,
        },
        time: {
            phase: "day",
            label: "Tag",
            timer: 70,
            cycle: 0,
        },
        worldEvent: {
            active: false,
            label: "Ruhige Strassen",
            timer: 18,
            x: 0,
            z: 0,
        },
        debug: {
            enabled: false,
            fps: 0,
            entities: 0,
        },
        statusMessage: "Direkt im Spiel. Fahre los.",
        statusTimer: 0,
        actionPrompt: "",
        cameraShake: 0,
        garageCooldown: 0,
        safehouseCooldown: 0,
        roadblockCooldown: 0,
    };
}

function loadLegacyBestScore() {
    try {
        return Number(window.localStorage.getItem("neon-pursuit-best") || 0);
    } catch {
        return 0;
    }
}
