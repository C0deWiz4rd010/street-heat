import * as THREE from "three";

const SKID_CAPACITY = 600;
const SKID_LIFE = 16;
const SKID_FADE = 4;
const DEBRIS_CAPACITY = 512;
const SMOKE_CAPACITY = 48;
const RAIN_CAPACITY = 120;

const dummy = new THREE.Object3D();
const tempColor = new THREE.Color();

export function markShared(...resources) {
    for (const resource of resources) {
        if (resource) resource.userData.shared = true;
    }
}

// Frees GPU memory of a removed object; resources flagged via markShared stay alive.
export function disposeObject(object) {
    object.traverse((node) => {
        if (node.geometry && !node.geometry.userData.shared) node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        for (const material of materials) {
            if (!material.userData.shared) material.dispose();
        }
    });
}

function createInstanced(scene, geometry, material, capacity) {
    const mesh = new THREE.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return mesh;
}

export function createEffects(scene) {
    // Skid marks: ring buffer, one draw call, two tracks per rear axle.
    const skidGeometry = new THREE.BoxGeometry(1, 0.018, 2.1);
    const skidMaterial = new THREE.MeshBasicMaterial({ color: "#040506", transparent: true, opacity: 0.48 });
    const skidMesh = createInstanced(scene, skidGeometry, skidMaterial, SKID_CAPACITY);
    const skids = Array.from({ length: SKID_CAPACITY }, () => ({ x: 0, z: 0, rot: 0, width: 0, life: 0 }));
    let skidHead = 0;
    let skidUsed = 0;
    const lastSkid = { x: Infinity, z: Infinity };

    // Debris sparks: one instanced mesh, per-instance colour, fade by shrinking.
    const debrisGeometry = new THREE.BoxGeometry(0.14, 0.14, 0.14);
    const debrisMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff" });
    const debrisMesh = createInstanced(scene, debrisGeometry, debrisMaterial, DEBRIS_CAPACITY);
    debrisMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(DEBRIS_CAPACITY * 3), 3);
    const debris = [];

    // Smoke: small fixed pool, every puff owns a material so it can fade.
    const smokeGeometry = new THREE.SphereGeometry(0.3, 6, 6);
    const smokePool = Array.from({ length: SMOKE_CAPACITY }, () => {
        const material = new THREE.MeshStandardMaterial({ color: "#c8cdd6", roughness: 1, transparent: true, opacity: 0 });
        const mesh = new THREE.Mesh(smokeGeometry, material);
        mesh.visible = false;
        scene.add(mesh);
        return { mesh, active: false, vx: 0, vy: 0, vz: 0, life: 0, age: 0, size: 1 };
    });
    let smokeCursor = 0;

    // Rain: one instanced mesh with shared material.
    const rainGeometry = new THREE.BoxGeometry(0.035, 1.1, 0.035);
    const rainMaterial = new THREE.MeshBasicMaterial({ color: "#8fd8ff", transparent: true, opacity: 0.45 });
    const rainMesh = createInstanced(scene, rainGeometry, rainMaterial, RAIN_CAPACITY);
    const rain = [];

    function addSkid(x, z, rotation, halfTrack, width) {
        const dx = x - lastSkid.x;
        const dz = z - lastSkid.z;
        if (dx * dx + dz * dz < 1.4 * 1.4) return;
        lastSkid.x = x;
        lastSkid.z = z;
        const sideX = Math.cos(rotation);
        const sideZ = -Math.sin(rotation);
        for (const side of [-1, 1]) {
            const mark = skids[skidHead];
            mark.x = x + sideX * halfTrack * side;
            mark.z = z + sideZ * halfTrack * side;
            mark.rot = rotation;
            mark.width = width;
            mark.life = SKID_LIFE;
            skidHead = (skidHead + 1) % SKID_CAPACITY;
            skidUsed = Math.min(SKID_CAPACITY, skidUsed + 1);
        }
    }

    function updateSkids(dt) {
        let count = 0;
        for (let index = 0; index < skidUsed; index += 1) {
            const mark = skids[index];
            if (mark.life <= 0) continue;
            mark.life -= dt;
            if (mark.life <= 0) continue;
            const fade = Math.min(1, mark.life / SKID_FADE);
            dummy.position.set(mark.x, 0.13, mark.z);
            dummy.rotation.set(0, mark.rot, 0);
            dummy.scale.set(mark.width * fade, 1, 1);
            dummy.updateMatrix();
            skidMesh.setMatrixAt(count, dummy.matrix);
            count += 1;
        }
        skidMesh.count = count;
        skidMesh.instanceMatrix.needsUpdate = true;
    }

    function spawnDebris(x, z, color, count) {
        tempColor.set(color);
        for (let index = 0; index < count; index += 1) {
            if (debris.length >= DEBRIS_CAPACITY) debris.shift();
            debris.push({
                x,
                y: 0.8 + Math.random() * 0.8,
                z,
                vx: (Math.random() - 0.5) * 10,
                vy: 3 + Math.random() * 7,
                vz: (Math.random() - 0.5) * 10,
                life: 0.45 + Math.random() * 0.7,
                age: 0,
                r: tempColor.r,
                g: tempColor.g,
                b: tempColor.b,
            });
        }
    }

    function spawnSmoke(x, z) {
        const puff = smokePool[smokeCursor];
        smokeCursor = (smokeCursor + 1) % SMOKE_CAPACITY;
        puff.active = true;
        puff.vx = (Math.random() - 0.5) * 1.4;
        puff.vy = 0.8 + Math.random() * 0.7;
        puff.vz = (Math.random() - 0.5) * 1.4;
        puff.life = 0.6 + Math.random() * 0.5;
        puff.age = 0;
        puff.size = 0.7 + Math.random() * 0.6;
        puff.mesh.position.set(x, 0.28, z);
        puff.mesh.scale.setScalar(puff.size);
        puff.mesh.material.opacity = 0.28;
        puff.mesh.visible = true;
    }

    function updateParticles(dt) {
        let count = 0;
        for (let index = debris.length - 1; index >= 0; index -= 1) {
            const particle = debris[index];
            particle.age += dt;
            if (particle.age >= particle.life) {
                debris.splice(index, 1);
                continue;
            }
            particle.vy -= 12 * dt;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            particle.z += particle.vz * dt;
            const scale = 1 - particle.age / particle.life;
            dummy.position.set(particle.x, particle.y, particle.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.setScalar(scale);
            dummy.updateMatrix();
            debrisMesh.setMatrixAt(count, dummy.matrix);
            debrisMesh.instanceColor.setXYZ(count, particle.r, particle.g, particle.b);
            count += 1;
        }
        debrisMesh.count = count;
        debrisMesh.instanceMatrix.needsUpdate = true;
        debrisMesh.instanceColor.needsUpdate = true;

        for (const puff of smokePool) {
            if (!puff.active) continue;
            puff.age += dt;
            if (puff.age >= puff.life) {
                puff.active = false;
                puff.mesh.visible = false;
                continue;
            }
            const t = puff.age / puff.life;
            puff.vx *= 0.96;
            puff.vz *= 0.96;
            puff.mesh.position.x += puff.vx * dt;
            puff.mesh.position.y += puff.vy * dt;
            puff.mesh.position.z += puff.vz * dt;
            puff.mesh.scale.setScalar(puff.size * (1 + t * 1.8));
            puff.mesh.material.opacity = 0.28 * (1 - t);
        }
    }

    function spawnRain(x, z) {
        if (rain.length >= RAIN_CAPACITY) return;
        rain.push({ x, y: 12 + Math.random() * 12, z, life: 0.55 + Math.random() * 0.35 });
    }

    function updateRain(dt) {
        let count = 0;
        for (let index = rain.length - 1; index >= 0; index -= 1) {
            const drop = rain[index];
            drop.life -= dt;
            drop.y -= dt * 24;
            if (drop.life <= 0 || drop.y <= 0.35) {
                rain.splice(index, 1);
                continue;
            }
            dummy.position.set(drop.x, drop.y, drop.z);
            dummy.rotation.set(0, 0, 0);
            dummy.scale.set(1, 1, 1);
            dummy.updateMatrix();
            rainMesh.setMatrixAt(count, dummy.matrix);
            count += 1;
        }
        rainMesh.count = count;
        rainMesh.instanceMatrix.needsUpdate = true;
    }

    function clear() {
        for (const mark of skids) mark.life = 0;
        skidHead = 0;
        skidUsed = 0;
        lastSkid.x = Infinity;
        lastSkid.z = Infinity;
        skidMesh.count = 0;
        debris.length = 0;
        debrisMesh.count = 0;
        rain.length = 0;
        rainMesh.count = 0;
        for (const puff of smokePool) {
            puff.active = false;
            puff.mesh.visible = false;
        }
    }

    return {
        addSkid,
        updateSkids,
        spawnDebris,
        spawnSmoke,
        updateParticles,
        spawnRain,
        updateRain,
        clear,
        get rainCount() {
            return rain.length;
        },
    };
}
