export function createInput({ onRestart, onSwitchCar, onUserGesture }) {
    const keys = Object.create(null);
    const pressed = Object.create(null);

    window.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (!keys[key]) pressed[key] = true;
        keys[key] = true;
        onUserGesture?.();

        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "F3"].includes(event.key)) {
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
            pressed[key] = true;
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
        const wasPressed = Boolean(pressed[key]);
        pressed[key] = false;
        return wasPressed;
    }

    return { keys, consume };
}
