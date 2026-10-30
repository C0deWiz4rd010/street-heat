// Controller navigation for the DOM menus: the D-pad moves focus, A presses, left/right adjusts sliders.

const FOCUSABLE = "button, input, select";

function isShown(element) {
    return !element.disabled && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
}

export function focusableIn(scope) {
    return [...scope.querySelectorAll(FOCUSABLE)].filter(isShown);
}

/** Moves focus inside `scope`. Returns the newly focused element (or null). */
export function moveFocus(scope, direction) {
    const items = focusableIn(scope);
    if (!items.length) return null;
    const active = document.activeElement;
    const index = items.indexOf(active);
    if (index < 0) {
        items[0].focus();
        return items[0];
    }
    if ((direction === "left" || direction === "right") && adjust(active, direction === "right" ? 1 : -1)) return active;
    const step = direction === "up" || direction === "left" ? -1 : 1;
    const next = items[(index + step + items.length) % items.length];
    next.focus();
    next.scrollIntoView?.({ block: "nearest" });
    return next;
}

/** Left/right on a slider or dropdown changes its value instead of moving focus. */
export function adjust(element, delta) {
    if (element.type === "range") {
        const step = Number(element.step) || 1;
        const min = Number(element.min);
        const max = Number(element.max);
        element.value = String(Math.min(max, Math.max(min, Number(element.value) + delta * step)));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    if (element.tagName === "SELECT") {
        const next = Math.min(element.options.length - 1, Math.max(0, element.selectedIndex + delta));
        if (next === element.selectedIndex) return true;
        element.selectedIndex = next;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
    }
    return false;
}

/** Presses the focused control, or focuses the first one when nothing in the scope has focus. */
export function confirmFocus(scope) {
    const active = document.activeElement;
    if (active && scope.contains(active) && active !== scope) {
        active.click?.();
        return;
    }
    focusableIn(scope)[0]?.focus();
}
