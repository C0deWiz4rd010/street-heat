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

/** Wheel positions and steering flags (front wheels first, left before right). */
export function wheelLayout(archetype, width, length) {
    const { track, base, radius, y } = archetype.wheels;
    return [
        [-1, 1, true],
        [1, 1, true],
        [-1, -1, false],
        [1, -1, false],
    ].map(([sx, sz, front]) => ({ sx, front, radius, x: sx * width * track, y, z: sz * length * base }));
}
