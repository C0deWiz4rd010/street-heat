import * as THREE from "three";
import { createAudioDirector } from "./audio.js";
import { markShared } from "./effects.js";
import { createInput } from "./input.js";
import { createRenderPipeline } from "./render.js";
import { createInitialState } from "./state.js";
import { createGameRuntime } from "./systems.js";
import { closeModal, closeTopModal, hideGameOver, mountHud, openModal, topModalPanel } from "./ui.js";
import { ACTION_LABELS, DEFAULT_BINDINGS, keyLabel, rebind } from "./bindings.js";
import { confirmFocus, moveFocus } from "./menuNav.js";
import { createOnboarding } from "./onboarding.js";
import { createSettings } from "./settings.js";
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

const camera = new THREE.PerspectiveCamera(56, window.innerWidth / window.innerHeight, 0.3, 260);
camera.position.set(0, 26, 10);

const renderer = new THREE.WebGLRenderer({ antialias: true });
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

markShared(...Object.values(sharedMaterials));

const world = createWorld(scene, sharedMaterials);
const lights = { ambient, sun, nightGlow };
const post = createRenderPipeline({ renderer, scene, camera, sun });
const runtime = createGameRuntime({ scene, camera, renderer, world, ui, state, sharedMaterials, audio, lights, post });
const settings = createSettings({
    prefersReducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
    onChange: (key) => applySetting(key),
});
state.settings = settings.values;
state.cameraMode = settings.values.cameraMode;
state.saveSettings = () => settings.save();
const onboarding = createOnboarding({
    isDone: () => settings.values.onboardingDone,
    onComplete: () => settings.set("onboardingDone", true),
});

function applySetting(key) {
    const v = settings.values;
    if (["master", "music", "sfx"].includes(key)) audio.setVolumes({ master: v.master, music: v.music, sfx: v.sfx });
    if (key === "muted") {
        audio.setMuted(v.muted);
        syncMuteButton();
    }
    if (key === "quality") post.setQuality(v.quality);
    if (key === "reducedMotion") post.setReducedMotion(v.reducedMotion);
    if (key === "cameraMode") state.cameraMode = v.cameraMode;
}

function syncMuteButton() {
    ui.muteBtn.textContent = settings.values.muted ? "🔇" : "🔊";
    ui.muteBtn.classList.toggle("muted", settings.values.muted);
    ui.muteBtn.setAttribute("aria-pressed", String(settings.values.muted));
}

for (const key of ["master", "music", "sfx", "muted", "quality", "reducedMotion"]) applySetting(key);
syncMuteButton();

// Which dialog or menu currently owns the controller (null while driving).
function menuScope() {
    const modal = topModalPanel();
    if (modal) return modal;
    if (state.screen === "garage") return ui.garagePanel;
    if (state.screen === "gameover") return ui.gameOver;
    if (state.screen === "menu") return ui.mainMenu;
    if (state.paused && state.screen === "playing") return ui.pauseOverlay;
    return null;
}

const input = createInput({
    bindings: settings.values.bindings,
    onRestart: () => {
        if (state.screen === "playing" || state.screen === "gameover") runtime.reset();
    },
    onSwitchCar: (index) => runtime.switchCar(index),
    onUserGesture: () => audio.unlock(),
    menuActive: () => menuScope() !== null,
    onMenuMove: (direction) => {
        const scope = menuScope();
        if (scope) moveFocus(scope, direction);
    },
    onMenuConfirm: () => {
        const scope = menuScope();
        if (scope) confirmFocus(scope);
    },
    onMenuBack: () => {
        if (topModalPanel()) closeTopModal();
        else if (state.screen === "garage") runtime.closeGarage();
        else if (state.paused && state.screen === "playing") state.paused = false;
    },
    onPadConnection: (connected) => {
        state.statusMessage = connected ? "Controller verbunden." : "Controller getrennt.";
        state.statusTimer = 2.5;
    },
});
state.rumble = (force) => input.rumble(force);

// Key rebinding list inside the settings dialog.
const bindingList = document.getElementById("bindingList");
function renderBindings() {
    bindingList.innerHTML = "";
    for (const action of Object.keys(DEFAULT_BINDINGS)) {
        const row = document.createElement("div");
        row.className = "binding-row";
        const label = document.createElement("span");
        label.textContent = ACTION_LABELS[action];
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = keyLabel(settings.values.bindings[action]);
        button.setAttribute("aria-label", `${ACTION_LABELS[action]}: Taste ${keyLabel(settings.values.bindings[action])}, zum Ändern drücken`);
        button.addEventListener("click", () => {
            button.textContent = "Taste drücken …";
            input.captureNextKey((key) => {
                if (key) {
                    const next = rebind(settings.values.bindings, action, key);
                    settings.set("bindings", next);
                    input.setBindings(settings.values.bindings);
                }
                renderBindings();
            });
        });
        row.append(label, button);
        bindingList.append(row);
    }
}
renderBindings();
document.getElementById("bindingReset").addEventListener("click", () => {
    settings.set("bindings", { ...DEFAULT_BINDINGS });
    input.setBindings(settings.values.bindings);
    renderBindings();
});

ui.restartBtn.addEventListener("click", () => runtime.reset());
ui.muteBtn.addEventListener("click", () => {
    audio.unlock();
    settings.set("muted", !settings.values.muted);
});

// Pause menu
ui.pauseResumeBtn.addEventListener("click", () => {
    state.paused = false;
});
ui.pauseSettingsBtn.addEventListener("click", () => openSettings());
ui.pauseRestartBtn.addEventListener("click", () => runtime.reset());
ui.pauseMenuBtn.addEventListener("click", () => runtime.openMenu());

// Game over
ui.gameOverGarageBtn.addEventListener("click", () => {
    hideGameOver(ui);
    runtime.openGarage();
});
ui.gameOverMenuBtn.addEventListener("click", () => {
    hideGameOver(ui);
    runtime.openMenu();
});

// Settings, controls, wipe confirmation
const controlsById = (id) => document.getElementById(id);
const settingControls = {
    master: controlsById("setMaster"),
    music: controlsById("setMusic"),
    sfx: controlsById("setSfx"),
    quality: controlsById("setQuality"),
    cameraMode: controlsById("setCamera"),
    shake: controlsById("setShake"),
    reducedMotion: controlsById("setReduced"),
    muted: controlsById("setMuted"),
};

function syncSettingsPanel() {
    for (const [key, control] of Object.entries(settingControls)) {
        if (control.type === "checkbox") control.checked = Boolean(settings.values[key]);
        else control.value = settings.values[key];
    }
}

function openSettings() {
    audio.unlock();
    syncSettingsPanel();
    openModal(ui.settingsPanel);
}

for (const [key, control] of Object.entries(settingControls)) {
    control.addEventListener("input", () => {
        settings.set(key, control.type === "checkbox" ? control.checked : control.type === "range" ? Number(control.value) : control.value);
    });
}
controlsById("settingsCloseBtn").addEventListener("click", () => closeModal(ui.settingsPanel));
controlsById("setOnboarding").addEventListener("click", () => {
    settings.set("onboardingDone", false);
    onboarding.restart();
    state.statusMessage = "Tutorial zurückgesetzt. Es startet im nächsten Run.";
    state.statusTimer = 2.5;
});
ui.menuSettingsBtn.addEventListener("click", () => openSettings());
ui.menuControlsBtn.addEventListener("click", () => openModal(ui.controlsPanel));
controlsById("controlsCloseBtn").addEventListener("click", () => closeModal(ui.controlsPanel));
controlsById("confirmNoBtn").addEventListener("click", () => closeModal(ui.confirmPanel));
controlsById("confirmYesBtn").addEventListener("click", () => {
    closeModal(ui.confirmPanel);
    runtime.resetProfile();
});

// UI sounds: a tick when the pointer enters a button, a click when it is pressed.
let lastHovered = null;
document.addEventListener("mouseover", (event) => {
    const button = event.target.closest?.("button");
    if (button && button !== lastHovered && !button.disabled) audio.uiHover();
    lastHovered = button ?? null;
});
document.addEventListener("click", (event) => {
    if (event.target.closest?.("button")) audio.uiClick();
});

// Buttons keep focus after a click; drop it while driving so Space (drift) cannot re-trigger them.
document.addEventListener("click", (event) => {
    if (state.screen === "playing" && !state.paused) event.target.closest?.("button")?.blur();
});
ui.startBtn.addEventListener("click", () => {
    audio.unlock();
    runtime.startRun();
});
ui.garageBtn.addEventListener("click", () => runtime.openGarage());
ui.closeGarageBtn.addEventListener("click", () => runtime.closeGarage());
ui.wipeProfileBtn.addEventListener("click", () => openModal(ui.confirmPanel));
ui.paintList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-paint-id]");
    if (button) runtime.setPaint(button.dataset.paintId);
});
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

// Dev-only vehicle gallery: open the game with ?gallery.
let gallery = null;
if (import.meta.env.DEV && new URLSearchParams(location.search).has("gallery")) {
    import("./gallery.js").then(({ createGallery }) => {
        gallery = createGallery({ renderer, sharedMaterials });
        document.getElementById("app").style.display = "none";
    });
}

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (gallery) {
        gallery.render(dt);
        return;
    }
    input.update(dt);
    state.tip = onboarding.update(state, dt);
    runtime.update(dt, input);
}

window.addEventListener("resize", () => {
    post.resize();
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

if (import.meta.env.DEV) window.__street = { state, post, runtime, renderer, ui, audio };
