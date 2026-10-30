import { reputationTier } from "./progression.js";
import { REPUTATION_TIERS } from "./config.js";
import { ACHIEVEMENTS, COMBO_TIERS, PAINTS, CONFIG, CAR_MODELS, CONTRACTS, POIS, UPGRADES } from "./config.js";

// Colours come from the CSS tokens (:root) so the HUD canvas and the stylesheet stay in sync.
const palette = {};
function tok(name, fallback) {
    if (!palette[name]) palette[name] = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim() || fallback;
    return palette[name];
}

export function mountHud(root) {
    root.innerHTML = `
        <div id="hud">
            <div class="left-stack">
                <section class="panel score-panel">
                    <div class="label">Score</div>
                    <div class="score-row">
                        <div id="score">0</div>
                        <div id="cash">$0</div>
                    </div>
                    <div class="score-subrow">
                        <span>Best</span>
                        <strong id="bestScore">0</strong>
                    </div>
                    <div class="label" id="nearestPoi">Downtown | 0 m</div>
                    <div class="meta-row">
                        <span id="districtName">Downtown</span>
                        <strong id="weatherName">Klar</strong>
                    </div>
                </section>

                <section class="panel mission-panel">
                    <div class="label">Aktive Mission</div>
                    <div id="missionTitle">Street Run</div>
                    <div id="missionText">Sammle Beute und bleib in Bewegung.</div>
                    <div class="mission-target" id="missionTarget">Ziel wird markiert</div>
                    <div class="mission-bonus" id="missionBonus">Bonusziel wird geladen</div>
                    <div class="progress-track">
                        <div class="progress-fill" id="missionFill"></div>
                    </div>
                </section>
            </div>

            <div class="center-strip">
                <div class="tacho-chip">
                    <span class="label">Tempo</span>
                    <canvas id="tacho" width="120" height="62"></canvas>
                </div>
                <div class="chip">
                    <span class="label">Heat</span>
                    <div class="wanted-stars" id="stars">.....</div>
                </div>
                <div class="chip combo-chip" id="comboChip">
                    <span class="label">Combo</span>
                    <strong id="comboValue">x1.0</strong>
                    <small class="combo-name" id="comboName"></small>
                    <i class="combo-bar"><b id="comboFill"></b></i>
                </div>
                <div class="chip drift-chip" id="driftChip">
                    <span class="label">Drift</span>
                    <strong id="driftValue">0</strong>
                </div>
                <div class="chip">
                    <span class="label">Auto</span>
                    <strong id="carName">Comet</strong>
                </div>
            </div>

            <div class="right-stack">
                <section class="panel right-panel">
                    <div class="bar-block">
                        <div class="bar-head">
                            <span class="label">Karosserie</span>
                            <span class="bar-value" id="healthText">100%</span>
                        </div>
                        <div class="bar-track"><div class="bar-fill" id="healthFill"></div></div>
                    </div>
                    <div class="bar-block">
                        <div class="bar-head">
                            <span class="label">Nitro</span>
                            <span class="bar-value" id="nitroText">0%</span>
                        </div>
                        <div class="bar-track"><div class="bar-fill" id="nitroFill"></div></div>
                    </div>
                    <div class="bar-block">
                        <div class="bar-head">
                            <span class="label">Fahndung</span>
                            <span class="bar-value" id="wantedText">CLEAR</span>
                        </div>
                        <div class="bar-track"><div class="bar-fill" id="heatFill"></div></div>
                    </div>
                    <div class="event-strip">
                        <span id="eventLabel">Ruhige Straßen</span>
                        <strong id="eventTimer">--</strong>
                    </div>
                    <div class="contract-strip">
                        <span id="contractLabel">Contract</span>
                        <strong id="contractProgress">0/0</strong>
                    </div>
                    <div class="upgrade-grid" id="upgradeStatus"></div>
                    <canvas id="minimap" width="220" height="184"></canvas>
                </section>
            </div>
        </div>

        <button id="muteBtn" class="mute-btn" aria-label="Ton an/aus" title="Ton an/aus">&#128266;</button>

        <div id="speedLines"></div>
        <div id="popup" role="status" aria-live="polite"></div>
        <div id="actionPrompt"></div>
        <div id="status" role="status" aria-live="polite">Direkt im Spiel. Fahre los.</div>
        <div id="tip" role="status" aria-live="polite"></div>
        <div id="garageHint">WASD / Pfeile fahren<br>Leertaste Drift | Shift Nitro<br>Q Provoke (Heat +1, Multiplikator +0.5)<br>G Garage | C Kamera | Esc Pause | F3 Debug | F4 Grafik | R Neustart</div>

        <div id="touchControls" aria-label="Touch-Steuerung">
            <div id="stick" class="stick" role="application" aria-label="Lenk-Stick: nach oben Gas, nach unten Bremsen, seitlich Lenken">
                <div id="stickKnob" class="stick-knob"></div>
            </div>
            <div class="touch-actions">
                <button data-key="shift" aria-label="Nitro">N2O</button>
                <button data-key=" " aria-label="Drift">DR</button>
                <button data-key="q" aria-label="Provoke">PRO</button>
                <button data-key="e" aria-label="Interagieren">E</button>
            </div>
        </div>

        <div id="pauseOverlay" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">
            <div class="pause-card">
                <h2 id="pauseTitle">PAUSE</h2>
                <div class="menu-actions">
                    <button id="pauseResumeBtn">Weiter</button>
                    <button id="pauseSettingsBtn">Einstellungen</button>
                    <button id="pauseRestartBtn">Neustart</button>
                    <button id="pauseMenuBtn">Zum Menü</button>
                </div>
                <span>P oder Esc: Weiterfahren</span>
            </div>
        </div>

        <div id="mainMenu" class="menu-shell show">
            <section class="menu-panel">
                <h1 class="logo" aria-label="Street Heat"><span>STREET</span><span>HEAT</span></h1>
                <div class="menu-stats">
                    <span>Best <strong id="menuBest">0</strong></span>
                    <span>Bank <strong id="menuCash">$0</strong></span>
                    <span>Auto <strong id="menuCar">Comet</strong></span>
                </div>
                <div class="menu-contract" id="menuContract"></div>
                <div class="menu-actions">
                    <button id="startBtn">Run starten</button>
                    <button id="garageBtn">Garage</button>
                    <button id="menuSettingsBtn">Einstellungen</button>
                    <button id="menuControlsBtn">Steuerung</button>
                    <button id="wipeProfileBtn">Profil löschen</button>
                </div>
            </section>
        </div>

        <div id="garagePanel" class="side-drawer">
            <div class="drawer-head">
                <div>
                    <div class="label">Garage</div>
                    <h2>Fuhrpark & Upgrades</h2>
                </div>
                <button id="closeGarageBtn" aria-label="Garage schließen">X</button>
            </div>
            <div class="garage-cash">Bank <strong id="garageCash">$0</strong></div>
            <div class="garage-grid" id="carList"></div>
            <div class="paint-list" id="paintList" role="group" aria-label="Lackierung"></div>
            <div class="garage-upgrades" id="upgradeList"></div>
            <div class="achievement-list" id="achievementList"></div>
        </div>

        <div id="debugPanel"></div>

        <div id="gameOver" role="dialog" aria-labelledby="gameOverTitle">
            <h2 id="gameOverTitle">GAME OVER</h2>
            <div id="finalScore">Score: 0</div>
            <div id="finalStats"></div>
            <div class="menu-actions row">
                <button id="restartBtn">Nochmal</button>
                <button id="gameOverGarageBtn">Garage</button>
                <button id="gameOverMenuBtn">Menü</button>
            </div>
        </div>

        <div id="settingsPanel" class="modal" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" hidden>
            <div class="modal-card">
                <h2 id="settingsTitle">Einstellungen</h2>
                <label>Gesamtlautstärke <input type="range" id="setMaster" min="0" max="1" step="0.05"></label>
                <label>Musik <input type="range" id="setMusic" min="0" max="1" step="0.05"></label>
                <label>Effekte <input type="range" id="setSfx" min="0" max="1" step="0.05"></label>
                <label>Grafikqualität
                    <select id="setQuality">
                        <option value="low">Niedrig</option>
                        <option value="medium">Mittel</option>
                        <option value="high">Hoch</option>
                    </select>
                </label>
                <label>Kamera
                    <select id="setCamera">
                        <option value="near">Nah</option>
                        <option value="normal">Normal</option>
                        <option value="far">Weit</option>
                    </select>
                </label>
                <label>Screen-Shake <input type="range" id="setShake" min="0" max="1.5" step="0.1"></label>
                <label class="check"><input type="checkbox" id="setReduced"> Reduzierte Bewegung</label>
                <label class="check"><input type="checkbox" id="setMuted"> Ton aus</label>
                <p class="hint">Tastenbelegung: folgt mit der Controller-Unterstützung.</p>
                <div class="modal-actions">
                    <button id="setOnboarding">Tutorial zurücksetzen</button>
                    <button id="settingsCloseBtn">Schließen</button>
                </div>
            </div>
        </div>

        <div id="controlsPanel" class="modal" role="dialog" aria-modal="true" aria-labelledby="controlsTitle" hidden>
            <div class="modal-card">
                <h2 id="controlsTitle">Steuerung</h2>
                <dl class="controls-list">
                    <dt>W / ↑</dt><dd>Gas</dd>
                    <dt>S / ↓</dt><dd>Bremsen, Rückwärts</dd>
                    <dt>A D / ← →</dt><dd>Lenken</dd>
                    <dt>Leertaste</dt><dd>Handbremse und Drift</dd>
                    <dt>Shift</dt><dd>Nitro</dd>
                    <dt>Q</dt><dd>Provoke (Heat +1, mehr Punkte und Cash)</dd>
                    <dt>E</dt><dd>Interagieren (Garage, Abgabe)</dd>
                    <dt>G</dt><dd>Garage</dd>
                    <dt>C</dt><dd>Kamera wechseln</dd>
                    <dt>P / Esc</dt><dd>Pause</dd>
                    <dt>R</dt><dd>Run neu starten</dd>
                    <dt>F3 / F4</dt><dd>Debug / Grafikstufe</dd>
                </dl>
                <div class="modal-actions"><button id="controlsCloseBtn">Schließen</button></div>
            </div>
        </div>

        <div id="confirmPanel" class="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirmTitle" hidden>
            <div class="modal-card">
                <h2 id="confirmTitle">Profil löschen?</h2>
                <p>Cash, Autos, Upgrades, Ruf und Tags gehen unwiderruflich verloren.</p>
                <div class="modal-actions">
                    <button id="confirmNoBtn">Abbrechen</button>
                    <button id="confirmYesBtn" class="danger">Ja, löschen</button>
                </div>
            </div>
        </div>
    `;

    const minimap = document.getElementById("minimap");
    const tacho = document.getElementById("tacho");
    return {
        score: document.getElementById("score"),
        bestScore: document.getElementById("bestScore"),
        cash: document.getElementById("cash"),
        nearestPoi: document.getElementById("nearestPoi"),
        districtName: document.getElementById("districtName"),
        weatherName: document.getElementById("weatherName"),
        missionTitle: document.getElementById("missionTitle"),
        missionText: document.getElementById("missionText"),
        missionTarget: document.getElementById("missionTarget"),
        missionBonus: document.getElementById("missionBonus"),
        missionFill: document.getElementById("missionFill"),
        tacho,
        tachoCtx: tacho.getContext("2d"),
        stars: document.getElementById("stars"),
        comboChip: document.getElementById("comboChip"),
        comboValue: document.getElementById("comboValue"),
        comboName: document.getElementById("comboName"),
        comboFill: document.getElementById("comboFill"),
        driftChip: document.getElementById("driftChip"),
        driftValue: document.getElementById("driftValue"),
        carName: document.getElementById("carName"),
        healthText: document.getElementById("healthText"),
        healthFill: document.getElementById("healthFill"),
        nitroText: document.getElementById("nitroText"),
        nitroFill: document.getElementById("nitroFill"),
        wantedText: document.getElementById("wantedText"),
        heatFill: document.getElementById("heatFill"),
        eventLabel: document.getElementById("eventLabel"),
        eventTimer: document.getElementById("eventTimer"),
        contractLabel: document.getElementById("contractLabel"),
        contractProgress: document.getElementById("contractProgress"),
        upgradeStatus: document.getElementById("upgradeStatus"),
        minimap,
        mapContext: minimap.getContext("2d"),
        speedLines: document.getElementById("speedLines"),
        popup: document.getElementById("popup"),
        muteBtn: document.getElementById("muteBtn"),
        actionPrompt: document.getElementById("actionPrompt"),
        status: document.getElementById("status"),
        pauseOverlay: document.getElementById("pauseOverlay"),
        mainMenu: document.getElementById("mainMenu"),
        menuBest: document.getElementById("menuBest"),
        menuCash: document.getElementById("menuCash"),
        menuCar: document.getElementById("menuCar"),
        menuContract: document.getElementById("menuContract"),
        startBtn: document.getElementById("startBtn"),
        garageBtn: document.getElementById("garageBtn"),
        wipeProfileBtn: document.getElementById("wipeProfileBtn"),
        menuSettingsBtn: document.getElementById("menuSettingsBtn"),
        menuControlsBtn: document.getElementById("menuControlsBtn"),
        pauseResumeBtn: document.getElementById("pauseResumeBtn"),
        pauseSettingsBtn: document.getElementById("pauseSettingsBtn"),
        pauseRestartBtn: document.getElementById("pauseRestartBtn"),
        pauseMenuBtn: document.getElementById("pauseMenuBtn"),
        gameOverGarageBtn: document.getElementById("gameOverGarageBtn"),
        gameOverMenuBtn: document.getElementById("gameOverMenuBtn"),
        tip: document.getElementById("tip"),
        settingsPanel: document.getElementById("settingsPanel"),
        controlsPanel: document.getElementById("controlsPanel"),
        confirmPanel: document.getElementById("confirmPanel"),
        garagePanel: document.getElementById("garagePanel"),
        closeGarageBtn: document.getElementById("closeGarageBtn"),
        garageCash: document.getElementById("garageCash"),
        carList: document.getElementById("carList"),
        paintList: document.getElementById("paintList"),
        upgradeList: document.getElementById("upgradeList"),
        achievementList: document.getElementById("achievementList"),
        debugPanel: document.getElementById("debugPanel"),
        gameOver: document.getElementById("gameOver"),
        finalScore: document.getElementById("finalScore"),
        finalStats: document.getElementById("finalStats"),
        restartBtn: document.getElementById("restartBtn"),
    };
}

function setText(element, value) {
    if (element._text === value) return;
    element._text = value;
    element.textContent = value;
}

// Modal handling: focus moves into the dialog, Tab stays inside, Esc/close restores focus.
const modalStack = [];

export function isModalOpen() {
    return modalStack.length > 0;
}

export function openModal(panel) {
    if (!panel.hidden) return;
    panel.hidden = false;
    modalStack.push({ panel, returnTo: document.activeElement });
    panel.querySelector("input, select, button")?.focus();
}

export function closeModal(panel) {
    const index = modalStack.findIndex((entry) => entry.panel === panel);
    if (index < 0) return;
    const [entry] = modalStack.splice(index, 1);
    panel.hidden = true;
    entry.returnTo?.focus?.();
}

export function closeTopModal() {
    const top = modalStack.at(-1);
    if (top) closeModal(top.panel);
    return Boolean(top);
}

window.addEventListener("keydown", (event) => {
    if (!modalStack.length) return;
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeTopModal();
        return;
    }
    if (event.key === "Tab") {
        const focusable = [...modalStack.at(-1).panel.querySelectorAll("input, select, button")].filter((el) => !el.disabled);
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
        }
    }
    // Keep game keys (Space, arrows, letters) from steering the car behind an open dialog.
    if (event.key !== "Tab") event.stopImmediatePropagation();
}, true);

export function renderHud(ui, state, world, traffic, police, roadblocks = [], eventPickups = [], hazards = [], helicopter = null) {
    const player = state.player;
    const selectedCar = CAR_MODELS[state.playerModelIndex];
    ui.score.textContent = Math.round(state.score).toLocaleString("de-DE");
    ui.bestScore.textContent = Math.round(state.bestScore).toLocaleString("de-DE");
    ui.cash.textContent = `$${Math.round(state.cash).toLocaleString("de-DE")}`;
    renderTacho(ui, state, selectedCar);
    ui.carName.textContent = selectedCar.name;
    ui.districtName.textContent = state.district?.name ?? "Downtown";
    if (state.district) {
        const tierName = REPUTATION_TIERS[reputationTier(state.reputation[state.district.id] ?? 0).index].name;
        ui.districtName.textContent = `${state.district.name} · ${tierName}`;
    }
    const timeLabel = state.time?.label ?? "Tag";
    ui.weatherName.textContent = `${timeLabel} | ${state.weather?.label ?? "Klar"}`;

    const healthMax = CONFIG.player.maxHealth + state.upgrades.armor * 18;
    const nitroMax = CONFIG.player.nitroMax + state.upgrades.nitro * 18;
    ui.healthText.textContent = `${Math.round(player.health)}/${healthMax}`;
    ui.healthFill.style.width = `${clamp(player.health / healthMax, 0, 1) * 100}%`;
    ui.nitroText.textContent = `${Math.round(player.nitro)}/${nitroMax}`;
    ui.nitroFill.style.width = `${clamp(player.nitro / nitroMax, 0, 1) * 100}%`;
    ui.wantedText.textContent = state.wanted.tier ?? state.wanted.status;
    ui.heatFill.style.width = `${state.wanted.level / 5 * 100}%`;

    // Heat stars only re-render when the level changes.
    if (ui._heatLevel !== state.wanted.level) {
        ui._heatLevel = state.wanted.level;
        let stars = "";
        for (let index = 1; index <= 5; index += 1) {
            const active = index <= state.wanted.level;
            stars += `<span class="${active ? "active" : ""}">${active ? "\u2605" : "\u2606"}</span>`;
        }
        ui.stars.innerHTML = stars;
        ui.stars.setAttribute("aria-label", `Heat ${state.wanted.level} von 5`);
        ui.stars.closest(".chip")?.classList.toggle("heat-critical", state.wanted.level >= 4);
    }
    ui.comboValue.textContent = `x${state.combo.multiplier.toFixed(1)}`;
    ui.comboChip.classList.toggle("live", state.combo.timer > 0);
    const comboTier = [...COMBO_TIERS].reverse().find((tier) => state.combo.chain >= tier.chain);
    ui.comboName.textContent = comboTier && state.combo.timer > 0 ? comboTier.name : "";
    ui.comboFill.style.width = `${state.combo.timer > 0 ? Math.min(1, state.combo.timer / (state.combo.maxTimer || 4.2)) * 100 : 0}%`;
    ui.driftValue.textContent = Math.round(state.combo.driftScore);
    ui.driftChip.classList.toggle("live", state.player.drift > 0);

    const nearest = nearestPoi(state.player);
    ui.nearestPoi.textContent = `${nearest.poi.name} | ${Math.round(nearest.distance)} m`;
    renderMissionHud(ui, state);
    renderUpgradeHud(ui, state);
    renderEventHud(ui, state);
    renderContractHud(ui, state);
    renderProfileHud(ui, state);
    renderGarageHud(ui, state);
    renderMinimap(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter);
    renderDebug(ui, state, { traffic, police, roadblocks, eventPickups, hazards });

    setText(ui.status, state.statusMessage);
    setText(ui.tip, state.tip ?? "");
    ui.tip.classList.toggle("show", Boolean(state.tip) && state.screen === "playing" && !state.paused);
    ui.status.style.opacity = state.statusTimer > 0 ? "1" : "0.78";
    ui.actionPrompt.textContent = state.actionPrompt;
    ui.actionPrompt.classList.toggle("show", Boolean(state.actionPrompt));

    // Popup flash (near-miss, drift, etc.)
    const popup = state.popup;
    if (popup && popup.timer > 0) {
        setText(ui.popup, popup.text);
        ui.popup.className = `popup-show popup-${popup.type}`;
        ui.popup.style.opacity = String(Math.min(1, popup.timer * 2));
    } else {
        ui.popup.className = "";
        setText(ui.popup, "");
    }

    // Speed lines overlay
    const speedMag = state.screen === "playing" ? (player.speedMag ?? Math.abs(player.speed)) : 0;
    const selectedCarMaxSpeed = selectedCar.maxSpeed * 1.15;
    const speedRatio = Math.min(1, speedMag / selectedCarMaxSpeed);
    const linesOpacity = speedRatio > 0.6 ? ((speedRatio - 0.6) / 0.4) * 0.72 : 0;
    ui.speedLines.style.opacity = linesOpacity.toFixed(2);
    ui.pauseOverlay.classList.toggle("show", state.paused && state.screen === "playing");
    ui.mainMenu.classList.toggle("show", state.screen === "menu");
    ui.garagePanel.classList.toggle("show", state.screen === "garage");
}

const BREAKDOWN_LABELS = {
    drift: "Drift",
    nearMiss: "Near-Miss & Close Calls",
    pickups: "Pickups",
    props: "Zerstörte Props",
    missions: "Missionen",
    events: "Events",
    escape: "Flucht",
    other: "Sonstiges",
};

export function showGameOver(ui, state) {
    ui.finalScore.textContent = `Score: ${Math.round(state.score).toLocaleString("de-DE")}${state.stats.newRecord ? "  ★ NEUER REKORD" : ""}`;
    const rows = Object.entries(state.stats.breakdown)
        .filter(([, value]) => value > 0.5)
        .sort((a, b) => b[1] - a[1])
        .map(([key, value]) => `<li><span>${BREAKDOWN_LABELS[key] ?? key}</span><b>${Math.round(value).toLocaleString("de-DE")}</b></li>`)
        .join("");
    const unlocked = state.stats.unlocked.length ? `<p class="run-unlocked">Achievements: ${state.stats.unlocked.join(", ")}</p>` : "";
    ui.finalStats.innerHTML = `
        <p>${state.stats.missions} Missionen | ${state.stats.pickups} Pickups | ${state.stats.propsDestroyed} Props | Beste Combo ${state.combo.best}</p>
        <ul class="run-breakdown">${rows}</ul>
        <p class="run-cash">Verdientes Cash: <b>$${Math.round(state.stats.cashEarned).toLocaleString("de-DE")}</b></p>
        ${unlocked}`;
    ui.gameOver.classList.add("show");
}

export function hideGameOver(ui) {
    ui.gameOver.classList.remove("show");
}

function renderTacho(ui, state, carModel) {
    const ctx = ui.tachoCtx;
    const w = ui.tacho.width;
    const h = ui.tacho.height;
    ctx.clearRect(0, 0, w, h);

    const speedMag = state.screen === "playing" ? (state.player.speedMag ?? Math.abs(state.player.speed)) : 0;
    const maxSpeedKmh = carModel.maxSpeed * 12 * 1.18;
    const kmh = Math.round(Math.abs(state.player.speed) * 12);
    const ratio = Math.min(1, speedMag / (carModel.maxSpeed * 1.15));

    const cx = w / 2;
    const cy = h - 10;
    const radius = 46;
    const startAngle = Math.PI;
    const sweepAngle = Math.PI;
    const endAngle = startAngle + sweepAngle;

    ctx.lineWidth = 7;
    ctx.lineCap = "round";

    // Track
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();

    // Fill arc — color shifts red above 80%
    const fillEnd = startAngle + sweepAngle * ratio;
    const arcColor = ratio > 0.8
        ? `hsl(${Math.round(16 - ratio * 16)},100%,60%)`
        : ratio > 0.5
            ? `hsl(${Math.round(48 - (ratio - 0.5) * 64)},100%,62%)`
            : tok("blue", "#63c8ff");
    ctx.strokeStyle = arcColor;
    ctx.shadowBlur = ratio > 0.75 ? 14 : 0;
    ctx.shadowColor = arcColor;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, fillEnd);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Tick marks
    ctx.lineWidth = 2;
    for (let index = 0; index <= 8; index += 1) {
        const t = index / 8;
        const angle = startAngle + sweepAngle * t;
        const inner = index % 4 === 0 ? radius - 10 : radius - 6;
        ctx.strokeStyle = t <= ratio ? arcColor : "rgba(255,255,255,0.28)";
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
        ctx.lineTo(cx + Math.cos(angle) * (radius + 2), cy + Math.sin(angle) * (radius + 2));
        ctx.stroke();
    }

    // Nitro ring (inner arc) and rev ring (outer arc, simulated five gears).
    const nitroMax = CONFIG.player.nitroMax + state.upgrades.nitro * 18;
    const nitroRatio = Math.max(0, Math.min(1, state.player.nitro / nitroMax));
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 15, startAngle, endAngle);
    ctx.stroke();
    ctx.strokeStyle = state.player.nitroActive ? tok("orange", "#ff9c45") : tok("purple", "#c9a5ff");
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 15, startAngle, startAngle + sweepAngle * nitroRatio);
    ctx.stroke();
    const rev = (ratio * 5) % 1;
    ctx.lineWidth = 3;
    ctx.strokeStyle = rev > 0.85 ? tok("warn", "#ff3b3b") : "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(cx, cy, radius + 6, startAngle, startAngle + sweepAngle * rev);
    ctx.stroke();

    // Speed text
    ctx.fillStyle = tok("ink-hard", "#ffffff");
    ctx.font = "900 20px 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText(kmh, cx, cy + 2);

    ctx.fillStyle = "rgba(245,247,251,0.55)";
    ctx.font = "700 9px 'Segoe UI', system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("km/h", cx, cy + 3);
}

function renderMissionHud(ui, state) {
    const mission = state.mission;
    const timer = Math.max(0, Math.ceil(mission.timer));
    const target = currentMissionTarget(state);
    const bonusProgress = formatMissionBonus(mission);
    ui.missionTarget.textContent = target
        ? `Ziel: ${target.name} | ${Math.round(distanceTo(state.player, target))} m`
        : "Ziel: offene Straßen";
    ui.missionBonus.textContent = bonusProgress;

    if (mission.type === "pickup") {
        ui.missionTitle.textContent = `${mission.chainName} ${mission.chainStep}/${mission.chainLength}`;
        ui.missionText.textContent = `${mission.description} Fortschritt ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
        ui.missionFill.style.width = `${mission.progress / mission.target * 100}%`;
        return;
    }

    if (mission.type === "delivery") {
        ui.missionTitle.textContent = `${mission.chainName} ${mission.chainStep}/${mission.chainLength}`;
        ui.missionText.textContent = mission.cargo
            ? `${mission.description} Ziel ${mission.to.name}. Zeit ${timer}s.`
            : `${mission.description} Treffpunkt ${mission.from.name}. Zeit ${timer}s.`;
        ui.missionFill.style.width = mission.cargo ? "55%" : "20%";
        return;
    }

    if (mission.type === "checkpoint") {
        ui.missionTitle.textContent = `${mission.chainName} ${mission.chainStep}/${mission.chainLength}`;
        ui.missionText.textContent = `${mission.description} ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
        ui.missionFill.style.width = `${mission.progress / mission.target * 100}%`;
        return;
    }

    if (mission.type === "pursuit") {
        ui.missionTitle.textContent = `${mission.chainName} ${mission.chainStep}/${mission.chainLength}`;
        ui.missionText.textContent = `${mission.description} ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
        ui.missionFill.style.width = `${mission.progress / mission.target * 100}%`;
        return;
    }

    if (mission.type === "heist") {
        ui.missionTitle.textContent = `${mission.chainName} ${mission.chainStep}/${mission.chainLength}`;
        ui.missionText.textContent = mission.cargo
            ? `${mission.description} Ziel ${mission.to.name}. Zeit ${timer}s.`
            : `${mission.description} Einstieg ${mission.from.name}. Zeit ${timer}s.`;
        ui.missionFill.style.width = mission.cargo ? "62%" : "22%";
        return;
    }

    if (mission.type === "bossArmored") {
        ui.missionTitle.textContent = mission.chainName;
        ui.missionText.textContent = mission.cargo
            ? `${mission.description} Drop ${mission.to.name}. Zeit ${timer}s.`
            : `${mission.description} Hackfortschritt ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
        ui.missionFill.style.width = `${clamp(mission.progress / Math.max(1, mission.target), 0, 1) * 100}%`;
        return;
    }

    if (mission.type === "bossHeli") {
        ui.missionTitle.textContent = mission.chainName;
        ui.missionText.textContent = `${mission.description} Fortschritt ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
        ui.missionFill.style.width = `${clamp(mission.progress / Math.max(1, mission.target), 0, 1) * 100}%`;
        return;
    }

    if (mission.type === "bossBlockade") {
        ui.missionTitle.textContent = mission.chainName;
        ui.missionText.textContent = `${mission.description} Durchbrüche ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
        ui.missionFill.style.width = `${clamp(mission.progress / Math.max(1, mission.target), 0, 1) * 100}%`;
        return;
    }

    ui.missionTitle.textContent = `${mission.chainName} ${mission.chainStep}/${mission.chainLength}`;
    ui.missionText.textContent = `${mission.description} Ziel ${mission.to.name}. Zeit ${timer}s.`;
    ui.missionFill.style.width = `${clamp(1 - mission.timer / (34 + mission.stage * 4), 0, 1) * 100}%`;
}

function renderUpgradeHud(ui, state) {
    ui.upgradeStatus.innerHTML = Object.entries(UPGRADES).map(([id, upgrade]) => {
        const level = state.upgrades[id] ?? 0;
        return `<div><span>${upgrade.label}</span><strong>${level}/${upgrade.max}</strong></div>`;
    }).join("");
}

function renderEventHud(ui, state) {
    // The event strip only shows while an event is actually running.
    const strip = ui.eventLabel.parentElement;
    strip.hidden = !state.worldEvent.active;
    if (!state.worldEvent.active) return;
    ui.eventLabel.textContent = state.worldEvent.label;
    ui.eventTimer.textContent = `${Math.ceil(state.worldEvent.timer)}s`;
}

function renderContractHud(ui, state) {
    const contract = CONTRACTS.find((item) => item.id === state.contract.id) ?? CONTRACTS[0];
    ui.contractLabel.parentElement.hidden = state.contract.claimed;
    ui.contractLabel.textContent = contract.label;
    ui.contractProgress.textContent = state.contract.claimed ? "Done" : `${state.contract.progress}/${contract.target}`;
    ui.menuContract.innerHTML = `
        <span>${contract.label}</span>
        <small>${contract.description}</small>
        <strong>${state.contract.claimed ? "Abgeschlossen" : `${state.contract.progress}/${contract.target} | $${contract.reward}`}</strong>
    `;
}

function renderProfileHud(ui, state) {
    const car = CAR_MODELS[state.playerModelIndex];
    ui.menuBest.textContent = Math.round(state.bestScore).toLocaleString("de-DE");
    ui.menuCash.textContent = `$${Math.round(state.cash).toLocaleString("de-DE")}`;
    ui.menuCar.textContent = car.name;
}

function renderGarageHud(ui, state) {
    // Rebuilding the buttons every frame would drop keyboard focus, so only redraw on change.
    const signature = JSON.stringify([Math.round(state.cash), state.unlockedCars, state.playerModelIndex, state.upgrades, state.paint, state.unlocks, state.achievements.length, state.screen === "garage"]);
    if (ui._garageSignature === signature) return;
    ui._garageSignature = signature;
    ui.paintList.innerHTML = PAINTS.map((paint) => {
        const locked = paint.unlock && !state.unlocks.includes(paint.unlock);
        const active = state.paint === paint.id;
        return `<button class="paint-swatch ${active ? "selected" : ""}" data-paint-id="${paint.id}" aria-pressed="${active}" ${locked ? `disabled title="Gesperrt: ${paint.unlock}"` : ""} style="--swatch:${paint.color ?? "#888"}">${paint.label}</button>`;
    }).join("");
    ui.garageCash.textContent = `$${Math.round(state.cash).toLocaleString("de-DE")}`;
    ui.carList.innerHTML = CAR_MODELS.map((car, index) => {
        const unlocked = state.unlockedCars.includes(car.id);
        const selected = index === state.playerModelIndex;
        const action = unlocked ? (selected ? "Aktiv" : "Wählen") : `$${car.unlockCost}`;
        const stats = [
            { label: "Speed", value: car.maxSpeed / 24, color: tok("blue", "#63c8ff") },
            { label: "Accel", value: car.acceleration / 32, color: tok("green", "#57d68d") },
            { label: "Turn", value: car.turn / 4.3, color: tok("purple", "#c9a5ff") },
            { label: "Masse", value: 1 - (car.mass - 0.72) / 1.18, color: tok("gold", "#ffc64d") },
        ];
        const statHtml = stats.map(({ label, value, color }) =>
            `<div class="stat-bar-row">
                <span class="stat-bar-label">${label}</span>
                <div class="stat-bar-track">
                    <div class="stat-bar-fill" style="width:${Math.round(Math.min(1, Math.max(0, value)) * 100)}%;background:${color}"></div>
                </div>
            </div>`
        ).join("");
        return `
            <button class="garage-card ${selected ? "selected" : ""}" data-car-index="${index}">
                <span>${car.name}</span>
                <small>${car.description}</small>
                <div class="stat-bars">${statHtml}</div>
                <strong>${action}</strong>
            </button>
        `;
    }).join("");

    ui.upgradeList.innerHTML = Object.entries(UPGRADES).map(([id, upgrade]) => {
        const level = state.upgrades[id] ?? 0;
        const capped = level >= upgrade.max;
        const cost = getUpgradeCost(id, level, upgrade);
        return `
            <button class="upgrade-card" data-upgrade-id="${id}" ${capped ? "disabled" : ""}>
                <span>${upgrade.label} ${level}/${upgrade.max}</span>
                <small>${upgrade.effect}</small>
                <strong>${capped ? "Max" : `$${cost}`}</strong>
            </button>
        `;
    }).join("");

    ui.achievementList.innerHTML = `
        <h3>Achievements</h3>
        ${ACHIEVEMENTS.map((achievement) => {
            const unlocked = state.achievements.includes(achievement.id);
            return `
                <div class="achievement-row ${unlocked ? "unlocked" : ""}">
                    <span>${achievement.label}</span>
                    <small>${achievement.description}</small>
                    <strong>${unlocked ? "Done" : `$${achievement.reward}`}</strong>
                </div>
            `;
        }).join("")}
    `;
}

function renderDebug(ui, state, groups) {
    ui.debugPanel.classList.toggle("show", state.debug.enabled);
    if (!state.debug.enabled) return;
    const entityCount = groups.traffic.length + groups.police.length + groups.roadblocks.length + groups.eventPickups.length + groups.hazards.length;
    ui.debugPanel.innerHTML = `
        FPS ${Math.round(state.debug.fps)}<br>
        Entities ${entityCount}<br>
        Draw Calls ${state.debug.drawCalls}<br>
        Dreiecke ${Math.round(state.debug.triangles / 1000)}k<br>
        Geometrien ${state.debug.geometries} | Texturen ${state.debug.textures}<br>
        Zeit ${state.time.label}<br>
        Weather ${state.weather.label}<br>
        Heat ${state.wanted.level} ${state.wanted.tier}<br>
        Heli ${state.helicopter.active ? state.helicopter.pressure.toFixed(2) : "off"}<br>
        Pos ${state.player.x.toFixed(1)}, ${state.player.z.toFixed(1)}
    `;
}

function renderMinimap(ui, state, world, traffic, police, roadblocks, eventPickups, hazards, helicopter) {
    const ctx = ui.mapContext;
    const width = ui.minimap.width;
    const height = ui.minimap.height;
    const cx = width / 2;
    const cy = height / 2;
    const visibility = state.weather?.mode === "fog"
        ? 0.68
        : state.weather?.mode === "storm"
            ? 0.82
            : 1;
    const timeRangeFactor = state.time?.phase === "night" ? 0.88 : 1;
    const minimapRange = CONFIG.ui.minimapRange * visibility * timeRangeFactor;
    const scale = Math.min(width, height) / (minimapRange * 2);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = tok("map-bg", "#091017");
    ctx.fillRect(0, 0, width, height);

    // District quadrant tints
    for (const district of world.districts ?? []) {
        const qx = cx + (district.x * CONFIG.map.size / 4 - state.player.x) * scale;
        const qy = cy + (district.z * CONFIG.map.size / 4 - state.player.z) * scale;
        const half = (CONFIG.map.size / 4) * scale;
        ctx.fillStyle = district.color + "22";
        ctx.fillRect(qx - half, qy - half, half * 2, half * 2);
    }

    ctx.strokeStyle = "rgba(255,255,255,0.09)";
    ctx.lineWidth = 1;

    for (const street of CONFIG.map.streets) {
        const x = cx + (street - state.player.x) * scale;
        const y = cy + (street - state.player.z) * scale;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    for (const zone of world.scannerZones ?? []) drawMapScannerZone(ctx, state, cx, cy, scale, width, height, zone);
    for (const poi of world.pointsOfInterest) drawMapDot(ctx, state, cx, cy, scale, width, height, poi.x, poi.z, poi.color, 4.5);
    for (const car of traffic) drawMapDot(ctx, state, cx, cy, scale, width, height, car.x, car.z, tok("traffic", "#e8e2ce"), 2);
    for (const agent of police) drawMapDot(ctx, state, cx, cy, scale, width, height, agent.x, agent.z, tok("red", "#ff5a4c"), 3);
    for (const block of roadblocks) drawMapDot(ctx, state, cx, cy, scale, width, height, block.x, block.z, tok("orange", "#ff9c45"), 3.5);
    for (const event of eventPickups) drawMapRing(ctx, state, cx, cy, scale, width, height, event.x, event.z, event.color);
    for (const hazard of hazards) {
        if (hazard.warn > 0) drawMapWarning(ctx, state, cx, cy, scale, width, height, hazard.x, hazard.z);
        else drawMapDot(ctx, state, cx, cy, scale, width, height, hazard.x, hazard.z, tok("ice", "#f7fbff"), 2.5);
    }
    // Graffiti tags only show up when you are close.
    for (const tag of world.tags ?? []) {
        if (tag.collected) continue;
        if ((tag.x - state.player.x) ** 2 + (tag.z - state.player.z) ** 2 > 34 * 34) continue;
        drawMapDiamond(ctx, state, cx, cy, scale, width, height, tag.x, tag.z, tok("pink", "#ff7ad9"));
    }
    if (state.race?.active) {
        const nextCheckpoint = state.race.checkpoints[state.race.player.index];
        if (nextCheckpoint) drawMapRing(ctx, state, cx, cy, scale, width, height, nextCheckpoint.x, nextCheckpoint.z, tok("mint", "#79ffb3"));
        for (const racer of state.race.racers) drawMapDiamond(ctx, state, cx, cy, scale, width, height, racer.x, racer.z, tok("mint", "#79ffb3"));
    }
    if (helicopter?.visible) drawMapRing(ctx, state, cx, cy, scale, width, height, state.helicopter.x, state.helicopter.z, tok("ice", "#f7fbff"));

    const target = currentMissionTarget(state);
    if (target) drawMapRing(ctx, state, cx, cy, scale, width, height, target.x, target.z, tok("ink-hard", "#ffffff"));

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-state.player.rotation);
    ctx.fillStyle = tok("ink-hard", "#ffffff");
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5, 6);
    ctx.lineTo(-5, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

function drawMapDot(ctx, state, cx, cy, scale, width, height, x, z, color, radius) {
    const mx = cx + (x - state.player.x) * scale;
    const my = cy + (z - state.player.z) * scale;
    if (mx < -10 || mx > width + 10 || my < -10 || my > height + 10) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(mx, my, radius, 0, Math.PI * 2);
    ctx.fill();
}

// Shapes differ (triangle = warning, diamond = collectible/rival) so the map does not rely on colour alone.
function drawMapWarning(ctx, state, cx, cy, scale, width, height, x, z) {
    const mx = cx + (x - state.player.x) * scale;
    const my = cy + (z - state.player.z) * scale;
    if (mx < -12 || mx > width + 12 || my < -12 || my > height + 12) return;
    const blink = Math.floor(performance.now() / 220) % 2 === 0;
    ctx.fillStyle = blink ? tok("warn", "#ff3b3b") : tok("warn-alt", "#ffd24d");
    ctx.beginPath();
    ctx.moveTo(mx, my - 7);
    ctx.lineTo(mx + 6, my + 5);
    ctx.lineTo(mx - 6, my + 5);
    ctx.closePath();
    ctx.fill();
}

function drawMapDiamond(ctx, state, cx, cy, scale, width, height, x, z, color) {
    const mx = cx + (x - state.player.x) * scale;
    const my = cy + (z - state.player.z) * scale;
    if (mx < -10 || mx > width + 10 || my < -10 || my > height + 10) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(mx, my - 4.5);
    ctx.lineTo(mx + 4.5, my);
    ctx.lineTo(mx, my + 4.5);
    ctx.lineTo(mx - 4.5, my);
    ctx.closePath();
    ctx.fill();
}

function drawMapRing(ctx, state, cx, cy, scale, width, height, x, z, color) {
    const mx = cx + (x - state.player.x) * scale;
    const my = cy + (z - state.player.z) * scale;
    if (mx < -12 || mx > width + 12 || my < -12 || my > height + 12) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(mx, my, 8, 0, Math.PI * 2);
    ctx.stroke();
}

function drawMapScannerZone(ctx, state, cx, cy, scale, width, height, zone) {
    const mx = cx + (zone.x - state.player.x) * scale;
    const my = cy + (zone.z - state.player.z) * scale;
    const radius = zone.radius * scale;
    if (mx < -radius || mx > width + radius || my < -radius || my > height + radius) return;
    const color = zone.color ?? tok("blue", "#63c8ff");
    ctx.strokeStyle = color.replace("#", "#");
    ctx.globalAlpha = 0.24;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(mx, my, Math.max(4, radius), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function formatMissionBonus(mission) {
    const bonus = mission.bonus;
    if (!bonus) return "Bonusziel: offline";
    const complete = bonus.completed ? "Done" : `${bonus.progress}/${bonus.target}`;
    const hotDrop = mission.cashoutMultiplier > 1 ? ` | Hot Drop x${mission.cashoutMultiplier.toFixed(2)}` : "";
    return `Bonus: ${bonus.label} | ${complete} | $${bonus.reward}${hotDrop}`;
}

function currentMissionTarget(state) {
    const mission = state.mission;
    if (mission.type === "pickup") return mission.to;
    if (mission.type === "bossArmored") return mission.cargo ? mission.to : mission.from;
    if (mission.type === "bossHeli" || mission.type === "bossBlockade") return mission.to;
    if (mission.type === "delivery" || mission.type === "heist") return mission.cargo ? mission.to : mission.from;
    if (mission.type === "escape") return mission.to;
    if (mission.type === "checkpoint") return mission.route[mission.routeIndex] ?? null;
    return null;
}

function distanceTo(player, target) {
    const dx = player.x - target.x;
    const dz = player.z - target.z;
    return Math.sqrt(dx * dx + dz * dz);
}

function nearestPoi(player) {
    let best = POIS[0];
    let bestD = Infinity;
    for (const poi of POIS) {
        const dx = player.x - poi.x;
        const dz = player.z - poi.z;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq < bestD) {
            bestD = distanceSq;
            best = poi;
        }
    }
    return { poi: best, distance: Math.sqrt(bestD) };
}

function getUpgradeCost(id, level, upgrade) {
    return Math.round(upgrade.baseCost * (1 + level * 0.72 + level * level * 0.18) / 10) * 10;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
