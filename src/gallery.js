import * as THREE from "three";
import { CAR_MODELS } from "./config.js";
import { CIVILIAN_TYPES, POLICE_LOOKS, SHOWCASE_OVERRIDES, buildCivilian } from "./data/vehicles.js";
import { createCar, setHeadlightBeamLevel, updateCarVisuals } from "./vehicles.js";

/**
 * Dev-only vehicle gallery (open the game with `?gallery`). Shows every model in a grid so shapes, paints and
 * parts can be reviewed without driving around. Drag to orbit, wheel to zoom, N night, T top-down, Space spin.
 */
export function createGallery({ renderer, sharedMaterials }) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#10151d");
    const hemi = new THREE.HemisphereLight("#cfd8ff", "#29323f", 1.3);
    const sun = new THREE.DirectionalLight("#fff7df", 3.2);
    sun.position.set(14, 24, -10);
    scene.add(hemi, sun);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: "#2a2f36", roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor, new THREE.GridHelper(200, 100, "#3b4452", "#272d36"));

    const rows = [
        { label: "Basis", models: CAR_MODELS.map((model) => ({ model, options: {} })) },
        {
            label: "Polizei",
            models: [
                ...Object.values(POLICE_LOOKS).flat().map((look) => ({
                    model: { ...look, color: look.color ?? look.colors[0], features: [...(look.features ?? [])] },
                    options: { police: true, lightbar: look.lightbar, hidden: look.hidden },
                })),
                // The unmarked car again with its lights revealed.
                {
                    model: { ...POLICE_LOOKS.unmarked[0], name: "Zivilstreife (enttarnt)", color: POLICE_LOOKS.unmarked[0].colors[0], features: [] },
                    options: { police: true, lightbar: "grille", hidden: false },
                },
            ],
        },
        {
            label: "Teile",
            models: SHOWCASE_OVERRIDES.map((override) => ({ model: { ...CAR_MODELS[override.base], ...override.model }, options: {} })),
        },
    ];

    // Civilian traffic: every type once, dressed for Downtown (types with their own palette keep it).
    let seed = 7;
    const rng = () => {
        seed = (seed * 16807) % 2147483647;
        return seed / 2147483647;
    };
    const civilians = Object.keys(CIVILIAN_TYPES).map((typeId) => ({ model: buildCivilian(typeId, "downtown", rng), options: {} }));
    rows.push({ label: "Zivil", models: civilians.slice(0, 8) });
    rows.push({ label: "Zivil", models: civilians.slice(8) });

    const cars = [];
    const labels = [];
    rows.forEach((row, rowIndex) => {
        row.models.forEach(({ model, options }, index) => {
            const car = createCar(model, sharedMaterials, options);
            car.position.set((index - (row.models.length - 1) / 2) * 8, 0.38, rowIndex * 9);
            scene.add(car);
            cars.push(car);
            labels.push(`${row.label}: ${model.name}`);
        });
    });

    const overlay = document.createElement("div");
    overlay.style.cssText = "position:fixed;left:12px;top:12px;z-index:200;font:12px/1.5 monospace;color:#dfe8f5;background:rgba(8,12,18,.78);padding:8px 10px;border-radius:6px;pointer-events:none";
    overlay.innerHTML = "GALERIE<br>Ziehen: drehen · Rad: Zoom<br>N Nacht · T Draufsicht · Leertaste Drehung · [ ] Reihe wechseln";
    document.body.appendChild(overlay);

    const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.3, 400);
    const view = { yaw: 0.6, pitch: 0.55, distance: 42, targetZ: 18 };
    let spin = true;
    let night = false;
    let dragging = false;

    function applyNight() {
        hemi.intensity = night ? 0.45 : 1.3;
        sun.intensity = night ? 0.5 : 3.2;
        scene.background.set(night ? "#05080d" : "#10151d");
        setHeadlightBeamLevel(night ? 1 : 0);
    }

    window.addEventListener("pointerdown", () => {
        dragging = true;
    });
    window.addEventListener("pointerup", () => {
        dragging = false;
    });
    window.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        view.yaw -= event.movementX * 0.006;
        view.pitch = Math.max(0.15, Math.min(1.5, view.pitch + event.movementY * 0.006));
    });
    window.addEventListener("wheel", (event) => {
        view.distance = Math.max(8, Math.min(90, view.distance * (event.deltaY > 0 ? 1.08 : 0.92)));
    });
    window.addEventListener("keydown", (event) => {
        const key = event.key.toLowerCase();
        if (key === "n") {
            night = !night;
            applyNight();
        } else if (key === "t") {
            view.pitch = 1.45;
        } else if (key === " ") {
            spin = !spin;
        } else if (key === "[") {
            view.targetZ -= 9;
        } else if (key === "]") {
            view.targetZ += 9;
        }
    });
    window.addEventListener("resize", () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    });

    function render(dt) {
        if (spin) for (const car of cars) car.rotation.y += dt * 0.5;
        for (const car of cars) updateCarVisuals(car, dt, { speed: 4 });
        camera.position.set(
            Math.sin(view.yaw) * Math.cos(view.pitch) * view.distance,
            Math.sin(view.pitch) * view.distance,
            view.targetZ + Math.cos(view.yaw) * Math.cos(view.pitch) * view.distance
        );
        camera.lookAt(0, 0, view.targetZ);
        renderer.render(scene, camera);
    }

    return { render, labels };
}
