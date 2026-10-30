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

    function consume(key) {
        const stamp = pressed[key] ?? 0;
        pressed[key] = 0;
        return stamp > 0 && performance.now() - stamp < PRESS_WINDOW_MS;
    }

    return { keys, consume };
}
