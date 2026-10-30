import { DISTRICTS, REPUTATION_TIERS } from "./config.js";

/** Reputation points -> tier info for one district. */
export function reputationTier(points, tiers = REPUTATION_TIERS) {
    let index = 0;
    tiers.forEach((tier, i) => {
        if (points >= tier.at) index = i;
    });
    const tier = tiers[index];
    const next = tiers[index + 1] ?? null;
    return {
        index,
        tier,
        next,
        toNext: next ? next.at - points : 0,
        progress: next ? (points - tier.at) / (next.at - tier.at) : 1,
    };
}

function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function inAnyBuilding(buildings, x, z, margin) {
    return buildings.some((b) => Math.abs(x - b.x) < b.hw + margin && Math.abs(z - b.z) < b.hd + margin);
}

/**
 * Deterministic graffiti tags: half sit on low rooftops (picked up by driving past the wall),
 * the rest in alleys beside buildings. Returns { id, districtId, x, y, z, roof }.
 */
export function generateTags({ buildings, districtIds, districtIdOf, perDistrict = 10, seed = 0x7a65, maxRoofHeight = 24, blockCenters = [-39, -13, 13, 39] }) {
    const rng = mulberry32(seed);
    const tags = [];
    for (const districtId of districtIds) {
        const own = buildings.filter((b) => districtIdOf(b.x, b.z) === districtId && b.h < 40);
        const roofs = own.filter((b) => b.h <= maxRoofHeight);
        const used = new Set();
        const pick = (list) => {
            for (let tries = 0; tries < 30 && list.length; tries += 1) {
                const candidate = list[Math.floor(rng() * list.length)];
                if (!used.has(candidate)) {
                    used.add(candidate);
                    return candidate;
                }
            }
            return null;
        };
        const entries = [];
        const roofTarget = Math.floor(perDistrict / 2);
        for (let i = 0; i < roofTarget; i += 1) {
            const b = pick(roofs);
            if (!b) break;
            // Near the wall so the player can reach it from the street side.
            const side = rng() < 0.5 ? -1 : 1;
            entries.push({ x: b.x + side * (b.hw - 0.6), z: b.z + (rng() - 0.5) * b.hd, y: b.h + 0.55, roof: true });
        }
        let guard = 0;
        while (own.length && entries.length < perDistrict && guard < 400) {
            guard += 1;
            const b = own[Math.floor(rng() * own.length)];
            const alongX = rng() < 0.5;
            const side = rng() < 0.5 ? -1 : 1;
            const x = alongX ? b.x + (rng() - 0.5) * b.hw : b.x + side * (b.hw + 1.6);
            const z = alongX ? b.z + side * (b.hd + 1.6) : b.z + (rng() - 0.5) * b.hd;
            if (districtIdOf(x, z) !== districtId) continue;
            if (inAnyBuilding(buildings, x, z, 0.4)) continue;
            if (entries.some((e) => Math.hypot(e.x - x, e.z - z) < 6)) continue;
            entries.push({ x, z, y: 0.18, roof: false });
        }
        // Districts without enough buildings (the park) get tags on open ground inside their blocks.
        guard = 0;
        while (entries.length < perDistrict && guard < 800) {
            guard += 1;
            const bx = blockCenters[Math.floor(rng() * blockCenters.length)];
            const bz = blockCenters[Math.floor(rng() * blockCenters.length)];
            if (districtIdOf(bx, bz) !== districtId) continue;
            const x = bx + (rng() - 0.5) * 15;
            const z = bz + (rng() - 0.5) * 15;
            if (inAnyBuilding(buildings, x, z, 0.4)) continue;
            if (entries.some((e) => Math.hypot(e.x - x, e.z - z) < 6)) continue;
            entries.push({ x, z, y: 0.18, roof: false });
        }
        entries.forEach((entry, index) => tags.push({ id: `${districtId}-${index}`, districtId, ...entry }));
    }
    return tags;
}

/**
 * Whether a car's reputation requirement is met. `requires: { district, tier }` needs that tier in one district,
 * `requires: { tier }` in any district. Cars without `requires` are only gated by price.
 */
export function carRequirement(car, reputation = {}) {
    const need = car.requires;
    if (!need) return { met: true, text: "" };
    const tierName = REPUTATION_TIERS[need.tier]?.name ?? `Stufe ${need.tier}`;
    if (need.district) {
        const have = reputationTier(reputation[need.district] ?? 0).index;
        const name = DISTRICTS.find((district) => district.id === need.district)?.name ?? need.district;
        return { met: have >= need.tier, text: `Ruf ${name}: ${tierName}` };
    }
    const best = Math.max(0, ...DISTRICTS.map((district) => reputationTier(reputation[district.id] ?? 0).index));
    return { met: best >= need.tier, text: `Ruf (ein Bezirk): ${tierName}` };
}
