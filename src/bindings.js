// Keyboard action bindings. The game logic keeps asking for "logical" keys (w, s, shift, e ...);
// bindings translate what the player physically pressed into those logical keys.

export const DEFAULT_BINDINGS = {
    throttle: "w",
    brake: "s",
    left: "a",
    right: "d",
    handbrake: " ",
    nitro: "shift",
    provoke: "q",
    interact: "e",
    garage: "g",
    camera: "c",
};

export const ACTION_LABELS = {
    throttle: "Gas",
    brake: "Bremse / Rückwärts",
    left: "Links lenken",
    right: "Rechts lenken",
    handbrake: "Handbremse / Drift",
    nitro: "Nitro",
    provoke: "Provoke",
    interact: "Interagieren",
    garage: "Garage",
    camera: "Kamera wechseln",
};

// Keys that must stay free for fixed functions (pause, debug, car switch, restart, menus).
export const RESERVED_KEYS = new Set(["escape", "p", "r", "f3", "f4", "tab", "enter", "1", "2", "3", "4", "arrowup", "arrowdown", "arrowleft", "arrowright"]);

/** Readable key name for the UI. */
export function keyLabel(key) {
    const names = { " ": "Leertaste", shift: "Shift", control: "Strg", alt: "Alt", arrowup: "↑", arrowdown: "↓", arrowleft: "←", arrowright: "→" };
    return names[key] ?? key.toUpperCase();
}

/** Keeps only known actions with a usable key; any clash falls back to the defaults. */
export function normalizeBindings(raw) {
    const result = { ...DEFAULT_BINDINGS };
    if (!raw || typeof raw !== "object") return result;
    for (const action of Object.keys(DEFAULT_BINDINGS)) {
        const key = raw[action];
        if (typeof key === "string" && key.length > 0 && key.length <= 12 && !RESERVED_KEYS.has(key)) result[action] = key;
    }
    const values = Object.values(result);
    return new Set(values).size === values.length ? result : { ...DEFAULT_BINDINGS };
}

/** Binds `key` to `action`. If another action already used the key, the two swap keys. Reserved keys are refused. */
export function rebind(bindings, action, key) {
    if (!(action in DEFAULT_BINDINGS) || RESERVED_KEYS.has(key)) return bindings;
    const next = { ...bindings };
    const other = Object.keys(next).find((name) => name !== action && next[name] === key);
    if (other) next[other] = next[action];
    next[action] = key;
    return next;
}

/**
 * Physical key -> logical key (or null when the key is blocked because its action moved elsewhere).
 * Keys that no action owns (arrows, F3, P, Esc, digits ...) pass through unchanged.
 */
export function translateKey(physical, bindings = DEFAULT_BINDINGS) {
    for (const [action, key] of Object.entries(bindings)) {
        if (key === physical) return DEFAULT_BINDINGS[action];
    }
    if (Object.values(DEFAULT_BINDINGS).includes(physical)) return null;
    return physical;
}
