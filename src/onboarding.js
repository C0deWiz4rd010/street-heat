// First-run tips, shown one at a time. A step ends when the player did the thing or its time ran out.
export const ONBOARDING_STEPS = [
    { id: "drive", text: "Fahren: WASD oder Pfeiltasten. Gib Gas!", done: (s) => Math.abs(s.player.speed) > 6, max: 20 },
    { id: "drift", text: "Drift: Leertaste halten und lenken. Drifts bringen Punkte.", done: (s) => s.player.drift > 0.3, max: 16 },
    { id: "nitro", text: "Nitro: Shift halten. Die Leiste lädt sich beim Fahren wieder auf.", done: (s) => Boolean(s.player.nitroActive), max: 14 },
    { id: "heat", text: "Heat: Cops jagen dich nur mit Sichtlinie. Fahr hinter Gebäude, um sie abzuschütteln.", done: (s) => s.wanted.level > 0, max: 16 },
    { id: "mission", text: "Mission: Fahr zum weißen Marker auf der Minimap, bevor die Zeit abläuft.", done: (s) => s.stats.missions > 0, max: 16 },
    { id: "garage", text: "Garage: G öffnet sie. Dort gibt es Upgrades und neue Autos.", done: (s) => s.screen === "garage", max: 12 },
];

const MIN_SHOW_SECONDS = 3;

export function createOnboarding({ steps = ONBOARDING_STEPS, isDone = () => false, onComplete = () => {} } = {}) {
    let index = isDone() ? steps.length : 0;
    let elapsed = 0;

    function update(state, dt) {
        if (index >= steps.length) return "";
        // The clock only runs during active play, never in menus or while paused.
        if (state.screen !== "playing" || state.paused || !state.running) return steps[index].text;
        elapsed += dt;
        const step = steps[index];
        if (elapsed >= MIN_SHOW_SECONDS && (step.done(state) || elapsed >= step.max)) {
            index += 1;
            elapsed = 0;
            if (index >= steps.length) {
                onComplete();
                return "";
            }
        }
        return steps[index].text;
    }

    function restart() {
        index = 0;
        elapsed = 0;
    }

    function skip() {
        index = steps.length;
        onComplete();
    }

    return { update, restart, skip, get active() { return index < steps.length; }, get step() { return index; } };
}
