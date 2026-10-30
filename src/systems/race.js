import * as THREE from "three";
import { CAR_MODELS, CONFIG, RACE } from "../config.js";
import { nextWaypoint, nearestNode } from "../ai/police.js";
import { clamp, turnToward, wrapAngle } from "../util/math.js";
import { pickRivalModels } from "../data/vehicles.js";
import { createCar, updateCarVisuals } from "../vehicles.js";
import { pushOutBuildings } from "../world.js";

/** Illegal street race: start ring -> checkpoints against AI rivals that follow the street graph. */
export function createRaceSystem({
    state, scene, world, audio, sharedMaterials, roadGraph,
    getDistrictAt, getDistrictWaypointRoute, distanceTo, removeMesh,
    addCash, addReputation, addScore, refreshProgress, setStatus, spawnPopup, updateWanted,
}) {
    // ---- Street race: start ring -> 4 checkpoints against 2 AI rivals. -------------------------------
    const raceMarker = new THREE.Mesh(
        new THREE.TorusGeometry(RACE.radius * 0.8, 0.28, 10, 36).rotateX(Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 2.4, 1.2), transparent: true, opacity: 0.85 })
    );
    raceMarker.visible = false;
    scene.add(raceMarker);

    function start(event) {
        const district = getDistrictAt(event.x, event.z);
        const checkpoints = getDistrictWaypointRoute(district.id, RACE.checkpoints, state.mission.stage + 2);
        const hub = nearestNode(roadGraph, event.x, event.z);
        const racers = [];
        const rivalModels = pickRivalModels(CAR_MODELS, RACE.rivals);
        for (let index = 0; index < RACE.rivals; index += 1) {
            const model = rivalModels[index];
            const mesh = createCar(model, sharedMaterials);
            const x = hub.x + (index === 0 ? -2.4 : 2.4);
            const z = hub.z + 3;
            mesh.position.set(x, 0.37, z);
            scene.add(mesh);
            racers.push({
                mesh, x, z, rotation: 0, speed: 0, index: 0, finished: false,
                cruise: RACE.rivalSpeed + index * 0.7 + Math.min(4, state.mission.stage * 0.25),
                wpTimer: 0, wpX: x, wpZ: z,
            });
        }
        state.race = { active: true, checkpoints, racers, player: { index: 0 }, order: [], timer: RACE.timeLimit, districtId: district.id };
        updateWanted(state.wanted.level + 1);
        raceMarker.visible = true;
        spawnPopup("RENNEN!", "bounty");
        setStatus(`Illegales Rennen in ${district.name}: ${RACE.checkpoints} Checkpoints, ${RACE.rivals} Rivalen. Sei Erster!`, 3.5);
        audio?.mission?.();
    }

    function racePlaceNow() {
        const race = state.race;
        const cp = race.checkpoints[race.player.index];
        const mine = race.player.index;
        const myDist = cp ? distanceTo(cp.x, cp.z) : 0;
        let place = 1;
        for (const racer of race.racers) {
            if (racer.finished) {
                place += 1;
                continue;
            }
            const target = race.checkpoints[racer.index];
            const theirDist = target ? Math.hypot(target.x - racer.x, target.z - racer.z) : 0;
            if (racer.index > mine || (racer.index === mine && theirDist < myDist)) place += 1;
        }
        return place;
    }

    function update(dt) {
        const race = state.race;
        if (!race?.active) return;
        race.timer -= dt;
        const total = race.checkpoints.length;

        const next = race.checkpoints[race.player.index];
        if (next) {
            raceMarker.position.set(next.x, 0.5, next.z);
            raceMarker.rotation.y += dt * 1.5;
            if (distanceTo(next.x, next.z) < RACE.radius) {
                race.player.index += 1;
                audio?.nearMiss?.();
                if (race.player.index >= total) {
                    end(false, race.racers.filter((racer) => racer.finished).length + 1);
                    return;
                }
                setStatus(`Checkpoint ${race.player.index}/${total} | Platz ${racePlaceNow()}/${race.racers.length + 1}`, 1.4);
            }
        }

        for (const racer of race.racers) {
            if (racer.finished) continue;
            const cp = race.checkpoints[racer.index];
            racer.wpTimer -= dt;
            if (racer.wpTimer <= 0) {
                const wp = nextWaypoint(roadGraph, racer.x, racer.z, cp.x, cp.z);
                racer.wpX = wp.x;
                racer.wpZ = wp.z;
                racer.wpTimer = 0.3;
            }
            const diff = wrapAngle(Math.atan2(racer.wpX - racer.x, racer.wpZ - racer.z) - racer.rotation);
            racer.rotation = turnToward(racer.rotation, racer.x, racer.z, racer.wpX, racer.wpZ, 2.8 * dt);
            // Rubber band: rivals ease off when far ahead and push when the player is close behind.
            const lead = racer.index - race.player.index;
            const speedTarget = racer.cruise * (Math.abs(diff) > 0.9 ? 0.55 : 1) * (lead > 0 ? 0.92 : lead < 0 ? 1.08 : 1);
            racer.speed += (speedTarget - racer.speed) * dt * 2.2;
            const moved = { x: racer.x + Math.sin(racer.rotation) * racer.speed * dt, z: racer.z + Math.cos(racer.rotation) * racer.speed * dt };
            if (pushOutBuildings(world, moved, 1.25)) {
                racer.speed *= 0.6;
                racer.rotation += 0.9 * Math.sign(diff || 1);
            }
            racer.x = clamp(moved.x, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            racer.z = clamp(moved.z, -CONFIG.map.size / 2, CONFIG.map.size / 2);
            racer.mesh.position.set(racer.x, 0.37, racer.z);
            racer.mesh.rotation.y = racer.rotation;
            updateCarVisuals(racer.mesh, dt, { speed: racer.speed });
            if (Math.hypot(cp.x - racer.x, cp.z - racer.z) < RACE.radius + 2) {
                racer.index += 1;
                if (racer.index >= total) {
                    racer.finished = true;
                    race.order.push(racer);
                    setStatus("Ein Rivale ist im Ziel!", 1.4);
                }
            }
        }

        if (race.timer <= 0) end(false, 0);
    }

    /** place: 1..n finished, 0 = out of time. `silent` just tears the race down (reset). */
    function end(silent, place = 0) {
        const race = state.race;
        if (!race) return;
        for (const racer of race.racers) removeMesh(racer.mesh);
        raceMarker.visible = false;
        state.race = null;
        if (silent) return;
        const payout = RACE.payouts[place - 1];
        if (!payout) {
            setStatus(place === 0 ? "Rennen verloren: Zeit abgelaufen." : "Rennen beendet ohne Platzierung.", 2.6);
            return;
        }
        addScore(payout.score, true, "events");
        const cash = addCash(payout.cash);
        addReputation(race.districtId, payout.rep);
        state.stats.events += 1;
        state.lifetime.events += 1;
        refreshProgress();
        spawnPopup(`PLATZ ${place}!`, "bounty");
        setStatus(`Rennen: Platz ${place} von ${race.racers.length + 1}. Preisgeld +$${cash}.`, 3.2);
        audio?.mission?.();
    }

    return { start, update, end };
}
