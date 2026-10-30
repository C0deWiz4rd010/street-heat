import { CONFIG, SURFACES, VEHICLE_PHYSICS as P } from "../config.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Derives the per-frame vehicle parameters from the car model, upgrades and the environment.
 * Pure data in, pure data out, so the physics can be tested without a renderer.
 */
export function deriveSpec(model, { upgrades = {}, weatherGrip = 1, surface, inShortcut = false, shortcutBoost = 0, noBrake = false }) {
    const engineLevel = upgrades.engine ?? 0;
    const gripLevel = upgrades.grip ?? 0;
    const nitroLevel = upgrades.nitro ?? 0;
    const mass = model.mass ?? 1;
    const engineMult = 1 + engineLevel * P.engineSpeedPerLevel;
    return {
        model,
        mass,
        engineLevel,
        gripLevel,
        nitroLevel,
        weatherGrip,
        surfaceGrip: surface.grip,
        rolling: surface.rolling,
        noBrake,
        reverseFactor: CONFIG.player.reverseFactor,
        maxSpeed: model.maxSpeed * engineMult * surface.speed + (inShortcut ? shortcutBoost : 0),
        acceleration: (model.acceleration / Math.sqrt(mass)) * (1 + engineLevel * P.accelPerLevel) * (0.92 + weatherGrip * 0.08) * surface.speed,
        turnPower: model.turn * wheelbaseTurnFactor(model) * (1 + gripLevel * P.turnPerGripLevel) * weatherGrip * (inShortcut ? 1.08 : 1),
        brakePower: (P.brakeBase + gripLevel * P.brakePerLevel) * (model.brakeFactor ?? 0.68) * weatherGrip,
        coastFriction: P.coastBase + gripLevel * P.coastPerLevel,
        reverseAccel: ((model.acceleration * P.reverseAccelShare) / Math.sqrt(mass)) * (1 + engineLevel * 0.1),
        tierEngineNitroBoost: engineLevel >= 3 ? 0.05 : 0,
        tierGripBonus: gripLevel >= 3 ? 1 : 0,
    };
}

/** Longitudinal speed: throttle with a per-car torque curve, braking, reverse, handbrake and coasting. */
export function applyEngine(fwd, ctl, spec, boostedMax, dt) {
    const ratio = Math.min(1, Math.abs(fwd) / Math.max(0.1, boostedMax));
    const peakAt = spec.model.torquePeak ?? 0.45;
    const peakGauss = Math.exp(-(((ratio - peakAt) / 0.32) ** 2));
    const torque = Math.max(0.2, 1.25 * peakGauss + (1 - ratio) * 0.35);

    if (spec.noBrake && (ctl.reverse || !ctl.forward)) {
        if (ctl.forward) fwd += spec.acceleration * torque * dt * (ctl.throttleAmount ?? 1);
        else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), spec.coastFriction * 0.4 * dt);
    } else if (ctl.forward && !ctl.reverse) {
        fwd += spec.acceleration * torque * dt * (ctl.throttleAmount ?? 1);
    } else if (ctl.reverse && !ctl.forward) {
        if (fwd > 0.3) {
            fwd = Math.max(0, fwd - spec.brakePower * dt * (ctl.brakeAmount ?? 1));
        } else {
            fwd -= spec.reverseAccel * torque * dt * (ctl.brakeAmount ?? 1);
        }
    } else if (ctl.handbrake) {
        const friction = P.handbrakeBase + spec.gripLevel * P.handbrakePerLevel;
        fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), friction * dt);
    } else {
        fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), spec.coastFriction * dt);
    }

    // Soft ground (grass, gravel) adds rolling resistance on top of the speed cap.
    if (spec.rolling > 0) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), spec.rolling * dt);
    return clamp(fwd, -boostedMax * spec.reverseFactor, boostedMax);
}

/**
 * Updates `p.drift` and `p.gripBlend` (a smoothed 0..1 grip state, so entering and leaving a
 * drift fades over about 0.15 s instead of snapping).
 */
export function updateDrift(p, fwd, lat, ctl, spec, speedRatioFwd, dt) {
    const threshold = (spec.model.driftThreshold ?? 0.38) * spec.maxSpeed;
    const turning = Math.abs(ctl.turn) > 0;
    const handbrakeDrift = ctl.handbrake && Math.abs(fwd) > threshold && turning;
    const powerDrift = !handbrakeDrift && ctl.forward && turning && speedRatioFwd > 0.55 && Math.abs(lat) > P.powerDriftSlip;
    const isDrifting = handbrakeDrift || powerDrift;
    const wasDrifting = p.drift > 0.5;
    const buildRate = handbrakeDrift ? P.handbrakeDriftBuild : powerDrift ? P.powerDriftBuild : 0;
    p.drift = isDrifting ? Math.min(1, p.drift + dt * buildRate) : Math.max(0, p.drift - dt * P.driftDecay);
    const target = isDrifting ? 1 : 0;
    p.gripBlend = (p.gripBlend ?? 0) + (target - (p.gripBlend ?? 0)) * (1 - Math.exp(-dt / P.gripBlendTime));
    return { isDrifting, wasDrifting };
}

/** Yaw. Trail-braking: braking while steering loads the front axle and sharpens the turn-in. */
export function applySteering(p, fwd, ctl, spec, boostedMax, dt) {
    if (Math.abs(fwd) <= 0.12) return;
    const ratio = Math.abs(fwd) / Math.max(0.1, boostedMax);
    const baseTurn = Math.pow(1 - ratio, 0.55) * 0.6 + 0.4;
    const lowSpeedAgility = 1 + Math.max(0, 0.35 - ratio) * 1.2;
    // Negative gripBalance (sport) oversteers, positive understeers.
    const balanceMult = 1 - (spec.model.gripBalance ?? 0) * 0.18;
    const driftBoost = 1 + ((1.55 + spec.gripLevel * 0.04) - 1) * (p.gripBlend ?? 0);
    const braking = ctl.reverse && fwd > 0.3 ? 1 : 0;
    const trailBrake = 1 + braking * ratio * P.trailBrakeTurn * (spec.model.weightTransfer ?? 1);
    p.rotation += ctl.turn * spec.turnPower * driftBoost * baseTurn * lowSpeedAgility * balanceMult * trailBrake * dt * Math.sign(fwd);
}

/** Lateral grip (frame-rate independent decay of sideways speed). Returns the new lateral speed. */
export function applyGrip(lat, p, ctl, spec, dt) {
    const env = spec.weatherGrip * spec.surfaceGrip;
    let base = (P.gripBase + spec.gripLevel * P.gripPerLevel) * env;
    let slide = (P.driftGripBase + spec.gripLevel * P.driftGripPerLevel) * env * (spec.model.driftSlip ?? 1);
    // Weight transfer: braking unloads the rear axle, throttle in a drift widens the slide angle.
    const braking = ctl.reverse && p.speed > 0.3 ? 1 : 0;
    base -= braking * Math.abs(ctl.turn) * P.trailBrakeRearGrip * (spec.model.weightTransfer ?? 1);
    slide *= 1 - (ctl.forward ? P.throttleDriftSlip : 0);
    const grip = lerp(base, slide, p.gripBlend ?? 0);
    return lat * Math.exp(-(1 - clamp(grip, 0.01, 0.99)) * P.lateralDecayRate * dt);
}

/** The player's contact radius: slightly tighter than the raw footprint (0.9 keeps the Comet at its old 1.25). */
export function playerRadius(model) {
    return vehicleRadius(model) * 0.9;
}

/** Long cars turn wider, short ones tighter (gentle: 0.9 to 1.1 around a 4.6 m reference). */
export function wheelbaseTurnFactor(model) {
    return clamp(Math.pow(4.6 / (model.length ?? 4.6), 0.3), 0.9, 1.1);
}

/** Collision radius of a vehicle from its footprint (the same formula traffic has always used). */
export function vehicleRadius(model) {
    return ((model.length ?? 4.2) * 0.42 + (model.width ?? 2) * 0.5) * 0.5;
}

/** Scales every velocity component, so hazards really slow the car (speed is derived from velocity). */
export function applySpeedFactor(p, factor) {
    p.vx *= factor;
    p.vz *= factor;
    p.speed *= factor;
    p.speedMag *= factor;
}

/**
 * Glancing/hard wall hit: projects the normal component away (with a little bounce for hard hits) and
 * bleeds tangential speed. Returns the wall-slide signal (0..1) for audio.
 */
export function glancingWallImpact(p, nx, nz, impactMag, speedRatioWall, mass, dt) {
    const velDotN = p.vx * nx + p.vz * nz;
    if (velDotN >= 0) return 0;
    const restitution = clamp(0.1 + mass * 0.05 + speedRatioWall * 0.1, 0.1, 0.35);
    const glancing = Math.min(1, Math.abs(velDotN) / Math.max(0.1, impactMag));
    const effective = restitution * glancing;
    p.vx -= (1 + effective) * velDotN * nx;
    p.vz -= (1 + effective) * velDotN * nz;
    const decay = Math.exp(-0.6 * dt);
    p.vx *= decay;
    p.vz *= decay;
    return Math.min(1, Math.abs(impactMag - Math.abs(velDotN)) * 0.18);
}

/** Wall hit without a usable normal (corner): heavy damping scaled by mass. */
export function headOnDamp(p, mass) {
    const factor = Math.min(0.5, 0.22 + mass * 0.18);
    p.vx *= factor;
    p.vz *= factor;
}

/** Removes the velocity component pointing into a surface with the given outward normal. */
export function cancelNormalVelocity(p, nx, nz) {
    const into = p.vx * nx + p.vz * nz;
    if (into < 0) {
        p.vx -= into * nx;
        p.vz -= into * nz;
    }
}

/**
 * Pulls a soft surface toward asphalt by the car's `perks.offroad` share (0 = no help, 1 = grass drives like road).
 * Returns the surface unchanged for cars without the perk.
 */
export function applyOffroadPerk(surface, model) {
    const share = model?.perks?.offroad ?? 0;
    if (!share) return surface;
    const road = SURFACES.road;
    const mix = (key) => surface[key] + (road[key] - surface[key]) * share;
    return { ...surface, grip: mix("grip"), rolling: mix("rolling"), speed: mix("speed") };
}

/** 0 = fine, 1 = smoking (below half health), 2 = sparking (below a quarter). */
export function damageLevel(health, maxHealth) {
    const ratio = maxHealth > 0 ? health / maxHealth : 1;
    if (ratio < 0.25) return 2;
    return ratio < 0.5 ? 1 : 0;
}

/** Surface under a point: streets and plazas grip, soft ground drags. */
export function surfaceAt(x, z, districtId, inShortcut) {
    const half = CONFIG.map.streetWidth / 2 + 0.8;
    const onStreet = CONFIG.map.streets.some((s) => Math.abs(x - s) < half) || CONFIG.map.streets.some((s) => Math.abs(z - s) < half);
    if (onStreet || inShortcut) return SURFACE_ROAD;
    if (districtId === "park") return SURFACE_GRASS;
    if (districtId === "harbor") return SURFACE_DOCK;
    if (districtId === "industrial") return SURFACE_GRAVEL;
    return SURFACE_PAVING;
}

const SURFACE_ROAD = SURFACES.road;
const SURFACE_GRASS = SURFACES.grass;
const SURFACE_DOCK = SURFACES.dock;
const SURFACE_GRAVEL = SURFACES.gravel;
const SURFACE_PAVING = SURFACES.paving;
