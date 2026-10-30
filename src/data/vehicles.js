// Vehicle body archetypes: the shape of a car as data. `createCar` (src/vehicles.js) builds the mesh from these,
// so a new silhouette is a new entry here instead of new code in the builder.
//
// Coordinates: x = across the car, y = up, z = along the car (+z is the front). Fractions are relative to the
// model's length (L) or width (W); `height` values are metres above the body's top edge.

export const BODY_ARCHETYPES = {
    coupe: {
        id: "coupe",
        // Side silhouette: where the hood ends and the trunk starts (fractions of L), and how far nose and tail drop.
        profile: { noseX: 0.3, tailX: 0.4, noseDrop: 0.5, tailDrop: 0.18 },
        cabin: { from: -0.3, to: 0.12, height: 0.42, rake: 0.1 },
        wheels: { track: 0.55, base: 0.32, radius: 0.42, y: -0.22 },
        features: [],
    },
    muscle: {
        id: "muscle",
        profile: { noseX: 0.3, tailX: 0.4, noseDrop: 0.5, tailDrop: 0.18 },
        cabin: { from: -0.32, to: 0.08, height: 0.4, rake: 0.08 },
        wheels: { track: 0.55, base: 0.32, radius: 0.42, y: -0.22 },
        features: ["hoodStripe"],
    },
    sport: {
        id: "sport",
        profile: { noseX: 0.3, tailX: 0.4, noseDrop: 0.5, tailDrop: 0.18 },
        cabin: { from: -0.22, to: 0.12, height: 0.3, rake: 0.14 },
        wheels: { track: 0.55, base: 0.32, radius: 0.42, y: -0.22 },
        features: ["spoiler"],
    },
    van: {
        id: "van",
        profile: { noseX: 0.42, tailX: 0.46, noseDrop: 0.5, tailDrop: 0.18 },
        cabin: { from: -0.44, to: 0.3, height: 0.66, rake: 0.03 },
        wheels: { track: 0.55, base: 0.32, radius: 0.42, y: -0.22 },
        features: [],
    },
};

const STD_WHEELS = { track: 0.55, base: 0.32, radius: 0.42, y: -0.22 };

// Everyday and work vehicles for the ambient traffic (see CIVILIAN_TYPES below).
Object.assign(BODY_ARCHETYPES, {
    hatchback: {
        id: "hatchback",
        profile: { noseX: 0.3, tailX: 0.46, noseDrop: 0.55, tailDrop: 0.1 },
        cabin: { from: -0.4, to: 0.12, height: 0.48, rake: 0.07 },
        wheels: STD_WHEELS,
        features: [],
    },
    sedan: {
        id: "sedan",
        profile: { noseX: 0.3, tailX: 0.34, noseDrop: 0.5, tailDrop: 0.3 },
        cabin: { from: -0.26, to: 0.1, height: 0.4, rake: 0.1 },
        wheels: STD_WHEELS,
        features: [],
    },
    wagon: {
        id: "wagon",
        profile: { noseX: 0.3, tailX: 0.44, noseDrop: 0.5, tailDrop: 0.08 },
        cabin: { from: -0.43, to: 0.12, height: 0.46, rake: 0.04 },
        wheels: STD_WHEELS,
        features: [],
    },
    limo: {
        id: "limo",
        profile: { noseX: 0.3, tailX: 0.3, noseDrop: 0.5, tailDrop: 0.2 },
        cabin: { from: -0.42, to: 0.16, height: 0.38, rake: 0.1 },
        wheels: { ...STD_WHEELS, base: 0.34 },
        features: [],
    },
    pickup: {
        id: "pickup",
        profile: { noseX: 0.32, tailX: 0.49, noseDrop: 0.5, tailDrop: 0 },
        cabin: { from: 0, to: 0.34, height: 0.42, rake: 0.1 },
        wheels: STD_WHEELS,
        features: ["pickupBed"],
    },
    minibus: {
        id: "minibus",
        profile: { noseX: 0.44, tailX: 0.48, noseDrop: 0.5, tailDrop: 0.18 },
        cabin: { from: -0.46, to: 0.36, height: 0.58, rake: 0.03 },
        wheels: STD_WHEELS,
        features: [],
    },
    bus: {
        id: "bus",
        profile: { noseX: 0.47, tailX: 0.49, noseDrop: 0.4, tailDrop: 0.1 },
        cabin: { from: -0.48, to: 0.47, height: 0.72, rake: 0.02 },
        wheels: { ...STD_WHEELS, base: 0.34 },
        features: [],
    },
    boxTruck: {
        id: "boxTruck",
        profile: { noseX: 0.46, tailX: 0.49, noseDrop: 0.45, tailDrop: 0 },
        cabin: { from: 0.16, to: 0.46, height: 0.5, rake: 0.06 },
        wheels: { ...STD_WHEELS, base: 0.33 },
        features: ["cargoBox"],
    },
    dumpTruck: {
        id: "dumpTruck",
        profile: { noseX: 0.46, tailX: 0.49, noseDrop: 0.45, tailDrop: 0 },
        cabin: { from: 0.2, to: 0.46, height: 0.5, rake: 0.05 },
        wheels: { ...STD_WHEELS, base: 0.33 },
        features: ["dumpBed", "exhaustStacks"],
    },
    scooter: {
        id: "scooter",
        profile: { noseX: 0.42, tailX: 0.38, noseDrop: 0.3, tailDrop: 0.3 },
        cabin: { from: 0.05, to: 0.25, height: 0.12, rake: 0.05 },
        wheels: { layout: "bike", track: 0, base: 0.36, radius: 0.3, y: -0.35, scale: 0.7 },
        features: ["rider"],
    },
});

// Police bodies.
Object.assign(BODY_ARCHETYPES, {
    suv: {
        id: "suv",
        profile: { noseX: 0.34, tailX: 0.46, noseDrop: 0.5, tailDrop: 0.06 },
        cabin: { from: -0.4, to: 0.16, height: 0.52, rake: 0.05 },
        wheels: STD_WHEELS,
        features: [],
    },
    swat: {
        id: "swat",
        profile: { noseX: 0.42, tailX: 0.48, noseDrop: 0.45, tailDrop: 0.02 },
        cabin: { from: -0.28, to: 0.3, height: 0.5, rake: 0.02 },
        wheels: { ...STD_WHEELS, base: 0.33 },
        features: [],
    },
    motorbike: {
        id: "motorbike",
        profile: { noseX: 0.4, tailX: 0.36, noseDrop: 0.4, tailDrop: 0.35 },
        cabin: { from: 0.1, to: 0.3, height: 0.16, rake: 0.06 },
        wheels: { layout: "bike", track: 0, base: 0.37, radius: 0.36, y: -0.3, scale: 0.85 },
        features: ["rider"],
    },
});

export const DEFAULT_ARCHETYPE = "coupe";

/** Archetype id of a car model. `roof` is the legacy name of the same field. */
export function archetypeId(model) {
    const id = model.body ?? model.roof;
    return BODY_ARCHETYPES[id] ? id : DEFAULT_ARCHETYPE;
}

export function archetypeFor(model) {
    return BODY_ARCHETYPES[archetypeId(model)];
}

/** Closed side contour of the lower body, centred on the car (x = along the car, y = up). */
export function sideContour(archetype, length, height) {
    const { noseX, tailX, noseDrop, tailDrop } = archetype.profile;
    return [
        [-length / 2, -height / 2],
        [length / 2, -height / 2],
        [length / 2, -height / 2 + height * noseDrop],
        [length * noseX, height / 2],
        [-length * tailX, height / 2],
        [-length / 2, height / 2 - height * tailDrop],
    ];
}

/** Wheel positions and steering flags (front wheels first, left before right). Bikes get two wheels on the centre line. */
export function wheelLayout(archetype, width, length) {
    const { track, base, radius, y, layout, scale } = archetype.wheels;
    if (layout === "bike") {
        return [
            { sx: 1, front: true, radius, scale, x: 0, y, z: length * base },
            { sx: 1, front: false, radius, scale, x: 0, y, z: -length * base },
        ];
    }
    return [
        [-1, 1, true],
        [1, 1, true],
        [-1, -1, false],
        [1, -1, false],
    ].map(([sx, sz, front]) => ({ sx, front, radius, x: sx * width * track, y, z: sz * length * base }));
}

// Dev gallery: existing bodies dressed with the new parts, to review shapes, lights and wheels side by side.
export const SHOWCASE_OVERRIDES = [
    { base: 0, model: { name: "Coupe Rallye", color: "#2f6fd6", features: ["roofRack", "lightBar", "bullBar"], wheelStyle: "fiveSpoke", lights: "slit" } },
    { base: 1, model: { name: "Muscle Flossen", color: "#c8362c", features: ["fins", "exhaustStacks"], wheelStyle: "turbine", lights: "quad", tireStyle: "fat" } },
    { base: 2, model: { name: "Sport GT", color: "#ff3fa4", features: ["spoilerGT", "hoodScoop"], wheelStyle: "neonRing", lights: "ledBar" } },
    { base: 3, model: { name: "Van Expedition", color: "#8a6a44", features: ["snorkel", "sideSteps", "roofRack"], wheelStyle: "disc", tireStyle: "fat", lights: "quad" } },
];

// ---------------------------------------------------------------------------------------------------
// Civilian traffic. Streets are 5.4 m wide, so nothing is wider than 2.3 m; buses and trucks are only long.

export const PALETTES = {
    downtown: ["#16181d", "#c8ccd2", "#8e1f2c", "#1d2f4f", "#e8e6e0", "#3a3f48"],
    industrial: ["#c9622b", "#d9a42a", "#6b747d", "#8a5a34", "#c4b09a", "#3b4046"],
    park: ["#4f8a52", "#e8dcc0", "#9ec7d9", "#f0b6c4", "#a8c97a", "#d99a5b"],
    harbor: ["#1c3a5e", "#2f7f8f", "#e9edf0", "#c8362c", "#6f8ea5", "#d2a24a"],
    taxi: ["#ffc23e", "#ffb300"],
    limo: ["#0e1014", "#1a1d24", "#f2f2f2"],
    bus: ["#2d6cb0", "#c8362c", "#3c8f5a", "#e7b43a"],
    hazard: ["#e8b923", "#d9822b", "#e8e6e0", "#c9622b"],
    news: ["#f2f2f2", "#d8433a", "#2d6cb0", "#e8e6e0"],
    icecream: ["#f7c6d9", "#f3e6b8", "#b8e3f5", "#f2f2f2"],
};

export const CIVILIAN_TYPES = {
    hatchback: { name: "Kleinwagen", body: "hatchback", length: 3.7, width: 1.8, height: 0.72, mass: 0.8, lights: ["default", "quad"], wheelStyles: ["disc", "fiveSpoke"], accessories: ["roofBox"] },
    sedan: { name: "Limousine", body: "sedan", length: 4.6, width: 1.9, height: 0.74, mass: 1, lights: ["default", "slit"], wheelStyles: ["disc", "turbine"], accessories: [] },
    taxi: { name: "Taxi", body: "sedan", length: 4.6, width: 1.9, height: 0.74, mass: 1, palette: "taxi", features: ["taxiSign"], accessories: [] },
    wagon: { name: "Kombi", body: "wagon", length: 4.8, width: 1.9, height: 0.78, mass: 1.1, lights: ["default", "slit"], accessories: ["roofRack", "roofBox", "surfboard"] },
    limo: { name: "Stretchlimo", body: "limo", length: 6, width: 1.95, height: 0.66, mass: 1.5, palette: "limo", lights: ["slit"], wheelStyles: ["fiveSpoke"], accessories: [] },
    pickup: { name: "Pickup", body: "pickup", length: 5, width: 2.05, height: 0.86, mass: 1.3, lights: ["default", "quad"], accessories: ["roofRack"], tireStyle: "fat" },
    serviceVan: { name: "Transporter", body: "van", length: 4.9, width: 2.05, height: 0.95, mass: 1.5, accessories: ["roofRack", "roofBox"] },
    minibus: { name: "Shuttle", body: "minibus", length: 5.4, width: 2.1, height: 1.05, mass: 1.7, accessories: ["roofBox"] },
    bus: { name: "Stadtbus", body: "bus", length: 7.5, width: 2.3, height: 1.3, mass: 2.5, palette: "bus", lights: ["ledBar"], accessories: [] },
    boxTruck: { name: "Kastenwagen", body: "boxTruck", length: 6.2, width: 2.25, height: 1, mass: 2, tireStyle: "fat", accessories: [] },
    dumpTruck: { name: "Muldenkipper", body: "dumpTruck", length: 6.6, width: 2.3, height: 1.1, mass: 2.7, palette: "hazard", tireStyle: "fat", accessories: [] },
    tow: { name: "Abschleppwagen", body: "pickup", length: 5.4, width: 2.1, height: 0.9, mass: 1.8, palette: "hazard", features: ["towBoom"], tireStyle: "fat", accessories: [] },
    newsVan: { name: "Nachrichtenwagen", body: "van", length: 4.9, width: 2.05, height: 0.95, mass: 1.5, palette: "news", features: ["newsDish"], accessories: [] },
    iceCream: { name: "Eiswagen", body: "van", length: 4.7, width: 2, height: 1, mass: 1.4, palette: "icecream", features: ["iceCreamCone"], accessories: [] },
    scooter: { name: "Roller", body: "scooter", length: 1.9, width: 0.8, height: 0.5, mass: 0.3, accessories: [] },
};

// Weighted fleets per district: who you meet where.
export const DISTRICT_FLEETS = {
    downtown: [["taxi", 4], ["sedan", 4], ["hatchback", 3], ["limo", 2], ["bus", 1], ["scooter", 2], ["newsVan", 1]],
    industrial: [["boxTruck", 3], ["dumpTruck", 2], ["pickup", 4], ["tow", 1], ["serviceVan", 3], ["sedan", 1]],
    park: [["wagon", 4], ["iceCream", 1], ["hatchback", 3], ["scooter", 1], ["minibus", 1], ["pickup", 1]],
    harbor: [["pickup", 3], ["wagon", 2], ["minibus", 2], ["boxTruck", 2], ["sedan", 1], ["serviceVan", 1]],
};

function pickFrom(list, rng) {
    return list[Math.floor(rng() * list.length) % list.length];
}

/** Multiplies the RGB channels of a "#rrggbb" colour (1 = unchanged). */
export function shadeColor(hex, factor) {
    const value = parseInt(hex.slice(1), 16);
    const channel = (shift) => Math.max(0, Math.min(255, Math.round(((value >> shift) & 255) * factor)));
    return "#" + [16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("");
}

/**
 * Picks a vehicle for ambient traffic: a weighted type for the district, a colour from the curated palette
 * (with a small brightness shift so a street of grey cars does not look cloned) and optional roof extras.
 * `rng` returns [0, 1) and can be seeded for tests.
 */
export function pickCivilian(districtId, rng = Math.random) {
    const fleet = DISTRICT_FLEETS[districtId] ?? DISTRICT_FLEETS.downtown;
    let roll = rng() * fleet.reduce((sum, [, weight]) => sum + weight, 0);
    let typeId = fleet[fleet.length - 1][0];
    for (const [id, weight] of fleet) {
        roll -= weight;
        if (roll <= 0) {
            typeId = id;
            break;
        }
    }
    return buildCivilian(typeId, districtId, rng);
}

/** Builds one civilian vehicle of a given type: palette colour, roof extras, light and wheel styles. */
export function buildCivilian(typeId, districtId, rng = Math.random) {
    const type = CIVILIAN_TYPES[typeId];
    const palette = PALETTES[type.palette ?? districtId] ?? PALETTES.downtown;
    const base = pickFrom(palette, rng);
    const color = shadeColor(base, 0.92 + rng() * 0.16);
    const features = [...(type.features ?? [])];
    if (type.accessories?.length && rng() < 0.35) features.push(pickFrom(type.accessories, rng));
    return {
        id: `civ-${typeId}`,
        type: typeId,
        name: type.name,
        body: type.body,
        length: type.length,
        width: type.width,
        height: type.height,
        mass: type.mass,
        color,
        trim: shadeColor(base, 0.22),
        features,
        lights: pickFrom(type.lights ?? ["default"], rng),
        wheelStyle: pickFrom(type.wheelStyles ?? ["disc"], rng),
        tireStyle: type.tireStyle,
    };
}

// ---------------------------------------------------------------------------------------------------
// Police looks. Stats stay in POLICE_UNITS (config.js); this is only what a unit looks like.
// `lightbar`: bar (roof), dome (single beacon), grille (front and rear strobes); `hidden` lights stay off until the
// unit starts a chase (unmarked cars).

export const POLICE_LOOKS = {
    patrol: [
        { id: "cruiser", name: "Patrol Cruiser", body: "sedan", length: 4.6, width: 1.9, height: 0.74, color: "#1b2433", trim: "#e8edf3", features: ["doorPanels"], lightbar: "bar" },
        { id: "interceptor", name: "Interceptor", body: "sport", length: 4.3, width: 1.9, height: 0.62, color: "#1c3f78", trim: "#0f1722", features: ["doorPanels"], lightbar: "grille", lights: "slit", minHeat: 3 },
    ],
    suv: [
        { id: "pursuit", name: "Pursuit SUV", body: "suv", length: 5, width: 2.15, height: 0.95, color: "#e9eef4", trim: "#182a46", features: ["bullBar", "roofRack"], lightbar: "bar", tireStyle: "fat" },
    ],
    van: [
        { id: "swat", name: "SWAT-Truck", body: "swat", length: 5.4, width: 2.3, height: 1.1, color: "#272d36", trim: "#0f1318", features: ["bullBar", "armorPlates", "sideSteps"], lightbar: "bar", tireStyle: "fat" },
    ],
    motorcycle: [
        { id: "bike", name: "Interceptor Bike", body: "motorbike", length: 2.5, width: 0.9, height: 0.55, color: "#f4f7fb", trim: "#18324f", lightbar: "dome" },
    ],
    unmarked: [
        { id: "unmarked", name: "Zivilstreife", body: "sedan", length: 4.5, width: 1.85, height: 0.72, colors: ["#2b2f36", "#4a5560", "#3a2f2f", "#26324a"], trim: "#101318", hidden: true, lightbar: "grille" },
    ],
};

/** Picks the look of a police unit; some looks only appear from a certain heat level (the Interceptor from 3). */
export function policeModelFor(unitType, heat = 0, rng = Math.random) {
    const looks = POLICE_LOOKS[unitType] ?? POLICE_LOOKS.patrol;
    const eligible = looks.filter((look) => (look.minHeat ?? 0) <= heat);
    const look = pickFrom(eligible.length ? eligible : looks, rng);
    return {
        ...look,
        id: `police-${unitType}-${look.id}`,
        unitType,
        color: look.color ?? pickFrom(look.colors, rng),
        features: [...(look.features ?? [])],
    };
}

// ---------------------------------------------------------------------------------------------------
// Race rivals: the field should look like different cars, not like the same car in two colours.

export const RIVAL_STYLES = [
    { name: "Rivale Rallye", color: "#79ffb3", features: ["roofRack", "bullBar"], wheelStyle: "fiveSpoke", lights: "slit" },
    { name: "Rivale GT", color: "#ff7ad9", features: ["spoilerGT", "hoodScoop"], wheelStyle: "neonRing", lights: "ledBar" },
    { name: "Rivale Muscle", color: "#ffb13c", features: ["fins", "exhaustStacks"], wheelStyle: "turbine", lights: "quad", tireStyle: "fat" },
    { name: "Rivale Street", color: "#4fc3ff", features: ["hoodScoop"], wheelStyle: "disc", lights: "default" },
];

function shuffled(list, rng) {
    const copy = [...list];
    for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
}

/** `count` rival models built on different bodies (as far as the base list allows) with different looks. */
export function pickRivalModels(baseModels, count, rng = Math.random) {
    const bases = shuffled(baseModels, rng);
    const styles = shuffled(RIVAL_STYLES, rng);
    return Array.from({ length: count }, (_, index) => ({
        ...bases[index % bases.length],
        ...styles[index % styles.length],
        trim: "#14181e",
    }));
}
