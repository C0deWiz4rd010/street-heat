import { CAR_MODELS } from "./config.js";
import { createSiren, sirenLevelFor, sirenModeFor } from "./siren.js";
import { BASS_STEPS, CHORD_TONES, HAT_STEPS, KICK_STEPS, LEAD_ARP, SNARE_STEPS, STEPS_PER_BAR, chordRoot, layerGains, musicModeFor, semitoneHz, stepSeconds } from "./music.js";

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Fully synthetic audio. Signal flow:
 *   sources -> sfxBus / uiBus / musicBus -> mix -> limiter (compressor) -> master -> speakers
 * The volume sliders drive master, sfx and music; ui follows sfx.
 */
export function createAudioDirector() {
    let context = null;
    let master = null;
    let limiter = null;
    let analyser = null;
    let sfxBus = null;
    let uiBus = null;
    let musicBus = null;
    let noiseBuffer = null;
    let unlocked = false;
    let muted = false;
    const volumes = { master: 0.8, music: 0.7, sfx: 0.9 };
    const listener = { x: 0, z: 0, rotation: 0 };

    // continuous voices
    let engine = null;
    let sub = null;
    let squeal = null;
    let scrape = null;
    let siren = null;
    let sirenMode = null;
    let sirenCandidate = null;
    let sirenCandidateSince = 0;
    let rotor = null;
    let lastSirenDist = Infinity;
    let lastGear = 1;
    let gearDip = 0;
    let lastCrash = 0;

    // music
    const music = { mode: "off", heat: 0, district: "downtown", step: 0, nextTime: 0, timer: null, layers: null, delay: null };

    function masterLevel() {
        return 1.3 * volumes.master * (muted ? 0 : 1);
    }

    // ------------------------------------------------------------------ setup
    function unlock() {
        if (unlocked) {
            if (context?.state === "suspended") context.resume();
            return;
        }
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        context = new AudioContextClass();
        if (context.state === "suspended") context.resume();

        master = context.createGain();
        master.gain.value = masterLevel();
        limiter = context.createDynamicsCompressor();
        limiter.threshold.value = -12;
        limiter.knee.value = 6;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.003;
        limiter.release.value = 0.2;
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        const mix = context.createGain();
        mix.connect(limiter).connect(master).connect(context.destination);
        master.connect(analyser);

        sfxBus = context.createGain();
        sfxBus.gain.value = volumes.sfx;
        sfxBus.connect(mix);
        uiBus = context.createGain();
        uiBus.gain.value = volumes.sfx;
        uiBus.connect(mix);
        musicBus = context.createGain();
        musicBus.gain.value = volumes.music;
        musicBus.connect(mix);

        noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
        const data = noiseBuffer.getChannelData(0);
        for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;

        buildEngine();
        buildSiren();
        buildRotor();
        buildMusic();
        unlocked = true;
    }

    function noiseSource() {
        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        source.loop = true;
        return source;
    }

    function makeShaper(amount) {
        const curve = new Float32Array(256);
        for (let i = 0; i < curve.length; i += 1) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * amount);
        }
        const shaper = context.createWaveShaper();
        shaper.curve = curve;
        shaper.oversample = "2x";
        return shaper;
    }

    function panner(pan) {
        if (!context.createStereoPanner) return null;
        const node = context.createStereoPanner();
        node.pan.value = clamp(pan, -1, 1);
        return node;
    }

    function chain(nodes) {
        for (let i = 0; i < nodes.length - 1; i += 1) nodes[i].connect(nodes[i + 1]);
        return nodes.at(-1);
    }

    function buildEngine() {
        // Three oscillators (fundamental, octave, sub) -> soft clip -> low-pass that opens with the throttle.
        const o1 = context.createOscillator();
        o1.type = "sawtooth";
        const o2 = context.createOscillator();
        o2.type = "square";
        const o3 = context.createOscillator();
        o3.type = "triangle";
        const g1 = context.createGain();
        const g2 = context.createGain();
        const g3 = context.createGain();
        g1.gain.value = 0.55;
        g2.gain.value = 0.18;
        g3.gain.value = 0.5;
        const shaper = makeShaper(2.4);
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = 600;
        filter.Q.value = 1.4;
        const out = context.createGain();
        out.gain.value = 0;
        o1.connect(g1).connect(shaper);
        o2.connect(g2).connect(shaper);
        o3.connect(g3).connect(shaper);
        shaper.connect(filter).connect(out).connect(sfxBus);
        for (const osc of [o1, o2, o3]) osc.start();
        engine = { o1, o2, o3, filter, out };

        // Nitro growl: low sine layer.
        const subOsc = context.createOscillator();
        subOsc.type = "sine";
        const subGain = context.createGain();
        subGain.gain.value = 0;
        subOsc.connect(subGain).connect(sfxBus);
        subOsc.start();
        sub = { osc: subOsc, gain: subGain };

        // Drift squeal.
        const squealOsc = context.createOscillator();
        squealOsc.type = "sine";
        const squealGain = context.createGain();
        squealGain.gain.value = 0;
        squealOsc.connect(squealGain).connect(sfxBus);
        squealOsc.start();
        squeal = { osc: squealOsc, gain: squealGain };

        // Wall scrape: band-passed noise.
        const scrapeSource = noiseSource();
        const scrapeFilter = context.createBiquadFilter();
        scrapeFilter.type = "bandpass";
        scrapeFilter.frequency.value = 1400;
        scrapeFilter.Q.value = 1.2;
        const scrapeGain = context.createGain();
        scrapeGain.gain.value = 0;
        scrapeSource.connect(scrapeFilter).connect(scrapeGain).connect(sfxBus);
        scrapeSource.start();
        scrape = { gain: scrapeGain };
    }

    function buildSiren() {
        siren = createSiren(context, sfxBus);
    }

    function buildRotor() {
        // Helicopter: low-passed noise chopped by a ~13 Hz LFO.
        const source = noiseSource();
        const band = context.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 150;
        band.Q.value = 0.9;
        const gain = context.createGain();
        gain.gain.value = 0;
        const lfo = context.createOscillator();
        lfo.type = "sine";
        lfo.frequency.value = 13;
        const lfoGain = context.createGain();
        lfoGain.gain.value = 0;
        lfo.connect(lfoGain).connect(gain.gain);
        const pan = panner(0);
        source.connect(band).connect(gain);
        if (pan) gain.connect(pan).connect(sfxBus);
        else gain.connect(sfxBus);
        source.start();
        lfo.start();
        rotor = { gain, lfoGain, pan };
    }

    // ------------------------------------------------------------------ volumes
    function applyVolumes() {
        if (!context) return;
        const now = context.currentTime;
        master.gain.setTargetAtTime(masterLevel(), now, 0.05);
        sfxBus.gain.setTargetAtTime(volumes.sfx, now, 0.05);
        uiBus.gain.setTargetAtTime(volumes.sfx, now, 0.05);
        musicBus.gain.setTargetAtTime(volumes.music, now, 0.05);
    }

    function setVolumes(next) {
        Object.assign(volumes, next);
        applyVolumes();
    }

    function setMuted(value) {
        muted = Boolean(value);
        applyVolumes();
        return muted;
    }

    function toggleMute() {
        return setMuted(!muted);
    }

    // ------------------------------------------------------------------ one-shot helpers
    function panFor(at) {
        if (!at) return 0;
        const dx = at.x - listener.x;
        const dz = at.z - listener.z;
        // Screen-right is the player's negative lateral axis (the camera trails the car).
        const lateral = -(dx * Math.cos(listener.rotation) - dz * Math.sin(listener.rotation));
        return clamp(lateral / 24, -1, 1);
    }

    function route(node, dest, pan = 0) {
        const p = pan ? panner(pan) : null;
        if (p) {
            node.connect(p).connect(dest);
        } else {
            node.connect(dest);
        }
    }

    function tone({ freq, freqEnd, type = "triangle", gain = 0.2, attack = 0.012, decay = 0.2, delay = 0, dest = sfxBus, pan = 0 }) {
        if (!unlocked) return;
        const t = context.currentTime + delay;
        const osc = context.createOscillator();
        const env = context.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, t);
        if (freqEnd) osc.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(gain, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        osc.connect(env);
        route(env, dest, pan);
        osc.start(t);
        osc.stop(t + decay + 0.05);
    }

    function noise({ gain = 0.2, decay = 0.3, type = "lowpass", freq = 1200, freqEnd, q = 0.8, delay = 0, attack = 0.004, dest = sfxBus, pan = 0 }) {
        if (!unlocked) return;
        const t = context.currentTime + delay;
        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        const filter = context.createBiquadFilter();
        filter.type = type;
        filter.Q.value = q;
        filter.frequency.setValueAtTime(freq, t);
        if (freqEnd) filter.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
        const env = context.createGain();
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(gain, t + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
        source.connect(filter).connect(env);
        route(env, dest, pan);
        source.start(t, Math.random());
        source.stop(t + decay + 0.05);
    }

    // ------------------------------------------------------------------ per-frame update
    function update(state, dt) {
        if (!unlocked || !context) return;
        const now = context.currentTime;
        const player = state.player;
        listener.x = player.x;
        listener.z = player.z;
        listener.rotation = player.rotation;

        const model = CAR_MODELS[state.playerModelIndex] ?? CAR_MODELS[0];
        const pitchBase = model.enginePitchBase ?? 58;
        const speedMag = player.speedMag ?? Math.abs(player.speed);
        const active = state.running && !state.paused && state.screen === "playing";

        // Engine: five simulated gears, pitch drop on each upshift, filter opens with the throttle.
        const ratio = clamp(speedMag / (model.maxSpeed * 1.3), 0, 1);
        const gear = clamp(Math.floor(ratio * 5) + 1, 1, 5);
        const rpm = ratio >= 1 ? 1 : (ratio * 5) % 1;
        if (gear > lastGear) gearDip = 1;
        lastGear = gear;
        gearDip = Math.max(0, gearDip - dt * 4.5);
        const throttle = player.throttle ?? (speedMag > 1 ? 0.5 : 0);
        const freq = pitchBase * (0.9 + rpm * 1.9 + gear * 0.12) * (1 - gearDip * 0.24) + player.drift * 22;
        engine.o1.frequency.setTargetAtTime(freq, now, 0.04);
        engine.o2.frequency.setTargetAtTime(freq * 2, now, 0.04);
        engine.o3.frequency.setTargetAtTime(freq * 0.5, now, 0.04);
        engine.filter.frequency.setTargetAtTime(450 + throttle * 1700 + rpm * 700 + (player.nitroActive ? 700 : 0), now, 0.06);
        engine.out.gain.setTargetAtTime(active ? 0.05 + rpm * 0.05 + throttle * 0.07 : 0, now, 0.08);

        const nitroOn = active && player.nitroActive;
        sub.osc.frequency.setTargetAtTime(pitchBase * 0.5 + speedMag * 4, now, 0.05);
        sub.gain.gain.setTargetAtTime(nitroOn ? Math.min(0.12, 0.04 + speedMag * 0.006) : 0, now, 0.08);

        const driftDepth = active ? Math.max(0, (player.drift - 0.35) / 0.65) : 0;
        squeal.osc.frequency.setTargetAtTime(2600 + driftDepth * 1600 + Math.abs(player.speed) * 22, now, 0.04);
        squeal.gain.gain.setTargetAtTime(driftDepth * 0.1, now, 0.06);

        scrape.gain.gain.setTargetAtTime(active ? Math.min(0.16, (state.wallSlide ?? 0) * 0.2) : 0, now, 0.04);

        // Siren: see siren.js. The pattern only changes after it has been the better fit for 1.5 s,
        // so it never flutters between modes.
        const nearest = state.nearestPoliceDistance ?? Infinity;
        const closing = Number.isFinite(lastSirenDist) && Number.isFinite(nearest) ? (lastSirenDist - nearest) / Math.max(dt, 0.001) : 0;
        lastSirenDist = nearest;
        const heat = state.wanted.level;
        const wanted = active ? sirenModeFor(heat, nearest) : null;
        const clock = performance.now() / 1000;
        if (wanted !== sirenCandidate) {
            sirenCandidate = wanted;
            sirenCandidateSince = clock;
        }
        if (wanted && wanted !== sirenMode && (clock - sirenCandidateSince > 1.5 || !sirenMode)) {
            sirenMode = wanted;
            siren.setMode(wanted);
        }
        siren.setLevel(sirenLevelFor(heat, nearest, wanted ?? null));
        siren.setDistance(Number.isFinite(nearest) ? nearest : 100);
        siren.setDoppler(closing * 6);
        if (state.nearestPoliceOffset) {
            siren.setPan(panFor({ x: player.x + state.nearestPoliceOffset.x, z: player.z + state.nearestPoliceOffset.z }));
        }

        // Helicopter rotor.
        const heli = state.helicopter;
        let rotorLevel = 0;
        if (heli?.active && active) {
            const d = Math.hypot(heli.x - player.x, heli.z - player.z);
            rotorLevel = 0.2 * clamp(1 - d / 70, 0, 1);
            if (rotor.pan) rotor.pan.pan.setTargetAtTime(panFor(heli), now, 0.1);
        }
        rotor.gain.gain.setTargetAtTime(rotorLevel * 0.4, now, 0.15);
        rotor.lfoGain.gain.setTargetAtTime(rotorLevel * 0.6, now, 0.15);

        // Music follows the screen, heat and district.
        setMusicMode(musicModeFor(state.screen));
        music.heat = heat;
        music.district = state.district?.id ?? "downtown";
        updateMusicLayers(now);
    }

    // ------------------------------------------------------------------ one-shot effects
    /** force 0..1 scales weight and loudness; `at` pans the sound toward where it happened. */
    function crash(force = 0.6, at = null) {
        if (!unlocked) return;
        const nowMs = performance.now();
        if (nowMs - lastCrash < 70) return;
        lastCrash = nowMs;
        const f = clamp(force, 0.1, 1);
        const pan = panFor(at);
        noise({ gain: 0.1 + f * 0.28, decay: 0.12 + f * 0.3, type: "lowpass", freq: 900 + f * 2400, freqEnd: 180, pan });
        tone({ freq: 140 - f * 50, freqEnd: 38, type: "sine", gain: 0.2 + f * 0.3, decay: 0.2 + f * 0.25, pan });
        if (f > 0.55) noise({ gain: 0.12, decay: 0.5, type: "highpass", freq: 3200, delay: 0.03, pan });
    }

    function nearMiss() {
        tone({ freq: 1900, freqEnd: 260, type: "sawtooth", gain: 0.16, attack: 0.018, decay: 0.26 });
    }

    function stinger(level, up = true) {
        if (!unlocked) return;
        if (!up) {
            tone({ freq: 520, freqEnd: 330, type: "triangle", gain: 0.12, decay: 0.35 });
            return;
        }
        const notes = [220, 262, 330, 392, 494];
        for (let i = 0; i < Math.min(level, 5); i += 1) {
            tone({ freq: notes[i], type: "sawtooth", gain: 0.1, decay: 0.28, delay: i * 0.07 });
        }
        tone({ freq: 55 * (1 + level * 0.12), freqEnd: 40, type: "sine", gain: 0.3, decay: 0.5 });
    }

    function warning(kind = "roadblock") {
        const f = kind === "spike" ? [1180, 880] : [880, 660];
        for (let i = 0; i < 3; i += 1) tone({ freq: f[i % 2], type: "square", gain: 0.1, attack: 0.005, decay: 0.12, delay: i * 0.14 });
    }

    function tireBurst() {
        noise({ gain: 0.34, decay: 0.45, type: "bandpass", freq: 2800, freqEnd: 500, q: 0.7 });
        tone({ freq: 220, freqEnd: 60, type: "sawtooth", gain: 0.14, decay: 0.3 });
    }

    function emp() {
        tone({ freq: 2400, freqEnd: 90, type: "sawtooth", gain: 0.2, decay: 0.7 });
        noise({ gain: 0.18, decay: 0.55, type: "highpass", freq: 1500 });
        tone({ freq: 60, type: "sine", gain: 0.25, decay: 0.7, delay: 0.05 });
    }

    function pickup(type = "cash") {
        switch (type) {
            case "cash":
                tone({ freq: 1320, type: "square", gain: 0.1, decay: 0.07 });
                tone({ freq: 1760, type: "square", gain: 0.1, decay: 0.16, delay: 0.07 });
                break;
            case "repair":
                [392, 494, 587].forEach((f, i) => tone({ freq: f, type: "sine", gain: 0.14, decay: 0.3, delay: i * 0.08 }));
                break;
            case "intel":
                tone({ freq: 1000, type: "sine", gain: 0.12, decay: 0.08 });
                tone({ freq: 1500, type: "sine", gain: 0.12, decay: 0.2, delay: 0.1 });
                break;
            case "nitro":
                tone({ freq: 300, freqEnd: 1600, type: "sawtooth", gain: 0.14, decay: 0.3 });
                noise({ gain: 0.1, decay: 0.3, type: "highpass", freq: 2000 });
                break;
            case "parts":
                tone({ freq: 760, type: "triangle", gain: 0.14, decay: 0.12 });
                tone({ freq: 1140, type: "triangle", gain: 0.1, decay: 0.2, delay: 0.05 });
                noise({ gain: 0.08, decay: 0.1, type: "highpass", freq: 4000 });
                break;
            case "emp":
                tone({ freq: 1800, freqEnd: 400, type: "sine", gain: 0.14, decay: 0.3 });
                break;
            default:
                tone({ freq: 920, type: "triangle", gain: 0.16, decay: 0.1 });
        }
    }

    function achievement() {
        [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: "triangle", gain: 0.14, decay: 0.4, delay: i * 0.09 }));
        tone({ freq: 1047, type: "sine", gain: 0.1, decay: 0.8, delay: 0.36 });
    }

    function gameOver() {
        [392, 349, 311, 262].forEach((f, i) => tone({ freq: f, type: "sawtooth", gain: 0.13, decay: 0.55, delay: i * 0.22 }));
        tone({ freq: 70, freqEnd: 32, type: "sine", gain: 0.35, decay: 1.4, delay: 0.5 });
        noise({ gain: 0.12, decay: 1.2, type: "lowpass", freq: 600, freqEnd: 120, delay: 0.5 });
    }

    function thunder(delay = 0.4) {
        noise({ gain: 0.35, decay: 0.12, type: "highpass", freq: 3000, delay });
        noise({ gain: 0.4, decay: 2.4, type: "lowpass", freq: 420, freqEnd: 70, delay: delay + 0.05, attack: 0.15 });
        tone({ freq: 48, type: "sine", gain: 0.3, decay: 2, delay: delay + 0.1, attack: 0.2 });
    }

    function mission() {
        tone({ freq: 620, type: "triangle", gain: 0.14, decay: 0.12 });
        tone({ freq: 960, type: "triangle", gain: 0.12, decay: 0.2, delay: 0.08 });
    }

    function uiHover() {
        tone({ freq: 1500, type: "sine", gain: 0.035, attack: 0.004, decay: 0.05, dest: uiBus });
    }

    function uiClick() {
        tone({ freq: 700, freqEnd: 420, type: "triangle", gain: 0.09, attack: 0.004, decay: 0.09, dest: uiBus });
    }

    // ------------------------------------------------------------------ music
    function buildMusic() {
        const layers = {};
        for (const name of ["pad", "bass", "kick", "snare", "hat", "lead"]) {
            const g = context.createGain();
            g.gain.value = 0;
            g.connect(musicBus);
            layers[name] = g;
        }
        // Lead goes through a feedback delay for the classic synthwave echo.
        const delay = context.createDelay(1);
        delay.delayTime.value = 0.28;
        const feedback = context.createGain();
        feedback.gain.value = 0.34;
        const wet = context.createGain();
        wet.gain.value = 0.5;
        layers.lead.connect(delay);
        delay.connect(feedback).connect(delay);
        delay.connect(wet).connect(musicBus);
        music.layers = layers;
        music.timer = window.setInterval(musicTick, 40);
    }

    function setMusicMode(mode) {
        if (music.mode === mode) return;
        music.mode = mode;
        music.step = 0;
        music.nextTime = context.currentTime + 0.12;
    }

    function updateMusicLayers(now) {
        const target = music.mode === "off" ? { pad: 0, bass: 0, kick: 0, snare: 0, hat: 0, lead: 0 } : layerGains(music.heat, music.mode);
        for (const [name, node] of Object.entries(music.layers)) {
            node.gain.setTargetAtTime(target[name] * 0.5, now, 0.4);
        }
    }

    function musicTick() {
        if (!unlocked || music.mode === "off" || context.state !== "running") return;
        const stepLength = stepSeconds(music.mode);
        if (music.nextTime < context.currentTime - 0.5) music.nextTime = context.currentTime + 0.05;
        while (music.nextTime < context.currentTime + 0.4) {
            scheduleStep(music.step, music.nextTime, stepLength);
            music.nextTime += stepLength;
            music.step += 1;
        }
    }

    function voice({ freq, type, dest, time, length, peak, cutoff, attack = 0.01, detune = 0 }) {
        const osc = context.createOscillator();
        osc.type = type;
        osc.frequency.value = freq;
        osc.detune.value = detune;
        const filter = context.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = cutoff;
        const env = context.createGain();
        env.gain.setValueAtTime(0.0001, time);
        env.gain.linearRampToValueAtTime(peak, time + attack);
        env.gain.exponentialRampToValueAtTime(0.0001, time + length);
        osc.connect(filter).connect(env).connect(dest);
        osc.start(time);
        osc.stop(time + length + 0.05);
    }

    function drumNoise({ dest, time, decay, filterType, freq, peak }) {
        const source = context.createBufferSource();
        source.buffer = noiseBuffer;
        const filter = context.createBiquadFilter();
        filter.type = filterType;
        filter.frequency.value = freq;
        const env = context.createGain();
        env.gain.setValueAtTime(peak, time);
        env.gain.exponentialRampToValueAtTime(0.0001, time + decay);
        source.connect(filter).connect(env).connect(dest);
        source.start(time, Math.random());
        source.stop(time + decay + 0.02);
    }

    function scheduleStep(step, time, stepLength) {
        const L = music.layers;
        const inBar = step % STEPS_PER_BAR;
        const bar = Math.floor(step / STEPS_PER_BAR);
        const root = chordRoot(bar, music.district);
        const menu = music.mode === "menu";
        const g = layerGains(music.heat, music.mode);

        if (inBar === 0 && g.pad > 0) {
            // Pad: three slightly detuned saws per chord tone, one bar long.
            for (const tone of CHORD_TONES) {
                for (const detune of [-7, 7]) {
                    voice({ freq: semitoneHz(root + tone, 2), type: "sawtooth", dest: L.pad, time, length: stepLength * STEPS_PER_BAR, peak: 0.07, cutoff: 1000, attack: stepLength * 3, detune });
                }
            }
        }
        if (BASS_STEPS[inBar] && g.bass > 0) {
            const hit = menu ? inBar % 8 === 0 : true;
            if (hit) voice({ freq: semitoneHz(root, inBar % 8 === 3 ? 1 : 0), type: "sawtooth", dest: L.bass, time, length: stepLength * 1.8, peak: 0.28, cutoff: 360 });
        }
        if (KICK_STEPS[inBar] && g.kick > 0) {
            const osc = context.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(130, time);
            osc.frequency.exponentialRampToValueAtTime(42, time + 0.14);
            const env = context.createGain();
            env.gain.setValueAtTime(0.9, time);
            env.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
            osc.connect(env).connect(L.kick);
            osc.start(time);
            osc.stop(time + 0.28);
        }
        if (SNARE_STEPS[inBar] && g.snare > 0) {
            drumNoise({ dest: L.snare, time, decay: 0.2, filterType: "bandpass", freq: 1800, peak: 0.55 });
            voice({ freq: 190, type: "triangle", dest: L.snare, time, length: 0.12, peak: 0.3, cutoff: 3000 });
        }
        if (HAT_STEPS[inBar] && g.hat > 0) {
            drumNoise({ dest: L.hat, time, decay: inBar === 15 ? 0.14 : 0.04, filterType: "highpass", freq: 7000, peak: inBar % 4 === 0 ? 0.28 : 0.16 });
        }
        if (g.lead > 0 && (menu ? inBar % 4 === 0 : inBar % 2 === 0)) {
            const note = LEAD_ARP[(inBar / 2) % LEAD_ARP.length | 0] ?? 0;
            // Harbor gets a softer triangle lead, the rest a bright square.
            voice({ freq: semitoneHz(root + note, 3), type: music.district === "harbor" ? "triangle" : "square", dest: L.lead, time, length: stepLength * (menu ? 3 : 1.7), peak: 0.1, cutoff: 3200 });
        }
    }

    return {
        unlock,
        update,
        toggleMute,
        setMuted,
        setVolumes,
        get musicBus() { return musicBus; },
        get analyser() { return analyser; },
        get context() { return context; },
        get isMuted() { return muted; },
        nearMiss,
        collect: () => pickup("default"),
        pickup,
        crash,
        mission,
        stinger,
        warning,
        tireBurst,
        emp,
        achievement,
        gameOver,
        thunder,
        uiHover,
        uiClick,
        upgrade: () => tone({ freq: 480, type: "sine", gain: 0.18, decay: 0.2 }),
        denied: () => tone({ freq: 130, type: "square", gain: 0.1, decay: 0.12 }),
    };
}
