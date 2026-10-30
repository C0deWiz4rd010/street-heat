// Police siren voice. Built to sound like a real electronic horn rather than a raw oscillator:
//  - a soft band-limited waveform (fundamental plus a few decaying harmonics, no harsh top end)
//  - pitch moves through an LFO on the audio clock, so glides are smooth at any frame rate
//  - a low-pass that closes with distance, plus Doppler through detune
// Three patterns: wail (slow sweep), hi-lo (two alternating notes) and yelp (fast, gentle sweep).

export const SIREN_MODES = {
    wail: { base: 860, depth: 300, lfoType: "sine", lfoHz: 0.3, smooth: 60, level: 1 },
    hilo: { base: 507, depth: 72, lfoType: "square", lfoHz: 1, smooth: 16, level: 1 },
    yelp: { base: 880, depth: 210, lfoType: "triangle", lfoHz: 2.4, smooth: 80, level: 0.8 },
};

// Amplitudes of harmonics 1..7: strong fundamental, quickly fading overtones.
const HARMONICS = [0, 1, 0.5, 0.26, 0.14, 0.08, 0.045, 0.025];

/** Which pattern fits the chase: calm wail at low heat, hi-lo at 3+, yelp when a cop is right behind you at max heat. */
export function sirenModeFor(heat, distance) {
    if (heat <= 0 || !Number.isFinite(distance) || distance > 150) return null;
    if (heat >= 5 && distance < 28) return "yelp";
    if (heat >= 3) return "hilo";
    return "wail";
}

/** Target loudness 0..1: grows with heat, fades with distance, never shouts. */
export function sirenLevelFor(heat, distance, mode) {
    if (!mode) return 0;
    const near = distance < 100 ? Math.pow(1 - distance / 100, 0.7) : 0;
    const level = (0.5 + heat * 0.1) * (0.18 + near * 0.82) * SIREN_MODES[mode].level;
    return Math.min(1, level);
}

export function createSiren(context, destination) {
    const real = new Float32Array(HARMONICS.length);
    const wave = context.createPeriodicWave(real, Float32Array.from(HARMONICS), { disableNormalization: false });

    const osc = context.createOscillator();
    osc.setPeriodicWave(wave);
    osc.frequency.value = SIREN_MODES.wail.base;

    // LFO -> rounding low-pass -> depth -> carrier frequency
    const lfo = context.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = SIREN_MODES.wail.lfoHz;
    const smoother = context.createBiquadFilter();
    smoother.type = "lowpass";
    smoother.frequency.value = SIREN_MODES.wail.smooth;
    const depth = context.createGain();
    depth.gain.value = SIREN_MODES.wail.depth;
    lfo.connect(smoother).connect(depth).connect(osc.frequency);

    const highpass = context.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 280;
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3000;
    tone.Q.value = 0.5;
    const level = context.createGain();
    level.gain.value = 0;
    const panNode = context.createStereoPanner ? context.createStereoPanner() : null;

    osc.connect(highpass).connect(tone).connect(level);
    if (panNode) level.connect(panNode).connect(destination);
    else level.connect(destination);

    osc.start();
    lfo.start();

    const at = () => context.currentTime;
    return {
        setMode(mode) {
            const m = SIREN_MODES[mode];
            if (!m) return;
            lfo.type = m.lfoType;
            osc.frequency.setTargetAtTime(m.base, at(), 0.25);
            lfo.frequency.setTargetAtTime(m.lfoHz, at(), 0.25);
            depth.gain.setTargetAtTime(m.depth, at(), 0.25);
            smoother.frequency.setTargetAtTime(m.smooth, at(), 0.1);
        },
        setLevel(value) {
            level.gain.setTargetAtTime(value * 0.12, at(), 0.2);
        },
        setDistance(distance) {
            const closeness = Math.min(1, Math.max(0, distance / 100));
            tone.frequency.setTargetAtTime(3600 - closeness * 2500, at(), 0.3);
        },
        setDoppler(cents) {
            osc.detune.setTargetAtTime(Math.max(-150, Math.min(150, cents)), at(), 0.12);
        },
        setPan(value) {
            if (panNode) panNode.pan.setTargetAtTime(Math.max(-1, Math.min(1, value)), at(), 0.15);
        },
        stop() {
            osc.stop();
            lfo.stop();
        },
    };
}
