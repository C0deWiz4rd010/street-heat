// Engine voices for the player cars (audio.js builds the engine from three oscillators; a tone picks their
// waveforms, harmonic ratios, mix and the filter resonance). Pure data so the tests can check every car has one.

export const ENGINE_TONES = {
    // Rough, square-heavy muscle rumble.
    v8: { types: ["sawtooth", "square", "triangle"], ratios: [1, 2, 0.5], gains: [0.55, 0.22, 0.5], q: 1.4 },
    // Smoother body with a high, whistling harmonic.
    turbo: { types: ["sawtooth", "sine", "triangle"], ratios: [1, 4, 0.5], gains: [0.45, 0.12, 0.45], q: 2.4 },
    // Low and clattering: a fifth above the fundamental gives the rattle.
    diesel: { types: ["square", "sawtooth", "square"], ratios: [1, 1.5, 0.5], gains: [0.42, 0.2, 0.5], q: 0.9 },
    // Nearly pure tones with a rising whine.
    electric: { types: ["sine", "sine", "triangle"], ratios: [1, 3, 2], gains: [0.45, 0.16, 0.2], q: 3.2 },
    // Buzzy two-stroke: bright, thin, fast.
    twoStroke: { types: ["square", "sawtooth", "sawtooth"], ratios: [1, 2, 1.01], gains: [0.3, 0.3, 0.3], q: 1.8 },
};

export function engineToneFor(model) {
    return ENGINE_TONES[model?.engineTone] ?? ENGINE_TONES.v8;
}
