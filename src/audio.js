export function createAudioDirector() {
    let context = null;
    let master = null;
    let engineOsc = null;
    let engineGain = null;
    let sirenOsc = null;
    let sirenGain = null;
    let driftOsc = null;
    let driftGain = null;
    let unlocked = false;
    let muted = false;

    function unlock() {
        if (unlocked) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;

        context = new AudioContextClass();
        master = context.createGain();
        master.gain.value = 0.12;
        master.connect(context.destination);

        engineOsc = context.createOscillator();
        engineOsc.type = "sawtooth";
        engineGain = context.createGain();
        engineGain.gain.value = 0;
        engineOsc.connect(engineGain).connect(master);
        engineOsc.start();

        // Drift squeal oscillator
        driftOsc = context.createOscillator();
        driftOsc.type = "sine";
        driftGain = context.createGain();
        driftGain.gain.value = 0;
        driftOsc.connect(driftGain).connect(master);
        driftOsc.start();

        sirenOsc = context.createOscillator();
        sirenOsc.type = "square";
        sirenGain = context.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain).connect(master);
        sirenOsc.start();

        unlocked = true;
    }

    function toggleMute() {
        muted = !muted;
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.12, context.currentTime, 0.08);
        return muted;
    }

    function update(state, dt) {
        if (!unlocked || !context) return;
        const now = context.currentTime;

        // Engine — pitch driven by total speedMag so drift/sideslip also raises note
        const speedMag = state.player.speedMag ?? Math.abs(state.player.speed);
        const engineActive = state.running && !state.paused;
        const engineLevel = engineActive ? Math.min(0.26, 0.035 + speedMag * 0.012) : 0;
        engineOsc.frequency.setTargetAtTime(58 + speedMag * 10 + state.player.drift * 22, now, 0.05);
        engineGain.gain.setTargetAtTime(engineLevel, now, 0.08);

        // Drift squeal — fades in past drift 0.35, pitch climbs with speed and drift depth
        const driftDepth = engineActive ? Math.max(0, (state.player.drift - 0.35) / 0.65) : 0;
        const driftFreq = 2600 + driftDepth * 1600 + Math.abs(state.player.speed) * 22;
        driftOsc.frequency.setTargetAtTime(driftFreq, now, 0.04);
        driftGain.gain.setTargetAtTime(driftDepth * 0.13, now, 0.06);

        // Siren — volume scales with nearest police car distance
        const nearestDist = state.nearestPoliceDistance ?? Infinity;
        const distFactor = nearestDist < 85 ? Math.min(1, Math.pow(1 - nearestDist / 85, 0.6)) : 0;
        const sirenBase = state.wanted.level > 0 && engineActive ? 0.025 + state.wanted.level * 0.022 : 0;
        const sirenLevel = Math.min(0.24, sirenBase * (0.22 + distFactor * 0.78));
        const sweep = Math.sin(performance.now() * 0.008) * 140;
        sirenOsc.frequency.setTargetAtTime(620 + sweep, now, 0.03);
        sirenGain.gain.setTargetAtTime(sirenLevel, now, 0.12);
    }

    function blip(frequency, duration = 0.08, type = "triangle", gain = 0.18) {
        if (!unlocked || !context) return;
        const now = context.currentTime;
        const osc = context.createOscillator();
        const envelope = context.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        envelope.gain.value = 0;
        osc.connect(envelope).connect(master);
        envelope.gain.linearRampToValueAtTime(gain, now + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.001, now + duration);
        osc.start(now);
        osc.stop(now + duration + 0.02);
    }

    function nearMiss() {
        if (!unlocked || !context) return;
        const now = context.currentTime;
        // Fast sawtooth sweep downward — the whoosh sound
        const osc = context.createOscillator();
        const envelope = context.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1900, now);
        osc.frequency.exponentialRampToValueAtTime(260, now + 0.22);
        envelope.gain.setValueAtTime(0, now);
        envelope.gain.linearRampToValueAtTime(0.22, now + 0.018);
        envelope.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
        osc.connect(envelope).connect(master);
        osc.start(now);
        osc.stop(now + 0.3);
    }

    return {
        unlock,
        update,
        toggleMute,
        get isMuted() { return muted; },
        nearMiss,
        collect: () => blip(920, 0.1, "triangle", 0.16),
        crash: () => blip(95, 0.16, "sawtooth", 0.24),
        mission: () => {
            blip(620, 0.08, "triangle", 0.16);
            window.setTimeout(() => blip(960, 0.12, "triangle", 0.14), 80);
        },
        upgrade: () => blip(480, 0.18, "sine", 0.2),
        denied: () => blip(130, 0.1, "square", 0.12),
    };
}
