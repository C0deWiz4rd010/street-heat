import * as THREE from "three";
import { CAR_MODELS, CONFIG } from "../config.js";
import { distanceSq } from "../util/math.js";

/** Follow camera: speed-based lift, look-ahead, heat zoom, FOV and shake (the shake never feeds back into the smoothing). */
export function createCameraSystem({ state, camera, post, police }) {
    const tempTarget = new THREE.Vector3();
    const cameraBase = new THREE.Vector3();
    let cameraBaseReady = false;
    let cameraZoom = 0;

    function update(dt) {
        const player = state.player;

        // Slow orbit for menu / garage screens
        if (state.screen === "menu" || state.screen === "garage") {
            const t = performance.now() * 0.00025;
            const orbitR = 58;
            const targetX = Math.cos(t) * orbitR;
            const targetZ = Math.sin(t) * orbitR;
            tempTarget.set(targetX, 42, targetZ);
            camera.position.lerp(tempTarget, 1 - Math.exp(-1.2 * dt));
            cameraBase.copy(camera.position);
            cameraBaseReady = true;
            camera.lookAt(0, 0, 0);
            const targetFov = CONFIG.camera.fovBase;
            camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-2 * dt));
            camera.updateProjectionMatrix();
            return;
        }

        const forwardX = Math.sin(player.rotation);
        const forwardZ = Math.cos(player.rotation);
        const latX = Math.cos(player.rotation);
        const latZ = -Math.sin(player.rotation);
        const speedMag = player.speedMag ?? Math.abs(player.speed);
        const maxSpeed = (CAR_MODELS[state.playerModelIndex]?.maxSpeed ?? 22) * 1.3;
        const speedRatio = Math.min(1, speedMag / maxSpeed);

        // Lateral velocity lean — camera shifts slightly in slide direction
        const vx = player.vx ?? 0;
        const vz = player.vz ?? 0;
        const latSpeed = vx * latX + vz * latZ;
        const leanX = latX * latSpeed * 0.06;
        const leanZ = latZ * latSpeed * 0.06;

        // Heat and cops close by raise the camera so more of the chase stays visible.
        const cameraMode = CONFIG.camera.modes[state.settings?.cameraMode ?? state.cameraMode] ?? CONFIG.camera.modes.normal;
        let copsNear = 0;
        for (const agent of police) {
            if (distanceSq(player.x, player.z, agent.x, agent.z) < 30 * 30) copsNear += 1;
        }
        const zoomTarget = Math.min(CONFIG.camera.zoomMax, state.wanted.level * CONFIG.camera.zoomPerHeat + copsNear * CONFIG.camera.zoomPerCop);
        cameraZoom += (zoomTarget - cameraZoom) * (1 - Math.exp(-1.5 * dt));

        const speedLift = Math.min(3.5, speedMag * speedMag * 0.0055);
        tempTarget.set(
            player.x - forwardX * (cameraMode.backOffset + cameraZoom * 0.4) + leanX,
            cameraMode.height + cameraZoom + speedLift,
            player.z - forwardZ * (cameraMode.backOffset + cameraZoom * 0.4) + leanZ
        );

        // Phase 4: adaptive position-lerp (FPS-invariant)
        const turnInputMag = Math.abs((state.lastTurnInput ?? 0));
        const driftFactor = Math.min(1, (player.drift ?? 0));
        const kPos = CONFIG.camera.followLerp + speedRatio * 3.5 + driftFactor * 1.2 + turnInputMag * 0.8;
        // The smoothed base position never receives the shake offset, so shake cannot feed back into the lerp.
        if (!cameraBaseReady) {
            cameraBase.copy(camera.position);
            cameraBaseReady = true;
        }
        cameraBase.lerp(tempTarget, 1 - Math.exp(-kPos * dt));
        camera.position.copy(cameraBase);
        post.setSpeed(speedRatio);

        // Phase 4: Shake-Profile (impact + engine + drift composite)
        const engineShake = speedRatio > 0.9 ? (speedRatio - 0.9) * 0.6 : 0;
        const driftShake = driftFactor > 0.7 ? (driftFactor - 0.7) * 0.55 : 0;
        const shakeScale = state.settings ? (state.settings.reducedMotion ? 0 : state.settings.shake) : 1;
        const composite = ((state.cameraShake ?? 0) + engineShake + driftShake) * shakeScale;
        if (state.cameraShake > 0) {
            state.cameraShake = Math.max(0, state.cameraShake - dt * 3.2);
        }
        if (composite > 0.01) {
            const shakeTime = performance.now() * 0.018;
            camera.position.x += Math.sin(shakeTime * 7.3) * composite * 0.55;
            camera.position.z += Math.sin(shakeTime * 5.9 + 1.2) * composite * 0.55;
        }

        // Dynamic FOV — widens with speed (+ provoke kick)
        const provokeFovKick = (state.provoke?.fxTimer ?? 0) > 0 ? 6 : 0;
        const targetFov = CONFIG.camera.fovBase + speedRatio * (CONFIG.camera.fovMax - CONFIG.camera.fovBase) + provokeFovKick;
        camera.fov += (targetFov - camera.fov) * (1 - Math.exp(-2.8 * dt));
        camera.updateProjectionMatrix();

        // Phase 4: lateral + steering look-ahead, drift-lead
        const lookAheadFwd = speedMag * 0.24;
        const lookAheadLat = latSpeed * 0.35 + (state.lastTurnInput ?? 0) * speedMag * 0.18;
        camera.lookAt(
            player.x + forwardX * lookAheadFwd + latX * lookAheadLat,
            0,
            player.z + forwardZ * lookAheadFwd + latZ * lookAheadLat
        );
        if (composite > 0.01) {
            camera.rotateZ(Math.sin(performance.now() * 0.13) * composite * 0.018);
        }
    }

    return { update };
}
