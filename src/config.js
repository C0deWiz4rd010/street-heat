export const CONFIG = {
    map: {
        size: 128,
        streets: [-52, -26, 0, 26, 52],
        blockCenters: [-39, -13, 13, 39],
        streetWidth: 5.4,
        blockSize: 19,
        poiRadius: 5.8,
    },
    player: {
        radius: 1.25,
        maxHealth: 100,
        nitroMax: 100,
        nitroRegen: 5,
        nitroBurn: 24,
        nitroBonus: 8,
        reverseFactor: 0.45,
    },
    traffic: {
        startCount: 18,
        collisionRadius: 2.45,
    },
    police: {
        maxCount: 16,
        spawnDistance: 34,
        searchDistance: 38,
        collisionRadius: 2.35,
        decayDelay: 7,
        roadblockLevel: 3,
        roadblockMax: 4,
        roadblockCooldown: 8,
    },
    pickups: {
        startCount: 20,
        maxCount: 22,
        collectRadius: 2.65,
        respawnRate: 0.7,
    },
    camera: {
        height: 26,
        backOffset: 10,
        followLerp: 3.6,
        fovBase: 56,
        fovMax: 68,
        // Heat and nearby cops raise the camera so more of the chase stays visible.
        zoomPerHeat: 0.9,
        zoomPerCop: 0.5,
        zoomMax: 5,
        modes: {
            near: { height: 20, backOffset: 8 },
            normal: { height: 26, backOffset: 10 },
            far: { height: 33, backOffset: 13 },
        },
    },
    ui: {
        minimapRange: 74,
    },
};

// Police unit tuning. chaseSpeed + chaseSpeedPerHeat * heat (+ nightBonus at night) while chasing.
// Combo names by chain length (highest matching tier is shown next to the timer bar).
export const COMBO_TIERS = [
    { chain: 4, name: "Nice" },
    { chain: 8, name: "Hot" },
    { chain: 14, name: "Blazing" },
    { chain: 22, name: "Insane" },
    { chain: 32, name: "Legendary" },
];

export const REPUTATION_TIERS = [
    { name: "Unbekannt", at: 0, cashBonus: 0, unlock: null },
    { name: "Bekannt", at: 120, cashBonus: 0.05, unlock: "Lackfarbe Neon-Pink" },
    { name: "Respektiert", at: 320, cashBonus: 0.1, unlock: "Bezirks-Contract" },
    { name: "Straßenlegende", at: 700, cashBonus: 0.15, unlock: "Lackfarbe Chrom" },
    { name: "Bezirkskönig", at: 1400, cashBonus: 0.2, unlock: "Kosmetik Unterboden-Neon" },
];

// Paint jobs for the player car. `unlock` names an entry in profile.unlocks (reputation rewards).
export const PAINTS = [
    { id: "default", label: "Original", color: null, unlock: null },
    { id: "white", label: "Weiß", color: "#e9edf2", unlock: null },
    { id: "black", label: "Schwarz", color: "#14171c", unlock: null },
    { id: "blue", label: "Blau", color: "#2f6fd6", unlock: null },
    { id: "pink", label: "Neon-Pink", color: "#ff3fa4", unlock: "Lackfarbe Neon-Pink" },
    { id: "chrome", label: "Chrom", color: "#c9d2dc", unlock: "Lackfarbe Chrom", chrome: true },
];

export const REPUTATION_GAINS = { mission: 40, boss: 100, event: 15, tag: 10, tagSet: 80 };
export const TAGS_PER_DISTRICT = 10;

export const RACE = {
    checkpoints: 4,
    radius: 7,
    timeLimit: 85,
    rivals: 2,
    rivalSpeed: 12,
    payouts: [
        { cash: 600, score: 900, rep: 70 },
        { cash: 300, score: 450, rep: 35 },
        { cash: 100, score: 150, rep: 10 },
    ],
};

export const POLICE_UNITS = {
    patrol: { turnRate: 2.35, mass: 1.1, damageFactor: 0.9, wallSpeedFactor: 0.7, hitSpeedFactor: 0.42, chaseSpeed: 11.5, chaseSpeedPerHeat: 1.4, nightBonus: 0.8, idleSpeed: 8 },
    unmarked: { turnRate: 2.35, mass: 1.0, damageFactor: 0.85, wallSpeedFactor: 0.7, hitSpeedFactor: 0.42, chaseSpeed: 11.8, chaseSpeedPerHeat: 1.4, nightBonus: 0.8, idleSpeed: 8 },
    suv: { turnRate: 1.85, mass: 1.65, damageFactor: 1.1, wallSpeedFactor: 0.78, hitSpeedFactor: 0.42, chaseSpeed: 10.8, chaseSpeedPerHeat: 1.1, nightBonus: 0, idleSpeed: 8 },
    van: { turnRate: 1.55, mass: 1.9, damageFactor: 1.2, wallSpeedFactor: 0.7, hitSpeedFactor: 0.42, chaseSpeed: 9.2, chaseSpeedPerHeat: 0.85, nightBonus: 0, idleSpeed: 8 },
    motorcycle: { turnRate: 3.2, mass: 0.62, damageFactor: 0.7, wallSpeedFactor: 0.62, hitSpeedFactor: 0.12, chaseSpeed: 13.5, chaseSpeedPerHeat: 1.35, nightBonus: 0.8, idleSpeed: 9.5 },
};

export const VEHICLE_PHYSICS = {
    engineSpeedPerLevel: 0.12,
    accelPerLevel: 0.13,
    turnPerGripLevel: 0.075,
    brakeBase: 9.5,
    brakePerLevel: 2.2,
    coastBase: 2.4,
    coastPerLevel: 0.4,
    handbrakeBase: 16,
    handbrakePerLevel: 2.4,
    reverseAccelShare: 0.45,
    gripBase: 0.76,
    gripPerLevel: 0.038,
    driftGripBase: 0.18,
    driftGripPerLevel: 0.055,
    lateralDecayRate: 60,
    gripBlendTime: 0.075,
    powerDriftSlip: 3.5,
    powerDriftBuild: 2.8,
    handbrakeDriftBuild: 4.5,
    driftDecay: 2.8,
    trailBrakeTurn: 0.35,
    trailBrakeRearGrip: 0.06,
    throttleDriftSlip: 0.2,
    maxSubstep: 0.5,
};

// Ground profiles: grip scales lateral grip, rolling is extra drag (m/s^2), speed caps top speed and acceleration.
export const SURFACES = {
    road: { id: "road", grip: 1, rolling: 0, speed: 1 },
    paving: { id: "paving", grip: 0.96, rolling: 0.2, speed: 0.98 },
    gravel: { id: "gravel", grip: 0.84, rolling: 1.6, speed: 0.92 },
    dock: { id: "dock", grip: 0.9, rolling: 0.6, speed: 0.95 },
    grass: { id: "grass", grip: 0.72, rolling: 3.2, speed: 0.78 },
};

export const HEAT_TIERS = [
    { level: 0, name: "CLEAR", score: 1, police: 0, tactics: "Patrouille" },
    { level: 1, name: "WATCH", score: 1.08, police: 2, tactics: "Sichtung" },
    { level: 2, name: "PURSUIT", score: 1.18, police: 4, tactics: "Direkte Verfolgung" },
    { level: 3, name: "LOCKDOWN", score: 1.34, police: 7, tactics: "Roadblocks" },
    { level: 4, name: "SWAT", score: 1.55, police: 10, tactics: "Rammen und Spikes" },
    { level: 5, name: "MAYHEM", score: 1.8, police: 14, tactics: "Alles auf dich" },
];

export const DISTRICTS = [
    {
        id: "harbor",
        name: "Hafenzone",
        x: -1,
        z: -1,
        color: "#5a9bb0",
        bonus: "High-Risk-Events",
        traffic: 0.9,
        cashMultiplier: 1,
        healMultiplier: 1,
        nitroRegenBonus: 0,
        shortcutBoost: 0,
        eventRate: 1.35,
        eventCashMultiplier: 1.18,
        eventScoreMultiplier: 1.22,
        eventHeatBonus: 1,
        pickupWeights: { cash: 0.24, repair: 0.11, nitro: 0.14, intel: 0.15, parts: 0.12, emp: 0.24 },
        eventWeights: { cashDrop: 0.1, partsCache: 0.08, hotVan: 0.3, roadClosure: 0.14, vipConvoy: 0.22, streetRace: 0.08, hiddenCache: 0.08 },
    },
    {
        id: "park",
        name: "Park",
        x: 1,
        z: -1,
        color: "#78c86c",
        bonus: "Nitro und Abkürzungen",
        traffic: 0.45,
        cashMultiplier: 1,
        healMultiplier: 1,
        nitroRegenBonus: 1.8,
        shortcutBoost: 2.1,
        eventRate: 0.92,
        eventCashMultiplier: 1,
        eventScoreMultiplier: 1,
        eventHeatBonus: 0,
        // Phase 6.4: off-road penalty on grass — stay on the streets/shortcuts
        offRoadPenalty: true,
        offRoadFactor: 0.78,
        pickupWeights: { cash: 0.17, repair: 0.1, nitro: 0.39, intel: 0.12, parts: 0.06, emp: 0.16 },
        eventWeights: { cashDrop: 0.18, partsCache: 0.12, hotVan: 0.08, roadClosure: 0.06, vipConvoy: 0.08, streetRace: 0.28, hiddenCache: 0.2 },
    },
    {
        id: "industrial",
        name: "Industrie",
        x: -1,
        z: 1,
        color: "#d39a54",
        bonus: "Teile und Repair",
        traffic: 1.1,
        cashMultiplier: 1,
        healMultiplier: 1.35,
        nitroRegenBonus: 0,
        shortcutBoost: 0,
        eventRate: 1,
        eventCashMultiplier: 1,
        eventScoreMultiplier: 1,
        eventHeatBonus: 0,
        pickupWeights: { cash: 0.14, repair: 0.26, nitro: 0.12, intel: 0.1, parts: 0.3, emp: 0.08 },
        eventWeights: { cashDrop: 0.1, partsCache: 0.26, hotVan: 0.18, roadClosure: 0.24, vipConvoy: 0.06, streetRace: 0.04, hiddenCache: 0.12 },
    },
    {
        id: "downtown",
        name: "Downtown",
        x: 1,
        z: 1,
        color: "#6ec3ff",
        bonus: "Cash-Bonus",
        traffic: 1.55,
        cashMultiplier: 1.28,
        healMultiplier: 1,
        nitroRegenBonus: 0,
        shortcutBoost: 0,
        eventRate: 1.04,
        eventCashMultiplier: 1.08,
        eventScoreMultiplier: 1.08,
        eventHeatBonus: 0,
        pickupWeights: { cash: 0.34, repair: 0.11, nitro: 0.14, intel: 0.13, parts: 0.14, emp: 0.14 },
        eventWeights: { cashDrop: 0.24, partsCache: 0.08, hotVan: 0.18, roadClosure: 0.08, vipConvoy: 0.18, streetRace: 0.14, hiddenCache: 0.1 },
    },
];

// Extra contracts that unlock with a district's reputation tier 2.
export const DISTRICT_CONTRACTS = [
    { id: "tagsDowntown", district: "downtown", label: "Downtown-Writer", description: "Sprühe 3 Graffiti-Tags in Downtown.", metric: "tagsRun", target: 3, reward: 520 },
    { id: "tagsIndustrial", district: "industrial", label: "Rost-Writer", description: "Sprühe 3 Graffiti-Tags im Industriebezirk.", metric: "tagsRun", target: 3, reward: 520 },
    { id: "tagsPark", district: "park", label: "Park-Writer", description: "Sprühe 3 Graffiti-Tags im Park.", metric: "tagsRun", target: 3, reward: 520 },
    { id: "tagsHarbor", district: "harbor", label: "Hafen-Writer", description: "Sprühe 3 Graffiti-Tags im Hafen.", metric: "tagsRun", target: 3, reward: 520 },
];

export const WEATHER_MODES = {
    clear: { label: "Klar", grip: 1, visibility: 1, color: "#111720" },
    rain: { label: "Regen", grip: 0.82, visibility: 0.92, color: "#101924" },
    fog: { label: "Nebel", grip: 0.94, visibility: 0.72, color: "#18202a" },
    storm: { label: "Gewitter", grip: 0.86, visibility: 0.84, color: "#0d1520" },
};

export const WORLD_EVENTS = [
    { id: "cashDrop", label: "Cash Drop", color: "#ffc64d", score: 500, cash: 260, heat: 1, kind: "pickup" },
    { id: "partsCache", label: "Teilelager", color: "#c9a5ff", score: 380, cash: 120, heal: 24, heat: 0, kind: "pickup" },
    { id: "hotVan", label: "Geldtransporter", color: "#ff6a4f", score: 760, cash: 420, heat: 2, kind: "convoy", speed: 5.4 },
    { id: "roadClosure", label: "Straßensperrung", color: "#ff9c45", score: 560, cash: 280, heat: 2, kind: "closure" },
    { id: "vipConvoy", label: "VIP-Konvoi", color: "#7fd6ff", score: 920, cash: 520, heat: 3, kind: "convoy", speed: 6.2 },
    { id: "streetRace", label: "Illegales Rennen", color: "#79ffb3", score: 700, cash: 340, heat: 2, kind: "race", speed: 8.1 },
    { id: "hiddenCache", label: "Versteckte Teilekiste", color: "#b988ff", score: 460, cash: 150, heal: 18, heat: 0, kind: "stash" },
];

export const CONTRACTS = [
    {
        id: "cleanRun",
        label: "Saubere Flucht",
        description: "Schließe 2 Missionen mit Heat 2 oder niedriger ab.",
        metric: "missionsLowHeat",
        target: 2,
        reward: 420,
    },
    {
        id: "chaosDriver",
        label: "Chaosfahrer",
        description: "Zerlege 8 Props in einem Run.",
        metric: "propsDestroyed",
        target: 8,
        reward: 360,
    },
    {
        id: "heatSurfer",
        label: "Heat Surfer",
        description: "Sammle 5 Close-Calls bei Heat 3+.",
        metric: "highHeatCloseCalls",
        target: 5,
        reward: 500,
    },
    {
        id: "eventRunner",
        label: "Event Runner",
        description: "Sichere 2 Welt-Events in einem Run.",
        metric: "events",
        target: 2,
        reward: 460,
    },
];

export const ACHIEVEMENTS = [
    { id: "firstMission", label: "Erster Auftrag", description: "Schließe deine erste Mission ab.", metric: "lifetimeMissions", target: 1, reward: 250 },
    { id: "collector", label: "Sammler", description: "Sammle 30 Pickups insgesamt.", metric: "lifetimePickups", target: 30, reward: 300 },
    { id: "demolition", label: "Abrissbirne", description: "Zerstöre 25 Props insgesamt.", metric: "lifetimeProps", target: 25, reward: 360 },
    { id: "highRoller", label: "High Roller", description: "Erreiche 10.000 Bestscore.", metric: "bestScore", target: 10000, reward: 600 },
    { id: "fullGarage", label: "Fuhrpark", description: "Schalte alle Autos frei.", metric: "unlockedCars", target: 4, reward: 900 },
];

export const UPGRADES = {
    engine: {
        label: "Motor",
        max: 4,
        baseCost: 420,
        effect: "Mehr Tempo und Beschleunigung",
    },
    armor: {
        label: "Panzerung",
        max: 4,
        baseCost: 390,
        effect: "Mehr Karosserie und weniger Crash-Schaden",
    },
    nitro: {
        label: "Nitro",
        max: 4,
        baseCost: 360,
        effect: "Größerer Tank und stärkerer Boost",
    },
    grip: {
        label: "Grip",
        max: 4,
        baseCost: 330,
        effect: "Stabileres Driften und besseres Bremsen",
    },
};

export const CAR_MODELS = [
    {
        id: "comet",
        name: "Comet",
        description: "Ausgewogener Starter mit gutem Driftfenster.",
        unlockCost: 0,
        color: "#e94d41",
        trim: "#151a21",
        length: 4.2,
        width: 2.0,
        height: 0.72,
        maxSpeed: 19,
        acceleration: 25,
        turn: 3.7,
        roof: "coupe",
        mass: 1.0,
        driftThreshold: 0.38,
        brakeFactor: 0.68,
        torquePeak: 0.45,
        gripBalance: 0,
        weightTransfer: 1.0,
        driftSlip: 1.0,
        enginePitchBase: 60,
    },
    {
        id: "bulldog",
        name: "Bulldog",
        description: "Schwerer Muscle-Wagen, prallt Polizei weg und hält mehr aus.",
        unlockCost: 9000,
        color: "#ffb13c",
        trim: "#252015",
        length: 4.9,
        width: 2.22,
        height: 0.86,
        maxSpeed: 16.5,
        acceleration: 20,
        turn: 2.9,
        roof: "muscle",
        mass: 1.65,
        driftThreshold: 0.55,
        brakeFactor: 0.52,
        torquePeak: 0.35,
        gripBalance: 0.3,
        weightTransfer: 0.6,
        driftSlip: 1.15,
        enginePitchBase: 48,
    },
    {
        id: "needle",
        name: "Needle",
        description: "Sehr schnell und leicht — explosiv, aber empfindlich.",
        unlockCost: 14000,
        color: "#4fc3ff",
        trim: "#0f2330",
        length: 3.75,
        width: 1.82,
        height: 0.58,
        maxSpeed: 24,
        acceleration: 32,
        turn: 4.3,
        roof: "sport",
        mass: 0.72,
        driftThreshold: 0.28,
        brakeFactor: 0.82,
        torquePeak: 0.55,
        gripBalance: -0.4,
        weightTransfer: 1.35,
        driftSlip: 0.8,
        enginePitchBase: 78,
    },
    {
        id: "mule",
        name: "Mule",
        description: "Langsam, aber stabil — verzeiht Fehler und räumt alles ab.",
        unlockCost: 11000,
        color: "#76d18f",
        trim: "#172116",
        length: 5.4,
        width: 2.25,
        height: 1.05,
        maxSpeed: 13.5,
        acceleration: 17,
        turn: 2.6,
        roof: "van",
        mass: 1.9,
        driftThreshold: 0.62,
        brakeFactor: 0.44,
        torquePeak: 0.30,
        gripBalance: 0.5,
        weightTransfer: 0.4,
        driftSlip: 1.3,
        enginePitchBase: 42,
    },
];

export const PICKUP_TYPES = {
    cash: { color: "#ffc64d", score: 120, cash: 60, wanted: 1, label: "Cash" },
    repair: { color: "#57d68d", score: 90, heal: 24, wanted: 0, label: "Repair" },
    intel: { color: "#63c8ff", score: 160, wanted: -1, label: "Scanner" },
    nitro: { color: "#ff6a4f", score: 120, nitro: 48, wanted: 0, label: "Nitro" },
    parts: { color: "#c9a5ff", score: 140, cash: 35, heal: 10, wanted: 0, label: "Teile" },
    emp: { color: "#f7fbff", score: 180, emp: true, wanted: -1, label: "EMP" },
};

export const POIS = [
    { id: "safehouse", name: "Safehouse", x: -39, z: -39, color: "#57d68d" },
    { id: "garage", name: "Garage", x: 39, z: -39, color: "#ffc64d" },
    { id: "precinct", name: "Precinct", x: -39, z: 39, color: "#63c8ff" },
    { id: "depot", name: "Depot", x: 39, z: 13, color: "#ff6a4f" },
    { id: "fuel", name: "Tankstelle", x: 13, z: 39, color: "#fff08a" },
    { id: "yard", name: "Baustelle", x: -13, z: 13, color: "#c9a5ff" },
];

CONTRACTS.push(...DISTRICT_CONTRACTS);
