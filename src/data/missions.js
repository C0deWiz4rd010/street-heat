// Declarative mission data. Numbers can be scaled by stage: { base, perStage, cap } = base + min(cap, stageScale * perStage).
// Places: { poi: "id" } resolves to a point of interest, "anchor" to the district centre, otherwise { name, x, z }.

export const MISSION_CHAINS = {
    downtown: [
        {
            type: "delivery",
            title: "Downtown Warm-up",
            description: "Kurierfahrt durch die engen Straßenschluchten.",
            target: 1,
            timer: { base: 50, perStage: 4 },
            from: { name: "Courier Hub", x: 18, z: 40 },
            to: { name: "Skyline Drop", x: 47, z: 19 },
            maxRiskLevel: 3,
            bonus: { id: "quickFinish", label: "Tempo-Bonus", description: "Schließe früh ab.", target: 20, reward: 220 },
        },
        {
            type: "checkpoint",
            title: "Neon Line",
            description: "Nimm die Boulevard-Linie durch Downtown.",
            target: { base: 3, perStage: 1, cap: 2 },
            timer: { base: 46, perStage: 4 },
            route: true,
            bonus: { id: "noCrash", label: "Saubere Linie", description: "Ohne Einschlag bleiben.", target: 1, reward: 240 },
        },
        {
            type: "pursuit",
            title: "Blue Light Bait",
            description: "Zieh die Verfolger durch die Hochhauskanten.",
            target: { base: 3, perStage: 1 },
            timer: { base: 40, perStage: 4 },
            minimumHeat: { base: 2, perStage: 1, cap: 2 },
            bonus: { id: "highHeat", label: "Heißes Finale", description: "Mit Heat 3+ abschließen.", target: 3, reward: 280 },
        },
    ],
    industrial: [
        {
            type: "pickup",
            title: "Scrapyard Sweep",
            description: "Sichere Teile im Industriebezirk.",
            target: { base: 3, perStage: 1 },
            timer: { base: 54, perStage: 4 },
            to: "anchor",
            pickupSeed: 4,
            bonus: { id: "noRepair", label: "Werkstattverbot", description: "Keine Garage während des Auftrags.", target: 1, reward: 210 },
        },
        {
            type: "delivery",
            title: "Parts Run",
            description: "Bring den Werkstatt-Transfer aus dem Yard raus.",
            target: 1,
            timer: { base: 52, perStage: 4 },
            from: { poi: "yard" },
            to: { poi: "depot" },
            maxRiskLevel: 2,
            bonus: { id: "quickFinish", label: "Schichtende", description: "Unter Zeitdruck liefern.", target: 18, reward: 240 },
        },
        {
            type: "heist",
            title: "Foundry Grab",
            description: "Zieh heiße Ware aus dem Rostgürtel und bring sie raus.",
            target: 1,
            timer: { base: 48, perStage: 4 },
            from: { name: "Schmelzhof", x: -18, z: 22 },
            to: { poi: "safehouse" },
            minimumHeat: 3,
            maxRiskLevel: 3,
            bonus: { id: "noCrash", label: "Keine Dellen", description: "Ohne Einschlag rausfahren.", target: 1, reward: 300 },
        },
    ],
    park: [
        {
            type: "checkpoint",
            title: "Green Drift",
            description: "Zieh die Route über Wege und Wiesenlinien.",
            target: { base: 3, perStage: 1, cap: 2 },
            timer: { base: 50, perStage: 4 },
            route: true,
            bonus: { id: "shortcut", label: "Shortcut-Line", description: "Nutze Parkwege mehrfach.", target: 2, reward: 230 },
        },
        {
            type: "pickup",
            title: "Nitro Bloom",
            description: "Räum mobile Caches im Parkbecken ab.",
            target: { base: 3, perStage: 1 },
            timer: { base: 48, perStage: 4 },
            to: "anchor",
            pickupSeed: 4,
            bonus: { id: "shortcut", label: "Pfadfinder", description: "Bleib über die Park-Cuts in Bewegung.", target: 2, reward: 220 },
        },
        {
            type: "escape",
            title: "Quiet Exit",
            description: "Bring den Run sauber zur Garage, bevor Heat zuschnappt.",
            target: 1,
            timer: { base: 38, perStage: 4 },
            to: { poi: "garage" },
            minimumHeat: { base: 1, perStage: 1, cap: 2 },
            maxRiskLevel: 2,
            bonus: { id: "noCrash", label: "Soft Touch", description: "Ohne Einschlag zur Ausfahrt.", target: 1, reward: 260 },
        },
    ],
    harbor: [
        {
            type: "delivery",
            title: "Dock Runner",
            description: "Schmuggelware aus der Hafenzone herausziehen.",
            target: 1,
            timer: { base: 48, perStage: 4 },
            from: { name: "Pier Safe", x: -44, z: -19 },
            to: { poi: "safehouse" },
            minimumHeat: 2,
            maxRiskLevel: 3,
            bonus: { id: "highHeat", label: "Heiße Route", description: "Mit Heat 3+ abgeben.", target: 3, reward: 280 },
        },
        {
            type: "checkpoint",
            title: "Crane Loop",
            description: "Spring die Dock-Linie von Rampe zu Rampe ab.",
            target: { base: 3, perStage: 1, cap: 2 },
            timer: { base: 44, perStage: 4 },
            route: true,
            bonus: { id: "quickFinish", label: "Schnelle Uebergabe", description: "Mit Zeitreserve beenden.", target: 16, reward: 250 },
        },
        {
            type: "escape",
            title: "Breakwater Exit",
            description: "Schüttel den Druck ab und bring den Run heim.",
            target: 1,
            timer: { base: 36, perStage: 4 },
            to: { poi: "safehouse" },
            minimumHeat: 3,
            bonus: { id: "highHeat", label: "Harter Cut", description: "Mit Heat 4+ rauskommen.", target: 4, reward: 320 },
        },
    ],
};

export const BOSS_MISSIONS = [
    {
        type: "bossBlockade",
        title: "Boss: Hafenblockade",
        description: "Spreng die Sperre auf und finde den Ausweg durch die Docks.",
        target: 2,
        timer: 60,
        to: { name: "Breakwater Gate", x: -44, z: -14 },
        minimumHeat: 4,
        isBoss: true,
        bossType: "harborBlockade",
        districtId: "harbor",
        maxRiskLevel: 3,
        bonus: { id: "noCrash", label: "Sauberer Durchbruch", description: "Ohne Einschlag durch die Blockade.", target: 1, reward: 430 },
    },
    {
        type: "bossArmored",
        title: "Boss: Gepanzerter Transporter",
        description: "Brich den Konvoi auf, sichere die Ladung und bring sie heim.",
        target: 1,
        timer: 64,
        to: { poi: "safehouse" },
        minimumHeat: 4,
        isBoss: true,
        bossType: "armoredTransporter",
        districtId: "industrial",
        maxRiskLevel: 3,
        bonus: { id: "highHeat", label: "Großwild", description: "Mit Heat 4+ abgeben.", target: 4, reward: 420 },
    },
    {
        type: "bossHeli",
        title: "Boss: Helikopterjagd",
        description: "Halte die Jagd aus, dann tauch am Safehouse ab.",
        target: 1,
        timer: 58,
        to: { poi: "safehouse" },
        minimumHeat: 5,
        isBoss: true,
        bossType: "helicopterHunt",
        districtId: "downtown",
        maxRiskLevel: 2,
        bonus: { id: "quickFinish", label: "Aus dem Licht", description: "Finde früh den Ausstieg.", target: 24, reward: 400 },
    },
];

// Every third regular mission rolls one of these; the reward multiplier applies to the cash-out.
export const MISSION_MODIFIERS = [
    { id: "nightOnly", label: "Nachtfahrt", reward: 1.25 },
    { id: "noBrake", label: "Keine Bremse", reward: 1.35 },
    { id: "forcedPursuit", label: "Erzwungene Verfolgung", reward: 1.3 },
    { id: "timeAttack", label: "Zeitangriff", reward: 1.4 },
];

export function scaleValue(value, stageScale) {
    if (value === undefined || value === null || typeof value === "number") return value;
    return value.base + Math.min(value.cap ?? Infinity, stageScale * (value.perStage ?? 1));
}

/**
 * Turns a declarative entry into the config setMission() consumes.
 * `helpers`: { getPoi(id), anchor(), route(count) }.
 */
export function resolveMission(entry, stage, helpers) {
    const stageScale = Math.floor((stage - 1) / 3);
    const place = (spec) => {
        if (!spec) return undefined;
        if (spec === "anchor") return helpers.anchor();
        if (spec.poi) return helpers.getPoi(spec.poi);
        return { ...spec };
    };
    const { route, from, to, target, timer, minimumHeat, ...rest } = entry;
    const resolvedTarget = scaleValue(target, stageScale);
    const config = { ...rest, target: resolvedTarget, timer: typeof timer === "number" ? timer : timer.base + stageScale * timer.perStage };
    if (minimumHeat !== undefined) config.minimumHeat = scaleValue(minimumHeat, stageScale);
    if (from) config.from = place(from);
    if (to) config.to = place(to);
    if (route) config.route = helpers.route(resolvedTarget);
    return config;
}
