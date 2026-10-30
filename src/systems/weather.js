import * as THREE from "three";
import { WEATHER_MODES } from "../config.js";
import { distanceSq } from "../util/math.js";

/**
 * Atmosphere: day/night easing, weather colours and lights, wet roads, storm lightning, industrial steam.
 * `apply()` re-evaluates the visuals (called on weather and phase changes); `update(dt)` runs every frame.
 */
export function createWeatherSystem({ state, scene, renderer, lights, post, audio, world, effects }) {
    const visualColor = new THREE.Color();
    const NIGHT_TINT = new THREE.Color("#071018");
    const SUN_DAY = new THREE.Color("#fff7df");
    const SUN_DUSK = new THREE.Color("#ff8a4a");
    const GLOW_DAY = new THREE.Color("#63c8ff");
    const GLOW_NIGHT = new THREE.Color("#69d0ff");
    const lerp = (a, b, t) => a + (b - a) * t;
    let lightningTimer = 0;
    let secondFlash = 0;

    function apply() {
        const mode = state.weather.mode;
        const weather = WEATHER_MODES[mode] ?? WEATHER_MODES.clear;
        const day = state.time.daylight ?? 1;
        const smoothDay = day * day * (3 - 2 * day);
        const n = 1 - smoothDay;
        visualColor.set(weather.color).lerp(NIGHT_TINT, 0.38 * n);
        scene.background = visualColor;
        if (scene.fog) {
            scene.fog.color.copy(visualColor);
            const fogNear = mode === "fog" ? 20 : mode === "storm" ? 28 : 48;
            const fogFar = mode === "fog" ? 72 : mode === "storm" ? 102 : 130;
            scene.fog.near = fogNear * (1 - 0.08 * n);
            scene.fog.far = fogFar * (1 - 0.1 * n);
        }
        if (lights) {
            lights.ambient.intensity = lerp(mode === "storm" ? 0.92 : 1.25, 0.7, n);
            lights.sun.intensity = lerp(mode === "storm" ? 2.6 : 4.8, mode === "storm" ? 0.85 : 0.55, n);
            lights.sun.color.copy(SUN_DAY).lerp(SUN_DUSK, 4 * smoothDay * n * 0.9);
            lights.nightGlow.intensity = lerp(mode === "fog" ? 1.05 : 0.9, 1.7, n);
            lights.nightGlow.color.copy(GLOW_DAY).lerp(GLOW_NIGHT, n);
        }
        renderer.toneMappingExposure = lerp(mode === "storm" ? 0.98 : 1.08, 0.92, n);
        post.setAtmosphere(visualColor, n, mode);
        post.setDaylight(smoothDay);
    }

    /** Per-frame: ease day/night and wetness, run storm lightning, animate the world. */
    // Industrial steam: smokestack and tank vents puff while the player is nearby.
    const steamSources = [{ x: -38, z: 38, y: 15 }, ...world.obstacles.filter((o) => o.type === "tank").map((o) => ({ x: o.x, z: o.z, y: 3.9 }))];
    let steamTimer = 0;

    function updateSteam(dt) {
        steamTimer -= dt;
        if (steamTimer > 0) return;
        steamTimer = 0.32 / Math.max(0.3, post.getQualityConfig().particleDensity ?? 1);
        for (const source of steamSources) {
            if (distanceSq(state.player.x, state.player.z, source.x, source.z) > 70 * 70) continue;
            effects.spawnSmoke(source.x, source.z, { y: source.y, color: "#dfe4ea", alpha: 0.22, size: source.y > 8 ? 3.2 : 1.6, grow: 2.4, life: 2.2, rise: source.y > 8 ? 2.2 : 1.1 });
        }
    }

    function update(dt) {
        updateSteam(dt);
        const targetDay = state.time.phase === "night" ? 0 : 1;
        const day = state.time.daylight ?? targetDay;
        const step = dt / 9;
        state.time.daylight = day < targetDay ? Math.min(targetDay, day + step) : Math.max(targetDay, day - step);

        const mode = state.weather.mode;
        const wetTarget = mode === "rain" || mode === "storm" ? 1 : mode === "fog" ? 0.35 : 0;
        const wet = state.weather.wetness ?? wetTarget;
        state.weather.wetness = wet < wetTarget ? Math.min(wetTarget, wet + dt * 0.12) : Math.max(wetTarget, wet - dt * 0.05);

        if (mode === "storm") {
            lightningTimer -= dt;
            if (lightningTimer <= 0) {
                post.flashLightning(1);
                audio?.thunder(0.3 + Math.random() * 0.9);
                secondFlash = 0.16 + Math.random() * 0.12;
                lightningTimer = 3 + Math.random() * 7;
            }
        }
        if (secondFlash > 0) {
            secondFlash -= dt;
            if (secondFlash <= 0) post.flashLightning(0.7);
        }

        apply();
        world.updateVisuals(dt, 1 - state.time.daylight, state.weather.wetness);
    }

    return { apply, update };
}
