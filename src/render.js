import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";

const QUALITY_KEY = "street-heat-quality";

export const QUALITY_LEVELS = {
    low: { label: "Niedrig", pixelRatio: 1, bloom: false, shadowMap: 1024, particleDensity: 0.5 },
    medium: { label: "Mittel", pixelRatio: 1.5, bloom: true, shadowMap: 2048, particleDensity: 0.8 },
    high: { label: "Hoch", pixelRatio: 2, bloom: true, shadowMap: 3072, particleDensity: 1 },
};

const SHADOW_HALF_EXTENT = 35;
const SUN_OFFSET = new THREE.Vector3(45, 58, -32);
const dayTop = new THREE.Color("#2c4a7a");
const nightTop = new THREE.Color("#150a2e");
const glowDay = new THREE.Color("#ffb070");
const glowNight = new THREE.Color("#ff3fa4");

const GRADE_SHADER = {
    name: "StreetHeatGrade",
    uniforms: {
        tDiffuse: { value: null },
        uVignette: { value: 0.32 },
        uAberration: { value: 0 },
        uSaturation: { value: 1.08 },
        uLift: { value: new THREE.Color(0, 0, 0) },
        uGain: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform float uVignette;
        uniform float uAberration;
        uniform float uSaturation;
        uniform vec3 uLift;
        uniform vec3 uGain;
        varying vec2 vUv;
        void main() {
            vec2 fromCenter = vUv - 0.5;
            float dist = length(fromCenter);
            vec2 shift = fromCenter * uAberration * dist;
            vec3 col = vec3(
                texture2D(tDiffuse, vUv + shift).r,
                texture2D(tDiffuse, vUv).g,
                texture2D(tDiffuse, vUv - shift).b
            );
            col = col * uGain + uLift;
            float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
            col = mix(vec3(luma), col, uSaturation);
            float vig = smoothstep(0.82, 0.18, dist * (1.0 + uVignette));
            col *= mix(1.0 - uVignette, 1.0, vig);
            gl_FragColor = vec4(max(col, 0.0), 1.0);
        }
    `,
};

const SKY_VERTEX = /* glsl */ `
    varying vec3 vDir;
    void main() {
        vDir = normalize(position);
        vec4 pos = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = pos.xyww;
    }
`;

const SKY_FRAGMENT = /* glsl */ `
    uniform vec3 uTop;
    uniform vec3 uHorizon;
    uniform vec3 uGlow;
    uniform float uGlowAmount;
    varying vec3 vDir;
    void main() {
        float h = clamp(vDir.y * 1.6 + 0.12, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.7));
        col += uGlow * uGlowAmount * pow(1.0 - h, 3.0);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
    }
`;

const GRADES = {
    day: { lift: [0, 0, 0], gain: [1.02, 1.0, 0.97], saturation: 1.06, vignette: 0.26, bloom: [0.22, 0.5, 1.05] },
    dusk: { lift: [0.006, 0.0, 0.01], gain: [1.05, 0.95, 0.98], saturation: 1.14, vignette: 0.32, bloom: [0.3, 0.6, 0.95] },
    night: { lift: [0.012, 0.0, 0.026], gain: [0.9, 0.96, 1.16], saturation: 1.22, vignette: 0.4, bloom: [0.55, 0.7, 0.78] },
};

function loadQuality() {
    try {
        const stored = localStorage.getItem(QUALITY_KEY);
        if (stored && QUALITY_LEVELS[stored]) return stored;
    } catch {
        // storage can be blocked; fall through to default
    }
    return "medium";
}

export function createRenderPipeline({ renderer, scene, camera, sun }) {
    let quality = loadQuality();
    renderer.info.autoReset = false;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.3, 0.55, 0.95);
    composer.addPass(bloomPass);
    const gradePass = new ShaderPass(GRADE_SHADER);
    composer.addPass(gradePass);
    composer.addPass(new OutputPass());

    const grade = gradePass.uniforms;

    // Sky dome follows the camera and is tinted from the weather colour.
    const skyUniforms = {
        uTop: { value: new THREE.Color("#0b1020") },
        uHorizon: { value: new THREE.Color("#111720") },
        uGlow: { value: new THREE.Color("#ff4fa8") },
        uGlowAmount: { value: 0 },
    };
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(200, 24, 12),
        new THREE.ShaderMaterial({
            uniforms: skyUniforms,
            vertexShader: SKY_VERTEX,
            fragmentShader: SKY_FRAGMENT,
            side: THREE.BackSide,
            depthWrite: false,
            fog: false,
        })
    );
    sky.frustumCulled = false;
    sky.renderOrder = -1000;
    scene.add(sky);

    // Image-based lighting so metal and glass reflect something.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.32;
    pmrem.dispose();

    scene.add(sun.target);

    const tmpTop = new THREE.Color();
    const target = { lift: new THREE.Color(), gain: new THREE.Color(), saturation: 1, vignette: 0.3 };
    let bloomTarget = [0.3, 0.55, 0.95];
    let nitroBlend = 0;
    let lightning = 0;
    const shadowStep = (SHADOW_HALF_EXTENT * 2) / 2048;

    function applyQuality() {
        const q = QUALITY_LEVELS[quality];
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        composer.setPixelRatio(renderer.getPixelRatio());
        composer.setSize(w, h);
        bloomPass.enabled = q.bloom;
        if (sun.shadow.mapSize.x !== q.shadowMap) {
            sun.shadow.mapSize.set(q.shadowMap, q.shadowMap);
            sun.shadow.map?.dispose();
            sun.shadow.map = null;
        }
    }

    function setQuality(level) {
        if (!QUALITY_LEVELS[level]) return;
        quality = level;
        try {
            localStorage.setItem(QUALITY_KEY, level);
        } catch {
            // ignore blocked storage
        }
        applyQuality();
    }

    function cycleQuality() {
        const keys = Object.keys(QUALITY_LEVELS);
        setQuality(keys[(keys.indexOf(quality) + 1) % keys.length]);
        return quality;
    }

    /** Called from weather visuals: base colour (fog), night factor 0..1 and weather mode. */
    function setAtmosphere(color, night, weatherMode) {
        skyUniforms.uHorizon.value.copy(color);
        tmpTop.copy(color).multiplyScalar(0.55 - 0.2 * night);
        tmpTop.lerp(dayTop, (weatherMode === "clear" ? 0.45 : 0.15) * (1 - night));
        tmpTop.lerp(nightTop, 0.5 * night);
        skyUniforms.uTop.value.copy(tmpTop);
        skyUniforms.uGlowAmount.value = 0.1 + 0.4 * night;
        skyUniforms.uGlow.value.copy(glowDay).lerp(glowNight, night);

        const base = GRADES[weatherMode === "storm" || weatherMode === "fog" ? "dusk" : "day"];
        const g = GRADES.night;
        const mix = (a, b) => a + (b - a) * night;
        target.lift.setRGB(mix(base.lift[0], g.lift[0]), mix(base.lift[1], g.lift[1]), mix(base.lift[2], g.lift[2]));
        target.gain.setRGB(mix(base.gain[0], g.gain[0]), mix(base.gain[1], g.gain[1]), mix(base.gain[2], g.gain[2]));
        target.saturation = mix(base.saturation, g.saturation);
        target.vignette = mix(base.vignette, g.vignette);
        bloomTarget = [mix(base.bloom[0], g.bloom[0]), mix(base.bloom[1], g.bloom[1]), mix(base.bloom[2], g.bloom[2])];
    }

    /** 1 = full day, 0 = night: the sun travels from a low western angle up to its noon spot. */
    function setDaylight(day) {
        SUN_OFFSET.set(-40 + 85 * day, 30 + 28 * day, -32);
    }

    function flashLightning(amount) {
        lightning = Math.max(lightning, amount);
    }

    function updateShadowFollow(player) {
        // Snap the shadow focus to texel increments so shadows do not shimmer.
        const sx = Math.round(player.x / shadowStep) * shadowStep;
        const sz = Math.round(player.z / shadowStep) * shadowStep;
        sun.target.position.set(sx, 0, sz);
        sun.position.set(sx + SUN_OFFSET.x, SUN_OFFSET.y, sz + SUN_OFFSET.z);
        sun.target.updateMatrixWorld();
    }

    function render(dt, player) {
        const k = 1 - Math.exp(-dt * 3);
        grade.uLift.value.lerp(target.lift, k);
        grade.uGain.value.lerp(target.gain, k);
        grade.uSaturation.value += (target.saturation - grade.uSaturation.value) * k;
        grade.uVignette.value += (target.vignette - grade.uVignette.value) * k;

        const nitro = player?.nitroActive ? 1 : 0;
        nitroBlend += (nitro - nitroBlend) * (1 - Math.exp(-dt * 6));
        grade.uAberration.value = nitroBlend * 0.014;

        lightning = Math.max(0, lightning - dt * 2.4);
        bloomPass.strength += (bloomTarget[0] + lightning * 0.5 - bloomPass.strength) * k;
        bloomPass.radius = bloomTarget[1];
        bloomPass.threshold = bloomTarget[2];
        const baseExposure = renderer.toneMappingExposure;
        renderer.toneMappingExposure = baseExposure + lightning * 0.9;

        if (player) updateShadowFollow(player);
        sky.position.copy(camera.position);

        renderer.info.reset();
        composer.render(dt);
        renderer.toneMappingExposure = baseExposure;
    }

    function resize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        composer.setSize(w, h);
    }

    // Shadow frustum is fixed to the tight follow box.
    const sc = sun.shadow.camera;
    sc.left = -SHADOW_HALF_EXTENT;
    sc.right = SHADOW_HALF_EXTENT;
    sc.top = SHADOW_HALF_EXTENT;
    sc.bottom = -SHADOW_HALF_EXTENT;
    sc.near = 20;
    sc.far = 140;
    sc.updateProjectionMatrix();

    applyQuality();

    return {
        render,
        resize,
        setQuality,
        cycleQuality,
        getQuality: () => quality,
        getQualityConfig: () => QUALITY_LEVELS[quality],
        setAtmosphere,
        setDaylight,
        flashLightning,
    };
}
