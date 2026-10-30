// A key press stays consumable only briefly, so an unused E/G/Q press cannot fire later.
const PRESS_WINDOW_MS = 250;

export function createInput({ onRestart, onSwitchCar, onUserGesture }) {
    const keys = Object.create(null);
    const pressed = Object.create(null);

    window.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (!keys[key]) pressed[key] = performance.now();
        keys[key] = true;
        onUserGesture?.();

        // Menus keep their keyboard behaviour: Space/arrows must still reach focused controls.
        const onControl = event.target?.closest?.("button, input, select, textarea, a");
        if (!onControl && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "F3", "F4"].includes(event.key)) {
            event.preventDefault();
        }

        if (key === "r") onRestart();
        if (event.key >= "1" && event.key <= "4") onSwitchCar(Number(event.key) - 1);
    });

    window.addEventListener("keyup", (event) => {
        keys[event.key.toLowerCase()] = false;
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
    const analog = { x: 0, y: 0 };
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
            analog.x = dx;
            analog.y = dy;
            knob.style.transform = `translate(${dx * radius * 0.55}px, ${dy * radius * 0.55}px)`;
        };
        const release = (event) => {
            if (event.pointerId !== activePointer) return;
            activePointer = null;
            analog.x = 0;
            analog.y = 0;
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

    function consume(key) {
        const stamp = pressed[key] ?? 0;
        pressed[key] = 0;
        return stamp > 0 && performance.now() - stamp < PRESS_WINDOW_MS;
    }

    return { keys, consume, analog };
}
