import * as THREE from "three";
import { createAudioDirector } from "./audio.js";
import { createInput } from "./input.js";
import { createInitialState } from "./state.js";
import { createGameRuntime } from "./systems.js";
import { mountHud } from "./ui.js";
import { createMaterial } from "./vehicles.js";
import { createWorld } from "./world.js";
import "./styles.css";

const app = document.getElementById("app");
const ui = mountHud(app);
const state = createInitialState();
const audio = createAudioDirector();

const scene = new THREE.Scene();
scene.background = new THREE.Color("#111720");
scene.fog = new THREE.Fog("#111720", 48, 130);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 260);
camera.position.set(0, 40, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.domElement.className = "game-canvas";
document.body.appendChild(renderer.domElement);

const ambient = new THREE.HemisphereLight("#cfd8ff", "#29323f", 1.25);
scene.add(ambient);

const sun = new THREE.DirectionalLight("#fff7df", 4.8);
sun.position.set(45, 58, -32);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -82;
sun.shadow.camera.right = 82;
sun.shadow.camera.top = 82;
sun.shadow.camera.bottom = -82;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 175;
sun.shadow.bias = -0.00035;
scene.add(sun);

const nightGlow = new THREE.PointLight("#63c8ff", 0.9, 120);
nightGlow.position.set(0, 22, 0);
scene.add(nightGlow);

const sharedMaterials = {
    asphalt: new THREE.MeshStandardMaterial({ color: "#30343a", roughness: 0.92, metalness: 0.03 }),
    sidewalk: new THREE.MeshStandardMaterial({ color: "#aaa89f", roughness: 0.72, metalness: 0.02 }),
    line: new THREE.MeshStandardMaterial({ color: "#eee9da", roughness: 0.5 }),
    grass: new THREE.MeshStandardMaterial({ color: "#2c5538", roughness: 0.84 }),
    tire: new THREE.MeshStandardMaterial({ color: "#08090a", roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({
        color: "#a9d9ff",
        roughness: 0.08,
        metalness: 0.55,
        transparent: true,
        opacity: 0.72,
    }),
    wheelGeometry: new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14),
    dark: createMaterial("#10151c", { roughness: 0.45, metalness: 0.25 }),
};

const world = createWorld(scene, sharedMaterials);
const runtime = createGameRuntime({ scene, camera, renderer, world, ui, state, sharedMaterials, audio });
const input = createInput({
    onRestart: () => runtime.reset(),
    onSwitchCar: (index) => runtime.switchCar(index),
    onUserGesture: () => audio.unlock(),
});

ui.restartBtn.addEventListener("click", () => runtime.reset());
ui.startBtn.addEventListener("click", () => {
    audio.unlock();
    runtime.startRun();
});
ui.garageBtn.addEventListener("click", () => runtime.openGarage());
ui.closeGarageBtn.addEventListener("click", () => runtime.closeGarage());
ui.wipeProfileBtn.addEventListener("click", () => runtime.resetProfile());
ui.carList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-car-index]");
    if (!button) return;
    runtime.buyOrSelectCar(Number(button.dataset.carIndex));
});
ui.upgradeList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-upgrade-id]");
    if (!button) return;
    runtime.buyUpgrade(button.dataset.upgradeId);
});
runtime.reset({ showMenu: true });

const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    runtime.update(Math.min(clock.getDelta(), 0.05), input);
}

window.addEventListener("resize", () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});

renderer.domElement.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    state.running = false;
    state.statusMessage = "Grafik-Kontext verloren. Bitte Seite neu laden.";
    state.statusTimer = 99;
});

animate();
