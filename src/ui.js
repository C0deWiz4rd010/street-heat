import { ACHIEVEMENTS, CONFIG, CAR_MODELS, CONTRACTS, POIS, UPGRADES } from "./config.js";

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
                <div class="chip">
                    <span class="label">Tempo</span>
                    <strong id="speed">0</strong>
                    <span class="label">km/h</span>
                </div>
                <div class="chip">
                    <span class="label">Heat</span>
                    <div class="wanted-stars" id="stars">.....</div>
                </div>
                <div class="chip combo-chip" id="comboChip">
                    <span class="label">Combo</span>
                    <strong id="comboValue">x1.0</strong>
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
                        <span id="eventLabel">Ruhige Strassen</span>
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

        <div id="actionPrompt"></div>
        <div id="status">Direkt im Spiel. Fahre los.</div>
        <div id="garageHint">WASD / Pfeile fahren<br>Leertaste Drift | Shift Nitro<br>G Garage | F3 Debug | R Neustart</div>

        <div id="touchControls" aria-label="Touch-Steuerung">
            <div class="touch-pad">
                <button data-key="w" aria-label="Beschleunigen">W</button>
                <button data-key="a" aria-label="Links">A</button>
                <button data-key="s" aria-label="Bremsen">S</button>
                <button data-key="d" aria-label="Rechts">D</button>
            </div>
            <div class="touch-actions">
                <button data-key="shift" aria-label="Nitro">N2O</button>
                <button data-key=" " aria-label="Drift">DR</button>
                <button data-key="e" aria-label="Interagieren">E</button>
            </div>
        </div>

        <div id="pauseOverlay">
            <div>PAUSE</div>
            <span>P druecken zum Weiterfahren</span>
        </div>

        <div id="mainMenu" class="menu-shell show">
            <section class="menu-panel">
                <div class="label">Street Heat</div>
                <h1>Street Heat</h1>
                <div class="menu-stats">
                    <span>Best <strong id="menuBest">0</strong></span>
                    <span>Bank <strong id="menuCash">$0</strong></span>
                    <span>Auto <strong id="menuCar">Comet</strong></span>
                </div>
                <div class="menu-contract" id="menuContract"></div>
                <div class="menu-actions">
                    <button id="startBtn">Run starten</button>
                    <button id="garageBtn">Garage</button>
                    <button id="wipeProfileBtn">Profil loeschen</button>
                </div>
            </section>
        </div>

        <div id="garagePanel" class="side-drawer">
            <div class="drawer-head">
                <div>
                    <div class="label">Garage</div>
                    <h2>Fuhrpark & Upgrades</h2>
                </div>
                <button id="closeGarageBtn" aria-label="Garage schliessen">X</button>
            </div>
            <div class="garage-cash">Bank <strong id="garageCash">$0</strong></div>
            <div class="garage-grid" id="carList"></div>
            <div class="garage-upgrades" id="upgradeList"></div>
            <div class="achievement-list" id="achievementList"></div>
        </div>

        <div id="debugPanel"></div>

        <div id="gameOver">
            <h2>GAME OVER</h2>
            <div id="finalScore">Score: 0</div>
            <div id="finalStats"></div>
            <button id="restartBtn">Neustart</button>
        </div>
    `;

    const minimap = document.getElementById("minimap");
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
        speed: document.getElementById("speed"),
        stars: document.getElementById("stars"),
        comboChip: document.getElementById("comboChip"),
        comboValue: document.getElementById("comboValue"),
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
        garagePanel: document.getElementById("garagePanel"),
        closeGarageBtn: document.getElementById("closeGarageBtn"),
        garageCash: document.getElementById("garageCash"),
        carList: document.getElementById("carList"),
        upgradeList: document.getElementById("upgradeList"),
        achievementList: document.getElementById("achievementList"),
        debugPanel: document.getElementById("debugPanel"),
        gameOver: document.getElementById("gameOver"),
        finalScore: document.getElementById("finalScore"),
        finalStats: document.getElementById("finalStats"),
        restartBtn: document.getElementById("restartBtn"),
    };
}

export function renderHud(ui, state, world, traffic, police, roadblocks = [], eventPickups = [], hazards = [], helicopter = null) {
    const player = state.player;
    const selectedCar = CAR_MODELS[state.playerModelIndex];
    ui.score.textContent = Math.round(state.score).toLocaleString("de-DE");
    ui.bestScore.textContent = Math.round(state.bestScore).toLocaleString("de-DE");
    ui.cash.textContent = `$${Math.round(state.cash).toLocaleString("de-DE")}`;
    ui.speed.textContent = Math.round(Math.abs(player.speed) * 12);
    ui.carName.textContent = selectedCar.name;
    ui.districtName.textContent = state.district?.name ?? "Downtown";
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

    let stars = "";
    for (let index = 1; index <= 5; index += 1) {
        const active = index <= state.wanted.level;
        stars += `<span class="${active ? "active" : ""}">${active ? "\u2605" : "\u2606"}</span>`;
    }
    ui.stars.innerHTML = stars;
    ui.comboValue.textContent = `x${state.combo.multiplier.toFixed(1)}`;
    ui.comboChip.classList.toggle("live", state.combo.timer > 0);
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

    ui.status.textContent = state.statusMessage;
    ui.status.style.opacity = state.statusTimer > 0 ? "1" : "0.78";
    ui.actionPrompt.textContent = state.actionPrompt;
    ui.actionPrompt.classList.toggle("show", Boolean(state.actionPrompt));
    ui.pauseOverlay.classList.toggle("show", state.paused && state.screen === "playing");
    ui.mainMenu.classList.toggle("show", state.screen === "menu");
    ui.garagePanel.classList.toggle("show", state.screen === "garage");
}

export function showGameOver(ui, state) {
    ui.finalScore.textContent = `Score: ${Math.round(state.score).toLocaleString("de-DE")}`;
    ui.finalStats.textContent = `${state.stats.missions} Missionen | ${state.stats.pickups} Pickups | ${state.stats.propsDestroyed} Props | Drift ${Math.round(state.stats.driftScore)}`;
    ui.gameOver.classList.add("show");
}

export function hideGameOver(ui) {
    ui.gameOver.classList.remove("show");
}

function renderMissionHud(ui, state) {
    const mission = state.mission;
    const timer = Math.max(0, Math.ceil(mission.timer));
    const target = currentMissionTarget(state);
    const bonusProgress = formatMissionBonus(mission);
    ui.missionTarget.textContent = target
        ? `Ziel: ${target.name} | ${Math.round(distanceTo(state.player, target))} m`
        : "Ziel: offene Strassen";
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
        ui.missionText.textContent = `${mission.description} Durchbrueche ${mission.progress}/${mission.target}. Zeit ${timer}s.`;
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
    ui.eventLabel.textContent = state.worldEvent.active ? state.worldEvent.label : "Naechstes Event";
    ui.eventTimer.textContent = state.worldEvent.active ? `${Math.ceil(state.worldEvent.timer)}s` : `${Math.ceil(state.worldEvent.timer)}s`;
}

function renderContractHud(ui, state) {
    const contract = CONTRACTS.find((item) => item.id === state.contract.id) ?? CONTRACTS[0];
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
    ui.garageCash.textContent = `$${Math.round(state.cash).toLocaleString("de-DE")}`;
    ui.carList.innerHTML = CAR_MODELS.map((car, index) => {
        const unlocked = state.unlockedCars.includes(car.id);
        const selected = index === state.playerModelIndex;
        const action = unlocked ? (selected ? "Aktiv" : "Waehlen") : `$${car.unlockCost}`;
        return `
            <button class="garage-card ${selected ? "selected" : ""}" data-car-index="${index}">
                <span>${car.name}</span>
                <small>${car.description}</small>
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
    ctx.fillStyle = "#091017";
    ctx.fillRect(0, 0, width, height);
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
    for (const car of traffic) drawMapDot(ctx, state, cx, cy, scale, width, height, car.x, car.z, "#e8e2ce", 2);
    for (const agent of police) drawMapDot(ctx, state, cx, cy, scale, width, height, agent.x, agent.z, "#ff5a4c", 3);
    for (const block of roadblocks) drawMapDot(ctx, state, cx, cy, scale, width, height, block.x, block.z, "#ff9c45", 3.5);
    for (const event of eventPickups) drawMapRing(ctx, state, cx, cy, scale, width, height, event.x, event.z, event.color);
    for (const hazard of hazards) drawMapDot(ctx, state, cx, cy, scale, width, height, hazard.x, hazard.z, "#f7fbff", 2.5);
    if (helicopter?.visible) drawMapRing(ctx, state, cx, cy, scale, width, height, state.helicopter.x, state.helicopter.z, "#f7fbff");

    const target = currentMissionTarget(state);
    if (target) drawMapRing(ctx, state, cx, cy, scale, width, height, target.x, target.z, "#ffffff");

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-state.player.rotation);
    ctx.fillStyle = "#ffffff";
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
    const color = zone.color ?? "#63c8ff";
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
