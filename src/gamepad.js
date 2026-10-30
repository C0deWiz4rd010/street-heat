// Gamepad reading (standard mapping). Pure functions so they can be tested without a controller.

export const DEADZONE = 0.15;

export const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, ls: 10, rs: 11, up: 12, down: 13, left: 14, right: 15 };

// While driving, pad buttons act like these logical keys.
export const PAD_TO_LOGICAL = {
    a: "shift",
    rb: "shift",
    b: " ",
    lb: " ",
    x: "e",
    y: "q",
    back: "c",
    ls: "g",
    start: "p",
};

/** Removes the dead centre and rescales so the output still reaches +-1. */
export function deadzone(value, zone = DEADZONE) {
    const magnitude = Math.abs(value);
    if (magnitude < zone) return 0;
    return Math.sign(value) * Math.min(1, (magnitude - zone) / (1 - zone));
}

const buttonValue = (pad, index) => {
    const button = pad.buttons?.[index];
    if (!button) return 0;
    return typeof button === "number" ? button : button.value ?? (button.pressed ? 1 : 0);
};

/** Snapshot of the interesting parts of a pad: analog steer/throttle/brake and named button states. */
export function readGamepad(pad) {
    const buttons = {};
    for (const [name, index] of Object.entries(PAD)) buttons[name] = Boolean(pad.buttons?.[index]?.pressed ?? buttonValue(pad, index) > 0.5);
    return {
        steer: deadzone(pad.axes?.[0] ?? 0),
        navY: deadzone(pad.axes?.[1] ?? 0),
        throttle: deadzone(buttonValue(pad, PAD.rt), 0.05),
        brake: deadzone(buttonValue(pad, PAD.lt), 0.05),
        buttons,
    };
}

/** Throttle and brake triggers as one stick-style value: negative = forward (like the touch stick). */
export function triggersToAxis(throttle, brake) {
    return brake - throttle;
}

/** Rumble strength for an impact force of 0..1, with a duration in ms. */
export function rumbleFor(force) {
    const f = Math.max(0, Math.min(1, force));
    return { strong: Math.min(1, 0.25 + f * 0.75), weak: Math.min(1, 0.15 + f * 0.6), duration: Math.round(90 + f * 260) };
}
