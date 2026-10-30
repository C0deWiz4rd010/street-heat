import * as THREE from "three";
import { applyLook, createCar, replaceCarModel } from "./vehicles.js";

const WIDTH = 360;
const HEIGHT = 220;
const FRAME_STEP = 1 / 30;

/**
 * Garage turntable. The car is drawn by the game's own renderer into a small render target and copied to a 2D
 * canvas in the garage panel (no second WebGL context). Paint, rims and the other look options apply live.
 * Drag the canvas or use the arrow keys to turn the car; it slowly spins on its own while idle.
 */
export function createGaragePreview({ renderer, canvas, sharedMaterials }) {
    const ctx = canvas.getContext("2d");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    canvas.tabIndex = 0;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(32, WIDTH / HEIGHT, 0.1, 80);
    scene.add(new THREE.HemisphereLight("#9fb6e8", "#1a1d28", 1.1));
    const key = new THREE.DirectionalLight("#fff3dc", 2.4);
    key.position.set(5, 8, 6);
    scene.add(key);
    const rimA = new THREE.PointLight("#2ff3ff", 70, 18, 1.6);
    rimA.position.set(-5, 2.5, -4);
    scene.add(rimA);
    const rimB = new THREE.PointLight("#ff3fa4", 60, 18, 1.6);
    rimB.position.set(5, 2, -5);
    scene.add(rimB);

    const stage = new THREE.Group();
    scene.add(stage);
    const floor = new THREE.Mesh(
        new THREE.RingGeometry(2.6, 3.0, 48).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 1.4, 2) })
    );
    floor.position.y = 0.02;
    scene.add(floor);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(3, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: "#10141c", roughness: 0.6, metalness: 0.4 }));
    scene.add(disc);

    const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
    const image = ctx.createImageData(WIDTH, HEIGHT);

    let car = null;
    let yaw = 0.6;
    let dragging = false;
    let lastX = 0;
    let idle = 0;
    let sinceFrame = FRAME_STEP;
    const clearColor = new THREE.Color();

    canvas.addEventListener("pointerdown", (event) => {
        dragging = true;
        lastX = event.clientX;
        canvas.setPointerCapture?.(event.pointerId);
    });
    canvas.addEventListener("pointermove", (event) => {
        if (!dragging) return;
        yaw += (event.clientX - lastX) * 0.012;
        lastX = event.clientX;
        idle = 0;
    });
    const release = () => {
        dragging = false;
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener("keydown", (event) => {
        if (event.key === "ArrowLeft") yaw -= 0.18;
        else if (event.key === "ArrowRight") yaw += 0.18;
        else return;
        idle = 0;
        event.preventDefault();
    });

    function frameCar() {
        const box = new THREE.Box3().setFromObject(car);
        car.position.y -= box.min.y;
        const size = box.getSize(new THREE.Vector3());
        const reach = Math.max(size.x, size.z) * 1.05 + 1.5;
        camera.position.set(0, reach * 0.42 + size.y, reach * 0.9);
        camera.lookAt(0, size.y * 0.45, 0);
    }

    function setModel(model) {
        if (car && car.userData.model === model) return;
        if (!car) {
            car = createCar(model, sharedMaterials, { headlightSpot: false });
            stage.add(car);
        } else {
            car.position.y = 0;
            replaceCarModel(car, model, sharedMaterials);
        }
        // The NPC headlight decal would inflate the bounding box and is meaningless here.
        car.userData.parts.beam?.removeFromParent();
        frameCar();
    }

    /**
     * Called every frame while the garage is open: follows the selected model and look, turns the car and redraws
     * at 30 fps. `spin` (-1..1) is an extra turn input, e.g. a gamepad stick.
     */
    function update(dt, model, look, spin = 0) {
        setModel(model);
        applyLook(car, look);
        if (spin) {
            yaw += spin * dt * 2.4;
            idle = 0;
        } else {
            idle += dt;
            if (!dragging && idle > 1.5) yaw += dt * 0.5;
        }
        sinceFrame += dt;
        if (sinceFrame < FRAME_STEP) return;
        sinceFrame = 0;
        car.rotation.y = yaw;
        const previous = renderer.getRenderTarget();
        renderer.getClearColor(clearColor);
        const clearAlpha = renderer.getClearAlpha();
        renderer.setRenderTarget(target);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixels);
        renderer.setRenderTarget(previous);
        renderer.setClearColor(clearColor, clearAlpha);
        // The target is bottom-up; flip while copying.
        const row = WIDTH * 4;
        for (let y = 0; y < HEIGHT; y += 1) image.data.set(pixels.subarray((HEIGHT - 1 - y) * row, (HEIGHT - y) * row), y * row);
        ctx.putImageData(image, 0, 0);
    }

    return { update };
}
