import * as THREE from "three";

// Geometry-only parts library for the car builder (src/vehicles.js). Every builder returns plain
// geometries sorted by material group, so a whole car can be merged into a few meshes:
//   paint = body colour, trim = roof/wing colour, dark = rubber and bars, accent = stripes,
//   head = front lights (emissive), tail = rear lights (emissive, brake light).
// Coordinates: x across, y up, z along the car (+z is the front).

/** A box as non-indexed geometry (mergeable with extrusions), already moved into place. */
export function box(size, position) {
    return new THREE.BoxGeometry(size.x, size.y, size.z).toNonIndexed().translate(position.x, position.y, position.z);
}

/** A cylinder (vertical by default) as non-indexed geometry. */
export function cylinder(radius, height, position, segments = 10, tilt = { x: 0, z: 0 }) {
    const geometry = new THREE.CylinderGeometry(radius, radius, height, segments).toNonIndexed();
    if (tilt.x) geometry.rotateX(tilt.x);
    if (tilt.z) geometry.rotateZ(tilt.z);
    return geometry.translate(position.x, position.y, position.z);
}

const both = [-1, 1];

/** Shared measurements every part builder needs. */
export function partContext(model, archetype) {
    const L = model.length;
    const W = model.width;
    const H = model.height;
    const cabin = archetype.cabin;
    const roofLength = Math.max(0.4, (cabin.to - cabin.from) * L - cabin.rake * L * 1.9);
    const roofZ = ((cabin.from + cabin.to) / 2) * L - cabin.rake * L * 0.1;
    const roofY = H / 2 + cabin.height + 0.02;
    return { L, W, H, cabin, roofLength, roofZ, roofY };
}

/** Body features. Each returns { group: [geometry, ...] }. */
export const PARTS = {
    spoiler({ L, W, H }) {
        return {
            trim: [
                box({ x: W * 0.94, y: 0.06, z: 0.38 }, { x: 0, y: H / 2 + 0.32, z: -L * 0.46 }),
                ...both.map((side) => box({ x: 0.06, y: 0.28, z: 0.3 }, { x: side * W * 0.38, y: H / 2 + 0.16, z: -L * 0.46 })),
            ],
        };
    },
    spoilerGT({ L, W, H }) {
        return {
            trim: [
                box({ x: W * 1.04, y: 0.07, z: 0.5 }, { x: 0, y: H / 2 + 0.56, z: -L * 0.5 }),
                ...both.map((side) => box({ x: 0.07, y: 0.5, z: 0.36 }, { x: side * W * 0.4, y: H / 2 + 0.3, z: -L * 0.5 })),
            ],
        };
    },
    hoodStripe({ L, W, H }) {
        return { accent: [box({ x: W * 0.36, y: 0.1, z: L * 0.22 }, { x: 0, y: H / 2 + 0.05, z: L * 0.2 })] };
    },
    hoodScoop({ L, W, H }) {
        return { paint: [box({ x: W * 0.3, y: 0.14, z: L * 0.16 }, { x: 0, y: H / 2 + 0.07, z: L * 0.2 })] };
    },
    roofRack({ W, roofLength, roofZ, roofY }) {
        const y = roofY + 0.08;
        return {
            dark: [
                ...both.map((side) => box({ x: 0.05, y: 0.05, z: roofLength * 0.92 }, { x: side * W * 0.34, y, z: roofZ })),
                ...[-0.35, 0, 0.35].map((k) => box({ x: W * 0.7, y: 0.05, z: 0.06 }, { x: 0, y: y + 0.04, z: roofZ + k * roofLength })),
            ],
        };
    },
    lightBar({ W, roofLength, roofZ, roofY }) {
        const z = roofZ + roofLength * 0.42;
        return {
            dark: [box({ x: W * 0.6, y: 0.1, z: 0.16 }, { x: 0, y: roofY + 0.09, z })],
            head: [box({ x: W * 0.56, y: 0.06, z: 0.05 }, { x: 0, y: roofY + 0.09, z: z + 0.1 })],
        };
    },
    bullBar({ L, W, H }) {
        return {
            dark: [
                ...both.map((side) => box({ x: 0.08, y: 0.4, z: 0.08 }, { x: side * W * 0.3, y: -H / 2 + 0.3, z: L / 2 + 0.2 })),
                box({ x: W * 0.7, y: 0.08, z: 0.08 }, { x: 0, y: -H / 2 + 0.5, z: L / 2 + 0.2 }),
                box({ x: W * 0.8, y: 0.12, z: 0.1 }, { x: 0, y: -H / 2 + 0.2, z: L / 2 + 0.2 }),
            ],
        };
    },
    fins({ L, W, H }) {
        return { paint: both.map((side) => box({ x: 0.08, y: 0.42, z: 0.95 }, { x: side * (W / 2 - 0.04), y: H / 2 + 0.2, z: -L * 0.36 })) };
    },
    exhaustStacks({ L, W, H }) {
        return { dark: both.map((side) => cylinder(0.07, 0.5, { x: side * W * 0.33, y: H / 2 + 0.25, z: L * 0.14 }, 8)) };
    },
    snorkel({ W, H, cabin, L }) {
        return { dark: [cylinder(0.06, 0.9, { x: W * 0.5 + 0.02, y: H / 2 + 0.4, z: cabin.to * L - 0.2 }, 8)] };
    },
    sideSteps({ L, W, H }) {
        return { dark: both.map((side) => box({ x: 0.1, y: 0.06, z: L * 0.4 }, { x: side * (W / 2 + 0.06), y: -H / 2 + 0.08, z: 0 })) };
    },
};

export const PART_NAMES = Object.keys(PARTS);

/** Head- and tail-light layouts. `default` is the original look of the first four cars. */
export const LIGHT_STYLES = {
    default({ L, W }) {
        return {
            head: both.map((side) => box({ x: W * 0.26, y: 0.13, z: 0.1 }, { x: side * W * 0.3, y: 0.02, z: L / 2 + 0.06 })),
            tail: both.map((side) => box({ x: W * 0.26, y: 0.13, z: 0.1 }, { x: side * W * 0.3, y: 0.06, z: -L / 2 - 0.05 })),
        };
    },
    slit({ L, W }) {
        return {
            head: both.map((side) => box({ x: W * 0.36, y: 0.05, z: 0.1 }, { x: side * W * 0.26, y: 0.06, z: L / 2 + 0.06 })),
            tail: [box({ x: W * 0.9, y: 0.06, z: 0.08 }, { x: 0, y: 0.08, z: -L / 2 - 0.05 })],
        };
    },
    quad({ L, W }) {
        const xs = [0.16, 0.36];
        return {
            head: both.flatMap((side) => xs.map((k) => box({ x: 0.2, y: 0.12, z: 0.1 }, { x: side * W * k, y: 0.03, z: L / 2 + 0.06 }))),
            tail: both.flatMap((side) => xs.map((k) => box({ x: 0.2, y: 0.1, z: 0.08 }, { x: side * W * k, y: 0.06, z: -L / 2 - 0.05 }))),
        };
    },
    ledBar({ L, W }) {
        return {
            head: [box({ x: W * 0.8, y: 0.05, z: 0.08 }, { x: 0, y: 0.02, z: L / 2 + 0.06 })],
            tail: both.map((side) => box({ x: W * 0.4, y: 0.04, z: 0.08 }, { x: side * W * 0.24, y: 0.07, z: -L / 2 - 0.05 })),
        };
    },
};

export const LIGHT_STYLE_NAMES = Object.keys(LIGHT_STYLES);

/** Rim shapes: a geometry whose axis is x (the wheel axle), built around the origin. */
export const RIM_STYLES = {
    disc: () => new THREE.CylinderGeometry(0.27, 0.27, 0.36, 8).rotateZ(Math.PI / 2),
    turbine: () => {
        const parts = [
            new THREE.CylinderGeometry(0.27, 0.27, 0.34, 16).toNonIndexed().rotateZ(Math.PI / 2),
            new THREE.ConeGeometry(0.11, 0.16, 6).toNonIndexed().rotateZ(-Math.PI / 2).translate(0.2, 0, 0),
        ];
        return mergeSimple(parts);
    },
    fiveSpoke: () => {
        const parts = [new THREE.TorusGeometry(0.25, 0.035, 5, 14).toNonIndexed().rotateY(Math.PI / 2)];
        for (let i = 0; i < 5; i += 1) {
            const spoke = new THREE.BoxGeometry(0.1, 0.5, 0.06).toNonIndexed().rotateX((i * Math.PI * 2) / 5);
            parts.push(spoke);
        }
        parts.push(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 8).toNonIndexed().rotateZ(Math.PI / 2));
        return mergeSimple(parts);
    },
    neonRing: () => new THREE.TorusGeometry(0.25, 0.04, 6, 18).rotateY(Math.PI / 2),
};

export const RIM_STYLE_NAMES = Object.keys(RIM_STYLES);

/** Tyre widths: `fat` is a chunkier tyre for buggies and trucks. */
export const TIRE_STYLES = {
    standard: { radius: 0.42, width: 0.34 },
    fat: { radius: 0.44, width: 0.48 },
};

function mergeSimple(list) {
    const merged = new THREE.BufferGeometry();
    let count = 0;
    for (const g of list) count += g.attributes.position.count;
    const position = new Float32Array(count * 3);
    const normal = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    let offset = 0;
    for (const g of list) {
        position.set(g.attributes.position.array, offset * 3);
        normal.set(g.attributes.normal.array, offset * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, offset * 2);
        offset += g.attributes.position.count;
        g.dispose();
    }
    merged.setAttribute("position", new THREE.BufferAttribute(position, 3));
    merged.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    merged.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    return merged;
}
