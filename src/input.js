import { DEFAULT_BINDINGS, translateKey } from "./bindings.js";
import { PAD_TO_LOGICAL, readGamepad, rumbleFor, triggersToAxis } from "./gamepad.js";

// A key press stays consumable only briefly, so an unused E/G/Q press cannot fire later.
const PRESS_WINDOW_MS = 250;

// Keyboard steering ramps up (and back) instead of snapping to full lock.
const STEER_RISE = 4.5;
const STEER_RETURN = 7;
const STEER_FLIP = 10;

/** Moves `current` toward `target` (both -1..1): gentle build-up, quicker return, fastest when reversing. */
export function rampSteer(current, target, dt) {
    if (target === 0) {
        const step = STEER_RETURN * dt;
        return Math.abs(current) <= step ? 0 : current - Math.sign(current) * step;
    }
    const rate = Math.sign(current) === -target && current !== 0 ? STEER_FLIP : STEER_RISE;
    return Math.max(-1, Math.min(1, current + target * rate * dt));
}

/**
 * Input layer. Everything (keyboard, touch stick, gamepad) ends up as:
 *   keys / consume(key)   logical keys for buttons and one-shot actions
 *   analog {x, y}         x = steer (negative = left), y = throttle/brake (negative = forward)
 *   steer                 smoothed keyboard steering, positive = left
 */
export function createInput({
    onRestart,
    onSwitchCar,
    onUserGesture,
    bindings: initialBindings = DEFAULT_BINDINGS,
    menuActive = () => false,
    onMenuMove = () => {},
    onMenuConfirm = () => {},
    onMenuBack = () => {},
    onPadConnection = () => {},
}) {
    const keys = Object.create(null);
    const pressed = Object.create(null);
    let bindings = { ...initialBindings };
    let capture = null;
    let padWasMenu = false;
    let lastRumble = 0;
    const padState = { buttons: {}, nav: { x: 0, y: 0 }, connected: false };
    const touch = { x: 0, y: 0 };
    const analog = { x: 0, y: 0 };
    const api = { keys, analog, steer: 0 };

    window.addEventListener("keydown", (event) => {
        const physical = event.key.toLowerCase();
        if (capture) {
            // Rebinding mode: the next key becomes the new binding (Escape cancels).
            event.preventDefault();
            event.stopImmediatePropagation();
            const done = capture;
            capture = null;
            document.body.dataset.capturing = "0";
            done(physical === "escape" ? null : physical);
            return;
        }
        const key = translateKey(physical, bindings);
        if (key === null) return;
        if (!keys[key]) pressed[key] = performance.now();
        keys[key] = true;
        onUserGesture?.();

        // Menus keep their keyboard behaviour: Space/arrows must still reach focused controls.
        const onControl = event.target?.closest?.("button, input, select, textarea, a");
        if (!onControl && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "F3", "F4"].includes(event.key)) {
            event.preventDefault();
        }

        if (key === "r") onRestart();
        if (event.key >= "1" && event.key <= "9") onSwitchCar(Number(event.key) - 1);
        if (event.key === "0") onSwitchCar(9);
    }, true);

    window.addEventListener("keyup", (event) => {
        const key = translateKey(event.key.toLowerCase(), bindings);
        if (key !== null) keys[key] = false;
    });

    window.addEventListener("blur", () => {
        for (const key of Object.keys(keys)) keys[key] = false;
    });

    for (const control of document.querySelectorAll("[data-key]")) {
        const key = control.dataset.key;
        const press = (event) => {
            event.preventDefault();
            keys[key] = true;
            pressed[key] = performance.now();
            onUserGesture?.();
        };
        const release = (event) => {
            event.preventDefault();
            keys[key] = false;
        };
        control.addEventListener("pointerdown", press);
        control.addEventListener("pointerup", release);
        control.addEventListener("pointercancel", release);
        control.addEventListener("pointerleave", release);
    }

    // Analog virtual stick (touch): x = steer (-1 left .. 1 right), y = throttle (-1 forward .. 1 brake).
    const stick = document.getElementById("stick");
    if (stick) {
        const knob = document.getElementById("stickKnob");
        let activePointer = null;
        const move = (event) => {
            const rect = stick.getBoundingClientRect();
            const radius = rect.width / 2;
            let dx = (event.clientX - (rect.left + radius)) / radius;
            let dy = (event.clientY - (rect.top + radius)) / radius;
            const length = Math.hypot(dx, dy);
            if (length > 1) {
                dx /= length;
                dy /= length;
            }
            touch.x = dx;
            touch.y = dy;
            knob.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`;
        };
        const release = (event) => {
            if (event.pointerId !== activePointer) return;
            activePointer = null;
            touch.x = 0;
            touch.y = 0;
            knob.style.transform = "";
        };
        stick.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            activePointer = event.pointerId;
            stick.setPointerCapture(event.pointerId);
            onUserGesture?.();
            move(event);
        });
        stick.addEventListener("pointermove", (event) => {
            if (event.pointerId === activePointer) move(event);
        });
        stick.addEventListener("pointerup", release);
        stick.addEventListener("pointercancel", release);
    }

    window.addEventListener("gamepadconnected", (event) => {
        padState.connected = true;
        onPadConnection(true, event.gamepad?.id ?? "");
    });
    window.addEventListener("gamepaddisconnected", () => {
        padState.connected = false;
        onPadConnection(false, "");
    });

    function activePad() {
        const pads = navigator.getGamepads?.() ?? [];
        for (const pad of pads) if (pad?.connected) return pad;
        return null;
    }

    function press(logical) {
        if (!keys[logical]) pressed[logical] = performance.now();
        keys[logical] = true;
    }

    function pollGamepad() {
        const pad = activePad();
        let padSteer = 0;
        let padAxis = 0;
        if (pad) {
            padState.connected = true;
            const read = readGamepad(pad);
            const inMenu = menuActive();
            padSteer = read.steer;
            padAxis = triggersToAxis(read.throttle, read.brake);
            const prev = padState.buttons;
            for (const [name, down] of Object.entries(read.buttons)) {
                const was = Boolean(prev[name]);
                if (down && !was) onUserGesture?.();
                if (inMenu) {
                    // Menus: D-pad / stick move the focus, A confirms, B goes back.
                    if (down && !was) {
                        if (name === "up") onMenuMove("up");
                        else if (name === "down") onMenuMove("down");
                        else if (name === "left") onMenuMove("left");
                        else if (name === "right") onMenuMove("right");
                        else if (name === "a") onMenuConfirm();
                        else if (name === "b") onMenuBack();
                    }
                    const logical = PAD_TO_LOGICAL[name];
                    if (logical === "p" && down && !was) press("p");
                    if (logical === "p" && !down) keys.p = false;
                } else {
                    const logical = PAD_TO_LOGICAL[name];
                    if (logical) {
                        if (down && !was) press(logical);
                        if (!down && was) keys[logical] = false;
                    }
                }
            }
            // Left stick Y also navigates menus (edge-triggered at 0.6).
            if (inMenu) {
                const direction = read.navY < -0.6 ? "up" : read.navY > 0.6 ? "down" : null;
                if (direction && direction !== padState.nav.dir) onMenuMove(direction);
                padState.nav.dir = direction;
            }
            padState.buttons = read.buttons;
            // Leaving a menu must not leave a button logically held.
            if (padWasMenu && !inMenu) padState.buttons = { ...read.buttons };
            padWasMenu = inMenu;
        } else if (padState.connected) {
            padState.connected = false;
            padState.buttons = {};
        }
        return { steer: padSteer, axis: padAxis };
    }

    /** Call once per frame before the game update. */
    api.update = (dt) => {
        const pad = pollGamepad();
        const left = keys.a || keys.arrowleft ? 1 : 0;
        const right = keys.d || keys.arrowright ? 1 : 0;
        api.steer = rampSteer(api.steer, left - right, dt);
        // The stronger of touch stick and pad wins, per axis.
        analog.x = Math.abs(pad.steer) > Math.abs(touch.x) ? pad.steer : touch.x;
        analog.y = Math.abs(pad.axis) > Math.abs(touch.y) ? pad.axis : touch.y;
    };

    api.consume = (key) => {
        const stamp = pressed[key] ?? 0;
        pressed[key] = 0;
        return stamp > 0 && performance.now() - stamp < PRESS_WINDOW_MS;
    };

    api.setBindings = (next) => {
        bindings = { ...next };
        for (const key of Object.keys(keys)) keys[key] = false;
    };

    /** Rebinding: the next physical key is passed to `callback` (null = cancelled). */
    api.captureNextKey = (callback) => {
        capture = callback;
        document.body.dataset.capturing = "1";
    };

    api.rumble = (force) => {
        const pad = activePad();
        const actuator = pad?.vibrationActuator;
        const now = performance.now();
        if (!actuator || now - lastRumble < 120) return;
        lastRumble = now;
        const { strong, weak, duration } = rumbleFor(force);
        actuator.playEffect?.("dual-rumble", { duration, strongMagnitude: strong, weakMagnitude: weak }).catch?.(() => {});
    };

    Object.defineProperty(api, "padConnected", { get: () => padState.connected });
    return api;
}
