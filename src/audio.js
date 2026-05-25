export function createAudioDirector() {
    let context = null;
    let master = null;
    let engineOsc = null;
    let engineGain = null;
    let sirenOsc = null;
    let sirenGain = null;
    let unlocked = false;

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

        sirenOsc = context.createOscillator();
        sirenOsc.type = "square";
        sirenGain = context.createGain();
        sirenGain.gain.value = 0;
        sirenOsc.connect(sirenGain).connect(master);
        sirenOsc.start();

        unlocked = true;
    }

    function update(state, dt) {
        if (!unlocked || !context) return;
        const now = context.currentTime;
        const speed = Math.abs(state.player.speed);
        const engineLevel = state.running && !state.paused ? Math.min(0.26, 0.035 + speed * 0.012) : 0;
        engineOsc.frequency.setTargetAtTime(58 + speed * 10 + state.player.drift * 18, now, 0.05);
        engineGain.gain.setTargetAtTime(engineLevel, now, 0.08);

        const heat = state.wanted.level > 0 && state.running && !state.paused ? Math.min(0.18, 0.025 + state.wanted.level * 0.018) : 0;
        const sweep = Math.sin(performance.now() * 0.008) * 140;
        sirenOsc.frequency.setTargetAtTime(620 + sweep, now, 0.03);
        sirenGain.gain.setTargetAtTime(heat, now, 0.12);
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

    return {
        unlock,
        update,
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
