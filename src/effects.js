import * as THREE from "three";

const SKID_CAPACITY = 600;
const SKID_LIFE = 16;
const SKID_FADE = 4;
const DEBRIS_CAPACITY = 512;
const SMOKE_CAPACITY = 64;
const SPARK_CAPACITY = 320;
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

function createPuffTexture() {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const context = canvas.getContext("2d");
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.4, "rgba(255,255,255,0.45)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
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

    // Smoke / glow puffs: soft radial sprites, every puff owns a SpriteMaterial so it can fade.
    const puffTexture = createPuffTexture();
    const smokePool = Array.from({ length: SMOKE_CAPACITY }, () => {
        const material = new THREE.SpriteMaterial({ map: puffTexture, color: "#c8cdd6", transparent: true, opacity: 0, depthWrite: false });
        const mesh = new THREE.Sprite(material);
        mesh.visible = false;
        scene.add(mesh);
        return { mesh, active: false, vx: 0, vy: 0, vz: 0, life: 0, age: 0, size: 1, alpha: 0.3, grow: 1.8 };
    });
    let smokeCursor = 0;

    // Sparks: additive points with per-vertex colour, gravity and a floor bounce.
    const sparkPositions = new Float32Array(SPARK_CAPACITY * 3);
    const sparkColors = new Float32Array(SPARK_CAPACITY * 3);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
    sparkGeometry.setAttribute("color", new THREE.BufferAttribute(sparkColors, 3).setUsage(THREE.DynamicDrawUsage));
    const sparkMaterial = new THREE.PointsMaterial({
        size: 0.32,
        vertexColors: true,
        map: puffTexture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
    });
    const sparkPoints = new THREE.Points(sparkGeometry, sparkMaterial);
    sparkPoints.frustumCulled = false;
    sparkGeometry.setDrawRange(0, 0);
    scene.add(sparkPoints);
    const sparks = [];

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
                life: 0.8 + Math.random() * 0.9,
                age: 0,
                rx: Math.random() * 6,
                ry: Math.random() * 6,
                spinX: (Math.random() - 0.5) * 14,
                spinY: (Math.random() - 0.5) * 14,
                r: tempColor.r,
                g: tempColor.g,
                b: tempColor.b,
            });
        }
    }

    function spawnSmoke(x, z, options = {}) {
        const puff = smokePool[smokeCursor];
        smokeCursor = (smokeCursor + 1) % SMOKE_CAPACITY;
        puff.active = true;
        puff.vx = (Math.random() - 0.5) * 1.4 + (options.vx ?? 0);
        puff.vy = (options.rise ?? 0.8) + Math.random() * 0.7;
        puff.vz = (Math.random() - 0.5) * 1.4 + (options.vz ?? 0);
        puff.life = (options.life ?? 0.7) + Math.random() * 0.5;
        puff.age = 0;
        puff.size = (options.size ?? 1.5) * (0.7 + Math.random() * 0.6);
        puff.alpha = options.alpha ?? 0.3;
        puff.grow = options.grow ?? 1.8;
        const material = puff.mesh.material;
        material.color.set(options.color ?? "#c8cdd6");
        material.blending = options.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
        material.opacity = puff.alpha;
        puff.mesh.position.set(x, options.y ?? 0.3, z);
        puff.mesh.scale.setScalar(puff.size);
        puff.mesh.visible = true;
    }

    function spawnSparks(x, z, count, y = 0.5) {
        for (let index = 0; index < count; index += 1) {
            if (sparks.length >= SPARK_CAPACITY) sparks.shift();
            const angle = Math.random() * Math.PI * 2;
            const speed = 3 + Math.random() * 8;
            sparks.push({
                x,
                y: y + Math.random() * 0.5,
                z,
                vx: Math.cos(angle) * speed,
                vy: 2 + Math.random() * 5,
                vz: Math.sin(angle) * speed,
                age: 0,
                life: 0.35 + Math.random() * 0.45,
                hot: Math.random(),
            });
        }
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
            particle.vy -= 14 * dt;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            particle.z += particle.vz * dt;
            if (particle.y < 0.16 && particle.vy < 0) {
                particle.y = 0.16;
                particle.vy *= -0.45;
                particle.vx *= 0.7;
                particle.vz *= 0.7;
                particle.spinX *= 0.5;
                particle.spinY *= 0.5;
            }
            particle.rx += particle.spinX * dt;
            particle.ry += particle.spinY * dt;
            const scale = Math.min(1, (1 - particle.age / particle.life) * 3);
            dummy.position.set(particle.x, particle.y, particle.z);
            dummy.rotation.set(particle.rx, particle.ry, 0);
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
            puff.mesh.scale.setScalar(puff.size * (1 + t * puff.grow));
            puff.mesh.material.opacity = puff.alpha * (1 - t);
        }

        let sparkCount = 0;
        for (let index = sparks.length - 1; index >= 0; index -= 1) {
            const spark = sparks[index];
            spark.age += dt;
            if (spark.age >= spark.life) {
                sparks.splice(index, 1);
                continue;
            }
            spark.vy -= 16 * dt;
            spark.x += spark.vx * dt;
            spark.y += spark.vy * dt;
            spark.z += spark.vz * dt;
            if (spark.y < 0.14 && spark.vy < 0) {
                spark.y = 0.14;
                spark.vy *= -0.4;
            }
            const fade = 1 - spark.age / spark.life;
            const o = sparkCount * 3;
            sparkPositions[o] = spark.x;
            sparkPositions[o + 1] = spark.y;
            sparkPositions[o + 2] = spark.z;
            // HDR-ish colours so the bloom pass catches them: white-hot fading to orange.
            sparkColors[o] = 2.6 * fade + 0.4;
            sparkColors[o + 1] = (0.9 + spark.hot * 1.4) * fade;
            sparkColors[o + 2] = spark.hot * 0.5 * fade * fade;
            sparkCount += 1;
        }
        sparkGeometry.setDrawRange(0, sparkCount);
        sparkGeometry.attributes.position.needsUpdate = true;
        sparkGeometry.attributes.color.needsUpdate = true;
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
        sparks.length = 0;
        sparkGeometry.setDrawRange(0, 0);
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
        spawnSparks,
        updateParticles,
        spawnRain,
        updateRain,
        clear,
        get rainCount() {
            return rain.length;
        },
    };
}
