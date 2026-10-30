// Pure data and helpers for the procedural synthwave score (the Web Audio part lives in audio.js).

export const TEMPOS = { game: 104, menu: 84 };

// Minor progression (i - VI - III - VII) as semitone offsets from the key root.
export const PROGRESSION = [0, -4, 3, -2];
export const CHORD_TONES = [0, 3, 7];

// One key per district gives each part of the city its own colour (semitones above A).
export const DISTRICT_KEYS = { downtown: 0, industrial: -2, park: 3, harbor: 5 };
export const BASE_HZ = 55; // A1
export const STEPS_PER_BAR = 16;

export const BASS_STEPS = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
export const KICK_STEPS = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
export const SNARE_STEPS = [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0];
export const HAT_STEPS = [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1];
// Lead arpeggio over the current chord: semitones relative to the chord root, played on 8th notes.
export const LEAD_ARP = [0, 7, 12, 7, 3, 7, 12, 15];

export function semitoneHz(rootSemitones, octaveShift = 0) {
    return BASE_HZ * Math.pow(2, (rootSemitones + octaveShift * 12) / 12);
}

export function stepSeconds(mode) {
    return 60 / (TEMPOS[mode] ?? TEMPOS.game) / 4;
}

/** Root semitone of the chord playing in `bar` for a district key. */
export function chordRoot(bar, districtId) {
    const key = DISTRICT_KEYS[districtId] ?? 0;
    return key + PROGRESSION[((bar % PROGRESSION.length) + PROGRESSION.length) % PROGRESSION.length];
}

/**
 * Layer volumes (0..1) for the current heat. Calm at heat 0 (pad and a quiet bass), drums from heat 2,
 * snare from 3, lead from 4. The menu track is a soft pad with a slow arpeggio.
 */
export function layerGains(heat, mode = "game") {
    if (mode === "menu") return { pad: 0.9, bass: 0.45, kick: 0, snare: 0, hat: 0, lead: 0.55 };
    return {
        pad: 0.75,
        bass: heat >= 1 ? 0.8 : 0.35,
        kick: heat >= 2 ? 1 : 0,
        hat: heat >= 2 ? 0.55 : 0,
        snare: heat >= 3 ? 0.9 : 0,
        lead: heat >= 4 ? 0.8 : 0,
    };
}

/** Which screen plays which track. */
export function musicModeFor(screen) {
    if (screen === "playing") return "game";
    if (screen === "menu" || screen === "garage") return "menu";
    return "off";
}
